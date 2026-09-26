import { db } from "@/db";
import { races } from "@/db/schema";
import { eq } from "drizzle-orm";
import { computeRaceFieldRelativePace } from "./race-pace";
import { weightedAverage } from "./decay";

/**
 * Short-term race form: each driver's recency-weighted field-relative race
 * pace over their most recent races before the target race.
 *
 * Deliberately separate from basePace (which blends qualifying gap and race
 * pace over the whole season, same 5-race half-life) — this isolates "how
 * has this driver actually gone in races lately" as its own signal, the same
 * way qualiForm isolates recent qualifying skill. See quali-form.ts.
 */
export async function computeRaceForm(
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

  // Walk back through history looking for races that actually have race-pace
  // data, stopping once `lookback` of them are found — an unraced future
  // round (or one whose laps haven't been ingested yet) is skipped rather
  // than counted as "no recent form", the same way qualiForm's loop below
  // naturally skips rounds with no qualifying data.
  const paceByRace = new Map<number, Map<number, number>>();
  const usableRaces: typeof priorRaces = [];
  for (const race of priorRaces) {
    const pace = await computeRaceFieldRelativePace(race.id);
    if (pace.size === 0) continue;
    paceByRace.set(race.id, pace);
    usableRaces.push(race);
    if (usableRaces.length >= lookback) break;
  }

  const result = new Map<number, number | null>();
  for (const driverId of driverIds) {
    const history: number[] = [];
    for (const race of usableRaces) {
      const v = paceByRace.get(race.id)?.get(driverId);
      if (v != null) history.push(v);
    }
    result.set(driverId, weightedAverage(history));
  }
  return result;
}
