import { db } from "@/db";
import { raceResults, drivers, teams, xgboostPredictions } from "@/db/schema";
import { eq, inArray, and, desc } from "drizzle-orm";
import { buildSimContext } from "@/sim/entrants";
import { runSimulation } from "@/sim/engine";
import { calibrateOutcome, getFrozenPrediction } from "@/sim/run-simulation";
import { buildXgboostFeatures } from "@/sim/xgboost-features";
import { predictRace, xgboostModelAvailable } from "@/sim/xgboost-model";

// Lower than PredictionPanel's default (8000): this runs synchronously on
// every page load rather than being a user-triggered, streamed action, so it
// trades a little precision for a page that doesn't take 5+ seconds to
// render. The fixed seed (raceId) still makes results reproducible.
const REVIEW_ITERATIONS = 3000;

export type PredictionReviewRow = {
  driverId: number;
  driverName: string;
  teamName: string | null;
  predictedRank: number;
  winProbability: number;
  predictedFinish: number | null;
  actualFinish: number | null;
  actualStatus: "finished" | "dnf" | "dsq" | null;
  /** actualFinish - predictedRank; negative = model rated them too low (finished better than expected). */
  rankError: number | null;
};

export type PredictionReview = {
  raceId: number;
  iterations: number;
  hasRealGrid: boolean;
  rows: PredictionReviewRow[];
  /** The model's favourite (rank 1) and how they actually finished. */
  favourite: PredictionReviewRow | null;
  actualWinner: PredictionReviewRow | null;
  winnerPredictedRank: number | null;
  podiumHits: number;
  meanAbsRankError: number | null;
  logLoss: number | null;
  /**
   * True when `rows` comes from a run genuinely made before this race (see
   * getFrozenPrediction) -- what the model actually said beforehand. False
   * means no such run exists yet, so this is a live replay under whatever
   * ratings/weights are in effect right now, which can look different from
   * what a viewer saw on the day if anything's been retuned since.
   */
  isFrozen: boolean;
  modelVersion: string | null;
  /**
   * The XGBoost overlay's own call for this race, scored the same way as
   * the Monte Carlo rows above — a second opinion next to the primary
   * prediction, not blended into it (see README's "What's been tried").
   * Null when the model artifact isn't trained yet or the race never had a
   * real qualifying grid (the overlay has no pre-quali grid proxy).
   */
  xgboost: {
    rows: PredictionReviewRow[];
    favourite: PredictionReviewRow | null;
    winnerPredictedRank: number | null;
    podiumHits: number;
    logLoss: number | null;
  } | null;
};

const LOG_LOSS_FLOOR = 1e-4;

/**
 * The most recent xgboost_predictions row set that was stamped
 * predictedBeforeRace=true for this race — the same "frozen, but updated on
 * every pre-race click" semantics as getFrozenPrediction (see its doc
 * comment). Every /api/xgboost-predict call now persists here (previously
 * it wrote nothing), so once a race has been clicked at least once before
 * happening, this is preferred over recomputing live.
 */
async function getFrozenXgboostPrediction(raceId: number) {
  const rows = await db
    .select()
    .from(xgboostPredictions)
    .where(and(eq(xgboostPredictions.raceId, raceId), eq(xgboostPredictions.predictedBeforeRace, true)))
    .orderBy(desc(xgboostPredictions.predictedAt));
  return rows.length > 0 ? rows : null;
}

/**
 * Same shape of scoring as the Monte Carlo rows, applied to the XGBoost
 * overlay's own win probabilities. Prefers a stored frozen prediction (see
 * getFrozenXgboostPrediction); only recomputes live when no pre-race click
 * has ever been stored for this race, which loses predictedFinish's
 * precision not at all (unlike the Monte Carlo path) since this overlay's
 * prediction is deterministic given the same live grid/features either way.
 */
