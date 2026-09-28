import { db } from "@/db";
import { races, circuits } from "@/db/schema";
import { eq } from "drizzle-orm";
import { weightedAverage } from "./decay";

/**
 * Below this many races at the target circuit type, "affinity" is really
 * just one or two results' noise, not a measured trait — found via a real
 * case: a rookie with a single high_speed-circuit race (a strong one-off
 * result) got a raw affinity of +1.25, nearly double a base-pace value's
 * typical magnitude, from n=1. race-craft.ts uses the same kind of guard
 * (MIN_HISTORY) for the same reason.
 */
const MIN_SAME_TYPE_RACES = 3;

/**
 * A single race's field-relative pace clipped to this magnitude before it
 * enters either average below. Found via a real case: a driver's median
 * race lap was ~15.6s off the field one race (a damaged car limping home,
 * a bad strategy, a recovery drive after an incident — not corrupted data,
 * verified against the raw laps) and that one result alone was enough to
 * dominate an 11-race recency-weighted average years later, because the
 * value was so far outside the range every other race in the sample fell
 * in (the rest of a typical field clusters within roughly +/-2.5s). This
 * signal is meant to measure a circuit-type *skill*, not absorb a single
 * bad day at the track — DNF-adjacent disasters are already excluded
 * elsewhere by MIN_CLEAN_LAPS_FOR_SIGNAL in race-pace.ts; this catches the
 * case that clears that bar but is still not representative pace.
 */
const MAX_RACE_PACE_MAGNITUDE = 3;

function clip(value: number): number {
  return Math.max(-MAX_RACE_PACE_MAGNITUDE, Math.min(MAX_RACE_PACE_MAGNITUDE, value));
}

/**
 * Per-driver adjustment for the target race's circuit type: the driver's
 * recency-weighted average field-relative pace on that circuit type, minus
 * their overall average pace across all types. Negative = faster than usual
 * at this type of track. Returns null if the driver has no prior races at
 * this circuit type (falls back to 0 adjustment at the call site).
 */
export async function computeTrackAffinity(
  targetRaceId: number,
  driverIds: number[],
  priorRaces: { id: number; season: number; round: number }[],
  racePaceByRace: Map<number, Map<number, number>>,
): Promise<Map<number, number | null>> {
  const [targetRace] = await db
    .select({ circuitId: races.circuitId })
    .from(races)
    .where(eq(races.id, targetRaceId));
  if (!targetRace) return new Map();

  const [targetCircuit] = await db
    .select({ type: circuits.type })
    .from(circuits)
    .where(eq(circuits.id, targetRace.circuitId));
  const targetType = targetCircuit?.type;
  if (!targetType) return new Map(driverIds.map((d) => [d, null]));

  const raceCircuitTypes = await db
    .select({ raceId: races.id, circuitType: circuits.type })
    .from(races)
    .innerJoin(circuits, eq(races.circuitId, circuits.id));
  const circuitTypeByRace = new Map(raceCircuitTypes.map((r) => [r.raceId, r.circuitType]));

  const result = new Map<number, number | null>();
  for (const driverId of driverIds) {
    const allPaces: number[] = [];
    const typePaces: number[] = [];
    for (const race of priorRaces) {
      const pace = racePaceByRace.get(race.id)?.get(driverId);
      if (pace == null) continue;
      const clipped = clip(pace);
      allPaces.push(clipped);
      if (circuitTypeByRace.get(race.id) === targetType) {
        typePaces.push(clipped);
      }
    }
    const overall = weightedAverage(allPaces);
    const atType = typePaces.length >= MIN_SAME_TYPE_RACES ? weightedAverage(typePaces) : null;
    result.set(driverId, overall != null && atType != null ? atType - overall : null);
  }
  return result;
}
