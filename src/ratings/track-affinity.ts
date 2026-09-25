import { db } from "@/db";
import { races, circuits } from "@/db/schema";
import { eq } from "drizzle-orm";
import { weightedAverage } from "./decay";

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
      allPaces.push(pace);
      if (circuitTypeByRace.get(race.id) === targetType) {
        typePaces.push(pace);
      }
    }
    const overall = weightedAverage(allPaces);
    const atType = weightedAverage(typePaces);
    result.set(driverId, overall != null && atType != null ? atType - overall : null);
  }
  return result;
}