async function buildXgboostReview(
  raceId: number,
  actualByDriver: Map<number, { finishPosition: number | null; status: "finished" | "dnf" | "dsq" | null }>,
  winnerRow: { driverId: number } | undefined,
  actualPodiumIds: Set<number>,
): Promise<PredictionReview["xgboost"]> {
  const driverRows = await db.select({ id: drivers.id, externalRef: drivers.externalRef, name: drivers.name }).from(drivers);
  const nameById = new Map(driverRows.map((d) => [d.id, d.name]));

  const teamRows = await db.select({ driverId: raceResults.driverId, teamId: raceResults.teamId }).from(raceResults).where(eq(raceResults.raceId, raceId));
  const teamIdByDriver = new Map(teamRows.map((r) => [r.driverId, r.teamId]));
  const allTeamIds = [...new Set(teamRows.map((r) => r.teamId))];
  const teamNameRows = allTeamIds.length
    ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, allTeamIds))
    : [];
  const teamNameById = new Map(teamNameRows.map((t) => [t.id, t.name]));

  const frozen = await getFrozenXgboostPrediction(raceId);

  let predictions: { driverId: number; predFinishPosition: number; predDnfProb: number; winProbability: number }[];

  if (frozen) {
    predictions = frozen.map((r) => ({
      driverId: r.driverId,
      predFinishPosition: r.predFinishPosition ?? 0,
      predDnfProb: r.predDnfProb ?? 0,
      winProbability: r.winProbability ?? 0,
    }));
  } else {
    if (!xgboostModelAvailable()) return null;

    const features = await buildXgboostFeatures(raceId);
    if (!features) return null; // no real grid for this race — the overlay has no pre-quali proxy

    const driverByRef = new Map(driverRows.map((d) => [d.externalRef, d]));
    const entrants = features
      .map((f) => {
        const driver = driverByRef.get(f.driverRef);
        if (!driver) return null;
        return { driverId: driver.id, ...f };
      })
      .filter((e): e is NonNullable<typeof e> => e != null);
    if (entrants.length === 0) return null;

    predictions = predictRace(entrants);
  }

  predictions = [...predictions].sort((a, b) => b.winProbability - a.winProbability);

  const rows: PredictionReviewRow[] = predictions.map((p, i) => {
    const actual = actualByDriver.get(p.driverId);
    const predictedRank = i + 1;
    const teamId = teamIdByDriver.get(p.driverId);
    const actualFinish = actual?.status === "finished" ? actual.finishPosition : null;
    return {
      driverId: p.driverId,
      driverName: nameById.get(p.driverId) ?? "Unknown",
      teamName: teamId != null ? teamNameById.get(teamId) ?? null : null,
      predictedRank,
      winProbability: p.winProbability,
      predictedFinish: p.predFinishPosition,
      actualFinish,
      actualStatus: actual?.status ?? null,
      rankError: actualFinish != null ? actualFinish - predictedRank : null,
    };
  });

  const favourite = rows.find((r) => r.predictedRank === 1) ?? null;
  const winnerRowXgb = winnerRow ? rows.find((r) => r.driverId === winnerRow.driverId) ?? null : null;
  const podiumHits = rows.filter((r) => r.predictedRank <= 3 && actualPodiumIds.has(r.driverId)).length;
  const winnerProb = winnerRowXgb?.winProbability ?? null;
  const logLoss = winnerProb != null ? -Math.log(Math.max(winnerProb, LOG_LOSS_FLOOR)) : null;

  return {
    rows,
    favourite,
    winnerPredictedRank: winnerRowXgb?.predictedRank ?? null,
    podiumHits,
    logLoss,
  };
}

/**
 * Builds review rows (everything but rankError, which needs actualFinish
 * paired against predictedRank the same way regardless of source) from a
 * frozen run's stored win probabilities. simulation_results only persists
 * winPct/podiumPct/pointsPct, so predictedFinish can't be recovered here —
 * that's the tradeoff for showing what the model actually said beforehand
 * rather than a value re-derived from scratch.
 */
async function rowsFromFrozen(
  frozen: NonNullable<Awaited<ReturnType<typeof getFrozenPrediction>>>,
  raceId: number,
  actualByDriver: Map<number, { finishPosition: number | null; status: "finished" | "dnf" | "dsq" | null }>,
): Promise<PredictionReviewRow[]> {
  const driverIds = frozen.results.map((r) => r.driverId);
  const nameRows = driverIds.length
    ? await db.select({ id: drivers.id, name: drivers.name }).from(drivers).where(inArray(drivers.id, driverIds))
    : [];
  const nameById = new Map(nameRows.map((d) => [d.id, d.name]));

  const teamRows = await db
    .select({ driverId: raceResults.driverId, teamId: raceResults.teamId })
    .from(raceResults)
    .where(eq(raceResults.raceId, raceId));
  const teamIdByDriver = new Map(teamRows.map((r) => [r.driverId, r.teamId]));
  const allTeamIds = [...new Set(teamRows.map((r) => r.teamId))];
  const teamNameRows = allTeamIds.length
    ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, allTeamIds))
    : [];
  const teamNameById = new Map(teamNameRows.map((t) => [t.id, t.name]));

  const sorted = [...frozen.results].sort((a, b) => (b.winPct ?? 0) - (a.winPct ?? 0));
  return sorted.map((r, i) => {
    const actual = actualByDriver.get(r.driverId);
    const teamId = teamIdByDriver.get(r.driverId);
    return {
      driverId: r.driverId,
      driverName: nameById.get(r.driverId) ?? `Driver ${r.driverId}`,
      teamName: teamId != null ? teamNameById.get(teamId) ?? null : null,
      predictedRank: i + 1,
      winProbability: r.winPct ?? 0,
      predictedFinish: null,
      actualFinish: actual?.status === "finished" ? actual.finishPosition : null,
      actualStatus: actual?.status ?? null,
      rankError: null,
    };
  });
}

