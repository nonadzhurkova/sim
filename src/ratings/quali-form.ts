import { db } from "@/db";
import { races, qualifyingResults } from "@/db/schema";
import { eq } from "drizzle-orm";
import { weightedAverage } from "./decay";

/**
 * Short-term qualifying form: each driver's recency-weighted qualifying gap
 * to pole over their most recent races before the target race.
 *
 * This is deliberately separate from basePace, which averages qualifying gap
 * and race pace together over a 5-race half-life. Grid position turned out to
 * be the strongest single predictor in the model (pole won 9 of 14 races in
 * 2026), so "who is qualifying well right now" is worth isolating — both to
 * weight it independently and because a future race with no qualifying yet
 * needs the grid simulated, which is exactly what this signal predicts.
 *
 * Returns field-relative values: a driver's gap to pole minus the field's
 * median gap to pole, so the scale matches every other pace signal (negative
 * = better than the field) rather than being an absolute gap that would grow
 * with the size of the spread at a given circuit.
 */
export async function computeQualiForm(
  targetRaceId: number,
  driverIds: number[],
  lookback = 5,
): Promise<Map<number, number | null>> {
  const [targetRace] = await db
    .select({ season: races.season, round: races.round })
    .from(races)
    .where(eq(races.id, targetRaceId));
  if (!targetRace) return new Map();

  const allRaces = await db
    .select({ id: races.id, season: races.season, round: races.round })
    .from(races);
  const priorRaces = allRaces
    .filter(
      (r) =>
        r.season < targetRace.season ||
        (r.season === targetRace.season && r.round < targetRace.round),
    )
    .sort((a, b) => b.season - a.season || b.round - a.round);

  const qualRows = await db
    .select({
      raceId: qualifyingResults.raceId,
      driverId: qualifyingResults.driverId,
      gapToPole: qualifyingResults.gapToPole,
    })
    .from(qualifyingResults);

  // Normalize each race's gaps against that race's field median, so a wet
  // session with a huge spread doesn't dominate a dry one with a tight field.
  const relativeByRaceDriver = new Map<string, number>();
  const byRace = new Map<number, { driverId: number; gap: number }[]>();
  for (const q of qualRows) {
    if (q.gapToPole == null) continue;
    if (!byRace.has(q.raceId)) byRace.set(q.raceId, []);
    byRace.get(q.raceId)!.push({ driverId: q.driverId, gap: q.gapToPole });
  }
  for (const [raceId, entries] of byRace) {
    if (entries.length === 0) continue;
    const med = median(entries.map((e) => e.gap));
    for (const e of entries) {
      relativeByRaceDriver.set(`${raceId}:${e.driverId}`, e.gap - med);
    }
  }

  const result = new Map<number, number | null>();
  for (const driverId of driverIds) {
    const history: number[] = [];
    for (const race of priorRaces) {
      const v = relativeByRaceDriver.get(`${race.id}:${driverId}`);
      if (v != null) history.push(v);
      if (history.length >= lookback) break;
    }
    result.set(driverId, weightedAverage(history));
  }
  return result;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
