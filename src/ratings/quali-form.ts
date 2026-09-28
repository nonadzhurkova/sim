import { db } from "@/db";
import { races, qualifyingResults, sessions } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { weightedAverage, trimmedWeightedAverage, weightedMedian, DEFAULT_HALF_LIFE_RACES } from "./decay";

export type AveragingMode = "weighted" | "trimmed" | "median";

function applyAveraging(values: number[], mode: AveragingMode, halfLifeRaces: number): number | null {
  if (mode === "trimmed") return trimmedWeightedAverage(values, halfLifeRaces);
  if (mode === "median") return weightedMedian(values, halfLifeRaces);
  return weightedAverage(values, halfLifeRaces);
}
import { computeSessionCompoundRelativePace } from "./practice-pace";

/**
 * A single race's field-relative qualifying gap clipped to this magnitude
 * before it enters the recency-weighted average. Found via a real case: a
 * driver who took 2 poles and 3 more front-row starts in their last 8
 * qualifying sessions also had one genuinely terrible one (P16, 2.98s off
 * pole vs a typical <=0.3s) -- being the most recent, the 5-race half-life
 * gave it close to full weight and dragged the average down enough to make
 * an otherwise elite qualifier look mediocre. The field's real distribution
 * (1252 qualifying results, all seasons) has p99 at 3.85s and a max of
 * 12.7s -- a single-session broken-timing-lap or red-flag/crash outlier, not
 * a representative gap. Same reasoning as track-affinity.ts's
 * MAX_RACE_PACE_MAGNITUDE clip.
 */
const MAX_QUALI_GAP_MAGNITUDE = 4;

function clip(value: number): number {
  return Math.max(-MAX_QUALI_GAP_MAGNITUDE, Math.min(MAX_QUALI_GAP_MAGNITUDE, value));
}

/**
 * Normalizes raw gapToPole rows into field-relative, outlier-clipped values
 * keyed by "raceId:driverId" -- each driver's gap minus that race's own
 * field median gap, so a wet session's huge spread doesn't dominate a dry
 * one's tight field, and a single broken-timing-lap/crash session doesn't
 * dominate a recency-weighted average built from it. Used by computeQualiForm
 * below. compute.ts's basePace deliberately does NOT use this -- see its own
 * comment for why (tried it, regressed the 2024 holdout, reverted).
 */
export function computeFieldRelativeQualiGaps(
  rows: { raceId: number; driverId: number; gapToPole: number | null }[],
): Map<string, number> {
  const relativeByRaceDriver = new Map<string, number>();
  const byRace = new Map<number, { driverId: number; gap: number }[]>();
  for (const q of rows) {
    if (q.gapToPole == null) continue;
    if (!byRace.has(q.raceId)) byRace.set(q.raceId, []);
    byRace.get(q.raceId)!.push({ driverId: q.driverId, gap: q.gapToPole });
  }
  for (const [raceId, entries] of byRace) {
    if (entries.length === 0) continue;
    const med = median(entries.map((e) => e.gap));
    for (const e of entries) {
      relativeByRaceDriver.set(`${raceId}:${e.driverId}`, clip(e.gap - med));
    }
  }
  return relativeByRaceDriver;
}

/**
 * Sprint qualifying's field-relative one-lap pace, computed live from raw
 * laps -- unlike main qualifying, there's no stored position/gap-to-pole
 * table for it. Returns an empty map if the race has no sprint_quali session
 * ingested (most rounds, and any not yet imported).
 */
async function computeSprintQualiPace(raceId: number): Promise<Map<number, number>> {
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.raceId, raceId), eq(sessions.sessionType, "sprint_quali")));
  if (!session) return new Map();
  return computeSessionCompoundRelativePace(session.id);
}

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
 *
 * `includeSprints` folds a sprint weekend's sprint-qualifying pace in as an
 * extra history entry alongside that round's main qualifying (not a
 * replacement). Gated behind a flag, same reasoning as raceForm's sprint
 * blend — changes the production rating pipeline's output, needs a holdout
 * backtest before being on by default.
 */
