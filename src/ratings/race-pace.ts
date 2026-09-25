import { db } from "@/db";
import { laps, sessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Below this many clean laps, a driver's "median" is just an average of a
 * couple of laps and can be dominated by a single bad one — a crash-damaged
 * limp back to the pits, or a lap caught by a broken timing record. Found via
 * a real case: a driver with 2 recorded laps (97.5s, 154.3s — the second
 * clearly not representative pace) produced a field-relative gap of +47s,
 * which is physically meaningless and would corrupt any rating built from it.
 */
const MIN_CLEAN_LAPS_FOR_SIGNAL = 4;

/**
 * Field-relative race pace per driver for one race: each driver's median
 * clean lap time minus the field's median clean lap time. Negative = faster
 * than the field. Normalizes across circuits/conditions so paces are
 * comparable race-to-race. Returns null for a driver if they have no clean
 * laps (e.g. DNF on lap 1), or too few to produce a meaningful median.
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
    if (durations.length < MIN_CLEAN_LAPS_FOR_SIGNAL) continue;
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
