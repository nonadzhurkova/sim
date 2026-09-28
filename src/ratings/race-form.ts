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
 *
 * `includeSprints` folds a sprint weekend's sprint race pace in as an extra,
 * independent history entry alongside that same round's main race (not a
 * replacement) -- more recent-form data per driver, same signal. Gated
 * behind a flag rather than always-on because it changes the production
 * rating pipeline's output and, per project practice, needs a holdout
 * backtest before being trusted on by default.
 */
export async function computeRaceForm(
  targetRaceId: number,
  driverIds: number[],
  lookback = 5,
  includeSprints = false,
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
  // naturally skips rounds with no qualifying data. Each usable round can
  // contribute up to two history entries (main race, then sprint if present
  // and enabled) — "lookback" counts rounds walked, not entries collected,
  // so a sprint round naturally weighs a little more in the average, same as
  // it would if a driver just raced twice in one weekend. Pace is computed
  // once per race here and reused for every driver below, not recomputed
  // per driver.
  //
  // Fetched in one parallel batch rather than one race at a time: nearly
  // every race in a modern season has full data, so the sequential
  // stop-once-lookback-is-hit loop almost always ends up querying exactly
  // the first `lookback` candidates anyway -- doing that as N sequential
  // round trips (each two queries: a session lookup, then that session's
  // whole laps table) was measured taking ~1.9s for a single prediction.
  // A small overfetch (lookback + 3) covers the occasional gap (an
  // unraced/not-yet-ingested round) without falling back to a slow
  // one-at-a-time retry loop.
  const candidateRaces = priorRaces.slice(0, lookback + 3);
  const candidatePaces = await Promise.all(
    candidateRaces.map((race) =>
      Promise.all([
        computeRaceFieldRelativePace(race.id, "r"),
        includeSprints ? computeRaceFieldRelativePace(race.id, "sprint") : Promise.resolve(new Map<number, number>()),
      ]),
    ),
  );

  const paceByRace = new Map<number, { race: Map<number, number>; sprint: Map<number, number> }>();
  const usableRaces: typeof priorRaces = [];
  candidateRaces.forEach((race, i) => {
    if (usableRaces.length >= lookback) return;
    const [racePace, sprintPace] = candidatePaces[i];
    if (racePace.size === 0 && sprintPace.size === 0) return;
    paceByRace.set(race.id, { race: racePace, sprint: sprintPace });
    usableRaces.push(race);
  });

  const result = new Map<number, number | null>();
  for (const driverId of driverIds) {
    const history: number[] = [];
    for (const race of usableRaces) {
      const paces = paceByRace.get(race.id)!;
      const r = paces.race.get(driverId);
      if (r != null) history.push(r);
      const s = paces.sprint.get(driverId);
      if (s != null) history.push(s);
    }
    result.set(driverId, weightedAverage(history));
  }
  return result;
}
