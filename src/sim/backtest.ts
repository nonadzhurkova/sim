import { db } from "@/db";
import { races, raceResults, driverRatings } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { buildSimContext } from "./entrants";
import { runSimulation, type ModelOverrides } from "./engine";
import { computeBayesianSeasonRatings } from "@/ratings/bayesian/compute";

/**
 * Which pace model backs a backtest run — see the Bayesian model's own doc
 * comment for why it exists. "ensemble" blends the hand-tuned basePace with
 * the Bayesian estimate per driver per race, rather than picking one or the
 * other; see EnsembleWeight below.
 */
export type PaceModel = "current" | "bayesian" | "ensemble";

/** Weight on the hand-tuned basePace in "ensemble" mode; (1 - ensembleWeight) goes to the Bayesian estimate. Ignored for other pace models. */
export const DEFAULT_ENSEMBLE_WEIGHT = 0.5;

/**
 * Backtesting harness: replays the model against races whose real result is
 * already known and scores how close the predictions were.
 *
 * Ratings are stored per-race and were computed from pre-race data only (see
 * compute.ts), so simulating a past race uses no information the model
 * wouldn't have had on race morning — the comparison is honest.
 */

export type RaceBacktest = {
  season: number;
  round: number;
  raceId: number;
  /** Real winner, and the probability the model gave them. */
  actualWinner: string | null;
  winnerProbability: number | null;
  /** Rank the model assigned the actual winner (1 = model's favourite). */
  winnerPredictedRank: number | null;
  /** How many of the model's top 3 actually finished on the podium. */
  podiumHits: number;
  /** Mean |predicted finish - actual finish| over drivers who finished. */
  meanAbsPositionError: number | null;
  /** Spearman rank correlation between predicted and actual finishing order. */
  rankCorrelation: number | null;
  /** -log(P(actual winner)) — the standard proper score for a probabilistic pick. */
  logLoss: number | null;
  driversScored: number;
};

export type CalibrationBucket = {
  label: string;
  /** Mean predicted win probability of picks in this bucket. */
  predicted: number;
  /** Fraction of those picks that actually won. */
  actual: number;
  count: number;
};

export type BacktestSummary = {
  races: RaceBacktest[];
  /** Fraction of races where the model's favourite actually won. */
  top1Accuracy: number;
  /** Fraction where the actual winner was in the model's top 3. */
  top3Accuracy: number;
  meanLogLoss: number;
  meanAbsPositionError: number;
  meanRankCorrelation: number;
  calibration: CalibrationBucket[];
  /** Every (predicted win probability, did they actually win) pair behind `calibration` — raw, unbinned, for fitting a calibration curve against. */
  calibrationPoints: { p: number; won: boolean }[];
};

/** Probability floor so a 0% pick that wins doesn't score -log(0) = Infinity. */
const LOG_LOSS_FLOOR = 1e-4;

type ScorableRace = {
  race: { id: number; season: number; round: number };
  ctx: NonNullable<Awaited<ReturnType<typeof buildSimContext>>>;
  actual: { driverId: number; finishPosition: number | null; status: string | null }[];
};

/**
 * Loads every scorable race of a season (result known, ratings available)
 * once. Separated from scoring so a parameter sweep can reuse the same
 * contexts across dozens of runs instead of re-querying the DB each time —
 * the queries dominate runtime, the simulation itself is fast.
 */
