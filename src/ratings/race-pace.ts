import { db } from "@/db";
import { laps, sessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Field-relative race pace per driver for one race: each driver's median
 * clean lap time minus the field's median clean lap time. Negative = faster
 * than the field. Normalizes across circuits/conditions so paces are
 * comparable race-to-race. Returns null for a driver if they have no clean
 * laps (e.g. DNF on lap 1).
 */
export async function computeRaceFieldRelativePace(
  raceId: number,
): Promise<Map<number, number>> {
  const [raceSession] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.raceId, raceId), eq(sessions.sessionType, "r")));

  if (!raceSession) return new Map();

  const cleanLaps = await db
    .select({ driverId: laps.driverId, lapDuration: laps.lapDuration })
    .from(laps)
    .where(
      and(
        eq(laps.sessionId, raceSession.id),
        eq(laps.isPitInOut, false),
      ),
    );

  const byDriver = new Map<number, number[]>();
  for (const lap of cleanLaps) {
    if (lap.lapDuration == null) continue;
    if (!byDriver.has(lap.driverId)) byDriver.set(lap.driverId, []);
    byDriver.get(lap.driverId)!.push(lap.lapDuration);
  }

  const driverMedians = new Map<number, number>();
  for (const [driverId, durations] of byDriver) {
    driverMedians.set(driverId, median(durations));
  }
  if (driverMedians.size === 0) return new Map();

  const fieldMedian = median([...driverMedians.values()]);

  const relative = new Map<number, number>();
  for (const [driverId, m] of driverMedians) {
    relative.set(driverId, m - fieldMedian);
  }
  return relative;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