/**
 * Prefers the most recent run genuinely made before this race (see
 * getFrozenPrediction) — the honest record of what the model said at the
 * time, unaffected by any tuning since. Only when no such run exists yet
 * does this fall back to re-running the model live against today's ratings
 * and weights (buildSimContext + runSimulation + calibrateOutcome); that
 * fallback is a reconstruction, not a contemporaneous prediction, and
 * `isFrozen` tells the caller which one it got.
 */
export async function buildPredictionReview(
  raceId: number,
  iterations: number = REVIEW_ITERATIONS,
): Promise<PredictionReview | null> {
  const actualRows = await db
    .select({
      driverId: raceResults.driverId,
      finishPosition: raceResults.finishPosition,
      status: raceResults.status,
    })
    .from(raceResults)
    .where(eq(raceResults.raceId, raceId));
  if (actualRows.length === 0) return null; // race hasn't happened yet — nothing to review

  const actualByDriver = new Map(actualRows.map((r) => [r.driverId, r]));
  const winnerRow = actualRows.find((a) => a.status === "finished" && a.finishPosition === 1);
  const actualPodiumIds = new Set(
    actualRows.filter((a) => a.status === "finished" && a.finishPosition != null && a.finishPosition <= 3).map((a) => a.driverId),
  );

  const frozen = await getFrozenPrediction(raceId);

  let rows: PredictionReviewRow[];
  let iterationsUsed: number;
  let hasRealGrid: boolean;
  let isFrozen: boolean;
  let modelVersion: string | null;

  if (frozen) {
    rows = await rowsFromFrozen(frozen, raceId, actualByDriver);
    iterationsUsed = frozen.run.iterationCount;
    hasRealGrid = true; // a pre-race run only exists once the grid/context was buildable
    isFrozen = true;
    modelVersion = frozen.run.modelVersion;
  } else {
    const ctx = await buildSimContext(raceId);
    if (!ctx) return null;

    const outcome = calibrateOutcome(runSimulation(ctx, iterations, { seed: raceId }));

    rows = outcome.drivers.map((d, i) => ({
      driverId: d.driverId,
      driverName: d.driverName,
      teamName: d.teamName,
      predictedRank: i + 1,
      winProbability: d.winPct,
      predictedFinish: d.avgFinishPosition,
      actualFinish: actualByDriver.get(d.driverId)?.status === "finished" ? actualByDriver.get(d.driverId)!.finishPosition : null,
      actualStatus: actualByDriver.get(d.driverId)?.status ?? null,
      rankError: null,
    }));
    iterationsUsed = iterations;
    hasRealGrid = outcome.hasRealGrid;
    isFrozen = false;
    modelVersion = null;
  }

  // rankError depends only on actualFinish vs. predictedRank, which both
  // sources produce identically, so it's computed once here regardless of
  // where the row came from.
  rows = rows.map((r) => ({
    ...r,
    rankError: r.actualFinish != null ? r.actualFinish - r.predictedRank : null,
  }));

  const actualWinner = winnerRow ? rows.find((r) => r.driverId === winnerRow.driverId) ?? null : null;
  const favourite = rows.find((r) => r.predictedRank === 1) ?? null;
  const podiumHits = rows.filter((r) => r.predictedRank <= 3 && actualPodiumIds.has(r.driverId)).length;

  const withError = rows.filter((r) => r.rankError != null);
  const meanAbsRankError = withError.length > 0 ? withError.reduce((sum, r) => sum + Math.abs(r.rankError!), 0) / withError.length : null;

  const winnerProb = actualWinner?.winProbability ?? null;
  const logLoss = winnerProb != null ? -Math.log(Math.max(winnerProb, LOG_LOSS_FLOOR)) : null;

  const xgboost = await buildXgboostReview(raceId, actualByDriver, winnerRow, actualPodiumIds);

  return {
    raceId,
    iterations: iterationsUsed,
    hasRealGrid,
    rows,
    favourite,
    actualWinner,
    winnerPredictedRank: actualWinner?.predictedRank ?? null,
    podiumHits,
    meanAbsRankError,
    logLoss,
    isFrozen,
    modelVersion,
    xgboost,
  };
}