export async function loadScorableRaces(
  season: number,
  paceModel: PaceModel = "current",
  ensembleWeight: number = DEFAULT_ENSEMBLE_WEIGHT,
): Promise<ScorableRace[]> {
  const seasonRaces = await db
    .select({ id: races.id, season: races.season, round: races.round })
    .from(races)
    .where(eq(races.season, season))
    .orderBy(asc(races.round));

  // Computed once for the whole season, not per race: computeBayesianSeasonRatings
  // already walks every race in order internally to get its own no-lookahead
  // guarantee, so calling it per-race would redo that work N times over.
  const bayesianByRace =
    paceModel === "bayesian" || paceModel === "ensemble"
      ? await computeBayesianSeasonRatings(season)
      : null;

  const out: ScorableRace[] = [];
  for (const race of seasonRaces) {
    const actual = await db
      .select({
        driverId: raceResults.driverId,
        finishPosition: raceResults.finishPosition,
        status: raceResults.status,
      })
      .from(raceResults)
      .where(eq(raceResults.raceId, race.id));
    // Only races that actually happened can be scored.
    if (actual.length === 0) continue;

    let basePaceOverride: Map<number, number> | undefined;
    if (paceModel === "bayesian") {
      basePaceOverride = new Map(
        [...bayesianByRace!.get(race.id) ?? []]
          .filter(([, r]) => r.sampleSize > 0)
          .map(([driverId, r]) => [driverId, r.pace] as const),
      );
    } else if (paceModel === "ensemble") {
      // Blend at the rating level (handTuned * w + bayesian * (1-w)) before
      // the one simulation runs, rather than running two full simulations
      // and averaging outputs — see project memory on why blending here.
      const handTunedByDriver = new Map(
        (
          await db
            .select({ driverId: driverRatings.driverId, basePace: driverRatings.basePace })
            .from(driverRatings)
            .where(eq(driverRatings.raceId, race.id))
        )
          .filter((r) => r.basePace != null)
          .map((r) => [r.driverId, r.basePace as number] as const),
      );
      basePaceOverride = new Map(
        [...bayesianByRace!.get(race.id) ?? []]
          .filter(([driverId, r]) => r.sampleSize > 0 && handTunedByDriver.has(driverId))
          .map(([driverId, r]) => [
            driverId,
            ensembleWeight * handTunedByDriver.get(driverId)! + (1 - ensembleWeight) * r.pace,
          ] as const),
      );
    }

    const ctx = await buildSimContext(race.id, undefined, basePaceOverride);
    if (!ctx) continue;
    out.push({ race, ctx, actual });
  }
  return out;
}

export async function backtestSeason(
  season: number,
  iterations = 4000,
  overrides?: ModelOverrides,
  paceModel: PaceModel = "current",
  ensembleWeight: number = DEFAULT_ENSEMBLE_WEIGHT,
): Promise<BacktestSummary> {
  return scoreRaces(await loadScorableRaces(season, paceModel, ensembleWeight), iterations, overrides);
}