export async function computeQualiForm(
  targetRaceId: number,
  driverIds: number[],
  lookback = 5,
  includeSprints = false,
  /**
   * Recency-decay half-life in races, passed to weightedAverage. Defaults to
   * DEFAULT_HALF_LIFE_RACES (5) -- same as every other signal. Exposed for
   * the backtest harness to sweep: at half-life 5, a driver's qualifying
   * form is dominated by roughly their last 5 races, so a short slump after
   * a strong start can outweigh the strong start entirely. Widening this
   * (and `lookback` in step, since a driver's history walk below still stops
   * once `lookback` entries are found -- a wider half-life with the same
   * short lookback would never see the extra races it's meant to weigh) is
   * the fix under test; not yet validated, so still defaults to today's
   * behavior everywhere except the sweep itself.
   */
  halfLifeRaces: number = DEFAULT_HALF_LIFE_RACES,
  /**
   * How to combine a driver's per-race history into one number. "trimmed"
   * (adopted default as of 2026-09-28) drops the single best and single
   * worst value before averaging -- symmetric, so a one-off great session
   * doesn't get discarded to flatter the trim any more than a one-off bad
   * one does. "weighted" is the older plain recency-weighted mean; "median"
   * uses the recency-weighted median instead. Validated on 2025+2026 pooled
   * (logloss 1.221->1.210, top1 53.8%->56.4%) and sanity-checked on 2024
   * (trivial logloss movement, top1/top3 unchanged) -- see project memory
   * on the Russell/Antonelli investigation for the full writeup. Adopted
   * because a single genuinely anomalous qualifying session (a Q1 exit for
   * an otherwise front-running driver, say) was dominating an
   * otherwise-consistent recent record under the plain weighted mean.
   */
  averagingMode: AveragingMode = "trimmed",
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

  // Scoped to prior races only, not every qualifying result ever ingested --
  // fetching the whole table was a large, unnecessary scan measured taking
  // ~900ms on its own, most of which this call never needed (a driver's
  // walk below stops at `lookback` races back).
  const priorRaceIds = priorRaces.map((r) => r.id);
  const qualRows =
    priorRaceIds.length > 0
      ? await db
          .select({
            raceId: qualifyingResults.raceId,
            driverId: qualifyingResults.driverId,
            gapToPole: qualifyingResults.gapToPole,
          })
          .from(qualifyingResults)
          .where(inArray(qualifyingResults.raceId, priorRaceIds))
      : [];

  // Normalize each race's gaps against that race's field median, so a wet
  // session with a huge spread doesn't dominate a dry one with a tight field.
  const relativeByRaceDriver = computeFieldRelativeQualiGaps(qualRows);

  // Sprint-quali pace has no bulk query like qualRows above (it's derived
  // live from laps, not a stored table) -- computed once per prior race here
  // and cached, rather than per driver below. Capped to a small multiple of
  // lookback: a driver's walk stops once `lookback` *any* entries are found,
  // so it can never need sprint data from further back than that. Fetched in
  // one parallel batch, not one race at a time -- see the equivalent comment
  // in race-form.ts's computeRaceForm for why (same fix, same reasoning).
  const sprintQualiByRace = new Map<number, Map<number, number>>();
  if (includeSprints) {
    const candidateRaces = priorRaces.slice(0, lookback * 2);
    const paces = await Promise.all(candidateRaces.map((race) => computeSprintQualiPace(race.id)));
    candidateRaces.forEach((race, i) => {
      if (paces[i].size > 0) sprintQualiByRace.set(race.id, paces[i]);
    });
  }

  const result = new Map<number, number | null>();
  for (const driverId of driverIds) {
    const history: number[] = [];
    for (const race of priorRaces) {
      const v = relativeByRaceDriver.get(`${race.id}:${driverId}`);
      if (v != null) history.push(v);
      const s = sprintQualiByRace.get(race.id)?.get(driverId);
      if (s != null) history.push(s);
      if (history.length >= lookback) break;
    }
    result.set(driverId, applyAveraging(history, averagingMode, halfLifeRaces));
  }
  return result;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
