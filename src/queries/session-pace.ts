import { db } from "@/db";
import { sessions, laps, drivers, raceResults, qualifyingResults, teams } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export type SessionType = "fp1" | "fp2" | "fp3" | "q" | "r";

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

  const bestByDriver = new Map<number, number>();
  for (const lap of sessionLaps) {
    if (lap.lapDuration == null) continue;
    const current = bestByDriver.get(lap.driverId);
    if (current == null || lap.lapDuration < current) {
      bestByDriver.set(lap.driverId, lap.lapDuration);
    }
  }
  if (bestByDriver.size === 0) return [];

  const driverIds = [...bestByDriver.keys()];
  const [driverRows, raceResultTeamRows, qualifyingTeamRows] = await Promise.all([
    db.select({ id: drivers.id, name: drivers.name }).from(drivers).where(inArray(drivers.id, driverIds)),
    db
      .select({ driverId: raceResults.driverId, teamId: raceResults.teamId, teamName: teams.name })
      .from(raceResults)
      .innerJoin(teams, eq(raceResults.teamId, teams.id))
      .where(and(eq(raceResults.raceId, raceId), inArray(raceResults.driverId, driverIds))),
    // fallback for FP sessions on a race that hasn't finished yet (no raceResults rows)
    db
      .select({ driverId: qualifyingResults.driverId, teamId: qualifyingResults.teamId, teamName: teams.name })
      .from(qualifyingResults)
      .innerJoin(teams, eq(qualifyingResults.teamId, teams.id))
      .where(and(eq(qualifyingResults.raceId, raceId), inArray(qualifyingResults.driverId, driverIds))),
  ]);

  const driverNameById = new Map(driverRows.map((d) => [d.id, d.name]));
  const teamByDriverId = new Map<number, { teamId: number; teamName: string }>();
  for (const t of qualifyingTeamRows) teamByDriverId.set(t.driverId, { teamId: t.teamId, teamName: t.teamName });
  for (const t of raceResultTeamRows) teamByDriverId.set(t.driverId, { teamId: t.teamId, teamName: t.teamName });

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

/**
 * Convenience wrapper: computes session pace only for sessions that
 * actually exist for this race, so a mid-weekend race (e.g. only FP1 run)
 * doesn't trigger pointless queries for sessions that haven't happened.
 */
export async function getAllSessionPaceForRace(
  raceId: number,
): Promise<Partial<Record<SessionType, DriverSessionPace[]>>> {
  const existingSessions = await db
    .select({ sessionType: sessions.sessionType })
    .from(sessions)
    .where(eq(sessions.raceId, raceId));

  const result: Partial<Record<SessionType, DriverSessionPace[]>> = {};
  for (const { sessionType } of existingSessions) {
    result[sessionType] = await getSessionPaceRanking(raceId, sessionType);
  }
  return result;
}