export function scoreRaces(
  loaded: ScorableRace[],
  iterations = 4000,
  overrides?: ModelOverrides,
): BacktestSummary {
  const results: RaceBacktest[] = [];
  // (predicted win prob, did they actually win) pairs, for the calibration curve
  const calibrationPoints: { p: number; won: boolean }[] = [];

  for (const { race, ctx, actual } of loaded) {
    const outcome = runSimulation(ctx, iterations, { seed: race.id, overrides });
    const predicted = outcome.drivers;
    if (predicted.length === 0) continue;

    const actualByDriver = new Map(
      actual
        .filter((a) => a.finishPosition != null && a.status === "finished")
        .map((a) => [a.driverId, a.finishPosition as number]),
    );

    const winnerRow = actual.find((a) => a.finishPosition === 1);
    const winnerId = winnerRow?.driverId ?? null;
    const winnerIdx = winnerId != null ? predicted.findIndex((d) => d.driverId === winnerId) : -1;
    const winnerProb = winnerIdx >= 0 ? predicted[winnerIdx].winPct : null;

    // Every simulated driver contributes a calibration point; over many
    // races the model's stated win probabilities should match reality.
    for (const d of predicted) {
      calibrationPoints.push({ p: d.winPct, won: d.driverId === winnerId });
    }

    const actualPodium = new Set(
      actual.filter((a) => a.finishPosition != null && a.finishPosition <= 3).map((a) => a.driverId),
    );
    const podiumHits = predicted.slice(0, 3).filter((d) => actualPodium.has(d.driverId)).length;

    // Position error and rank correlation over drivers who finished and were
    // simulated — DNFs have no meaningful "predicted position" to compare.
    const paired: { pred: number; act: number }[] = [];
    predicted.forEach((d, i) => {
      const act = actualByDriver.get(d.driverId);
      if (act != null) paired.push({ pred: i + 1, act });
    });
    // Re-rank both sides densely so the comparison isn't distorted by gaps
    // where a driver retired or wasn't simulated.
    const predOrder = [...paired].sort((a, b) => a.pred - b.pred);
    const actOrder = [...paired].sort((a, b) => a.act - b.act);
    const predRank = new Map(predOrder.map((p, i) => [p, i + 1]));
    const actRank = new Map(actOrder.map((p, i) => [p, i + 1]));

    let absErrSum = 0;
    let dSquaredSum = 0;
    for (const p of paired) {
      const pr = predRank.get(p)!;
      const ar = actRank.get(p)!;
      absErrSum += Math.abs(pr - ar);
      dSquaredSum += (pr - ar) ** 2;
    }
    const n = paired.length;
    const meanAbsPositionError = n > 0 ? absErrSum / n : null;
    // Spearman's rho; undefined for n < 2.
    const rankCorrelation = n > 1 ? 1 - (6 * dSquaredSum) / (n * (n * n - 1)) : null;

    results.push({
      season: race.season,
      round: race.round,
      raceId: race.id,
      actualWinner: null,
      winnerProbability: winnerProb,
      winnerPredictedRank: winnerIdx >= 0 ? winnerIdx + 1 : null,
      podiumHits,
      meanAbsPositionError,
      rankCorrelation,
      logLoss: winnerProb != null ? -Math.log(Math.max(winnerProb, LOG_LOSS_FLOOR)) : null,
      driversScored: n,
    });
  }

  const scored = results.filter((r) => r.winnerPredictedRank != null);
  const withErr = results.filter((r) => r.meanAbsPositionError != null);
  const withCorr = results.filter((r) => r.rankCorrelation != null);
  const withLoss = results.filter((r) => r.logLoss != null);

  const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  return {
    races: results,
    top1Accuracy: scored.length > 0 ? scored.filter((r) => r.winnerPredictedRank === 1).length / scored.length : 0,
    top3Accuracy: scored.length > 0 ? scored.filter((r) => r.winnerPredictedRank! <= 3).length / scored.length : 0,
    meanLogLoss: mean(withLoss.map((r) => r.logLoss!)),
    meanAbsPositionError: mean(withErr.map((r) => r.meanAbsPositionError!)),
    meanRankCorrelation: mean(withCorr.map((r) => r.rankCorrelation!)),
    calibration: buildCalibration(calibrationPoints),
    calibrationPoints,
  };
}

/**
 * Groups predictions into probability bands and compares stated probability
 * against observed win rate. A well-calibrated model has predicted ≈ actual
 * in every band — the plan's "a driver rated 15% to win should win ~15% of
 * the time" test.
 */
export function buildCalibration(points: { p: number; won: boolean }[]): CalibrationBucket[] {
  const bands: [number, number, string][] = [
    [0, 0.02, "0-2%"],
    [0.02, 0.05, "2-5%"],
    [0.05, 0.1, "5-10%"],
    [0.1, 0.2, "10-20%"],
    [0.2, 0.35, "20-35%"],
    [0.35, 0.6, "35-60%"],
    [0.6, 1.01, "60-100%"],
  ];
  return bands.map(([lo, hi, label]) => {
    const inBand = points.filter((pt) => pt.p >= lo && pt.p < hi);
    return {
      label,
      predicted: inBand.length > 0 ? inBand.reduce((s, pt) => s + pt.p, 0) / inBand.length : 0,
      actual: inBand.length > 0 ? inBand.filter((pt) => pt.won).length / inBand.length : 0,
      count: inBand.length,
    };
  });
}

/** Resolves driver names for a finished backtest, for readable reporting. */
export async function attachWinnerNames(summary: BacktestSummary): Promise<BacktestSummary> {
  const { drivers } = await import("@/db/schema");
  for (const r of summary.races) {
    const [winner] = await db
      .select({ name: drivers.name })
      .from(raceResults)
      .innerJoin(drivers, eq(raceResults.driverId, drivers.id))
      .where(and(eq(raceResults.raceId, r.raceId), eq(raceResults.finishPosition, 1)));
    r.actualWinner = winner?.name ?? null;
  }
  return summary;
}
