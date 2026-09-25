import { db } from "@/db";
import { sessions, laps, drivers } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getDriverTeamsAsOf } from "./driver-teams";

export type SessionType = "fp1" | "fp2" | "fp3" | "q" | "r";

/**
 * A lap below this fraction of the session's median lap time is treated as a
 * broken timing record, not a real lap. Generous enough to keep a genuine
 * qualifying lap on a session whose median is inflated by in/out laps and
 * long-run fuel loads, while still catching the badly-truncated records that
 * appear in the ingested data.
 */
const IMPLAUSIBLE_LAP_THRESHOLD = 0.8;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export type DriverSessionPace = {
  driverId: number;
  driverName: string;
  teamId: number | null;
  teamName: string | null;
  bestLap: number;
  gapToFastest: number;
  rank: number;
};

/**
 * Raw fastest-lap-per-driver ranking for one session — display data, not a
 * normalized rating signal (unlike ratings/race-pace.ts and
 * ratings/practice-pace.ts, which compute compound-normalized relative pace
 * for the long-term rating model). Partial-weekend safe: returns [] if the
 * session hasn't happened yet.
 */
export async function getSessionPaceRanking(
  raceId: number,
  sessionType: SessionType,
): Promise<DriverSessionPace[]> {
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.raceId, raceId), eq(sessions.sessionType, sessionType)));
  if (!session) return [];

  const sessionLaps = await db
    .select({ driverId: laps.driverId, lapDuration: laps.lapDuration })
    .from(laps)
    .where(and(eq(laps.sessionId, session.id), eq(laps.isPitInOut, false)));

  // Discard impossible lap records before ranking. Ingested timing data
  // contains partial laps (a timing loop catching only part of the circuit —
  // e.g. a 60.4s "lap" at a ~90s track) which would otherwise be shown as a
  // driver's session best and become the whole session's reference time.
  // The session's median lap is a robust estimate of the real lap length, so
  // anything far below it is a broken record rather than a fast lap.
  const allDurations = sessionLaps
    .map((l) => l.lapDuration)
    .filter((d): d is number => d != null);
  if (allDurations.length === 0) return [];
  const sessionMedian = median(allDurations);
  const minPlausibleLap = sessionMedian * IMPLAUSIBLE_LAP_THRESHOLD;

  const bestByDriver = new Map<number, number>();
  for (const lap of sessionLaps) {
    if (lap.lapDuration == null) continue;
    if (lap.lapDuration < minPlausibleLap) continue;
    const current = bestByDriver.get(lap.driverId);
    if (current == null || lap.lapDuration < current) {
      bestByDriver.set(lap.driverId, lap.lapDuration);
    }
  }
  if (bestByDriver.size === 0) return [];

  const driverIds = [...bestByDriver.keys()];
  const [driverRows, teamByDriverId] = await Promise.all([
    db.select({ id: drivers.id, name: drivers.name }).from(drivers).where(inArray(drivers.id, driverIds)),
    getDriverTeamsAsOf(raceId, driverIds),
  ]);

  const driverNameById = new Map(driverRows.map((d) => [d.id, d.name]));

  const fastest = Math.min(...bestByDriver.values());

  const ranked: DriverSessionPace[] = [...bestByDriver.entries()]
    .map(([driverId, bestLap]) => ({
      driverId,
      driverName: driverNameById.get(driverId) ?? "Unknown",
      teamId: teamByDriverId.get(driverId)?.teamId ?? null,
      teamName: teamByDriverId.get(driverId)?.teamName ?? null,
      bestLap,
      gapToFastest: bestLap - fastest,
      rank: 0,
    }))
    .sort((a, b) => a.bestLap - b.bestLap)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return ranked;
}

// Most relevant/recent first: race, then qualifying, then practice in reverse order.
const SESSION_DISPLAY_ORDER: SessionType[] = ["r", "q", "fp3", "fp2", "fp1"];

/**
 * Convenience wrapper: computes session pace only for sessions that
 * actually exist for this race, so a mid-weekend race (e.g. only FP1 run)
 * doesn't trigger pointless queries for sessions that haven't happened.
 * Returned in SESSION_DISPLAY_ORDER (most relevant/recent first) regardless
 * of underlying storage order.
 */
export async function getAllSessionPaceForRace(
  raceId: number,
): Promise<Partial<Record<SessionType, DriverSessionPace[]>>> {
  const existingSessions = await db
    .select({ sessionType: sessions.sessionType })
    .from(sessions)
    .where(eq(sessions.raceId, raceId));
  const existingTypes = new Set(existingSessions.map((s) => s.sessionType));

  const result: Partial<Record<SessionType, DriverSessionPace[]>> = {};
  for (const sessionType of SESSION_DISPLAY_ORDER) {
    if (!existingTypes.has(sessionType)) continue;
    result[sessionType] = await getSessionPaceRanking(raceId, sessionType);
  }
  return result;
}
