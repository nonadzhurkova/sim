import { db } from "@/db";
import { races, raceResults, drivers } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import { buildSimContext } from "./entrants";
import { runSimulation } from "./engine";
import { buildXgboostFeatures } from "./xgboost-features";
import { predictRace as predictXgboostRace, xgboostModelAvailable } from "./xgboost-model";
import { buildCalibration, LOG_LOSS_FLOOR, type CalibrationBucket } from "./backtest";
import { getStandings } from "@/queries/standings";

/**
 * Shared evaluation harness: scores the Monte Carlo model and the XGBoost
 * overlay on exactly the same races, the same way, alongside three
 * reference baselines. This is the one honest, repeatable benchmark for
 * comparing the two models and telling a real improvement from noise --
 * see README's "Evaluation harness" section for how to run it and read the
 * bootstrap output.
 *
 * Infrastructure only: this file does not change PACE_WEIGHTS, engine
 * constants, WIN_PROBABILITY_CALIBRATION, or scripts/xgboost/model/model.json.
 * It reuses backtest.ts's buildCalibration/LOG_LOSS_FLOOR and entrants.ts's
 * buildSimContext/runSimulation rather than reimplementing them, so a fix to
 * either stays in one place.
 */

export type EvalMode = "real-grid" | "pre-quali";
export type EvalModelName = "monte-carlo" | "monte-carlo-raw" | "xgboost" | "xgboost-raw" | "uniform" | "grid-baseline" | "standings-baseline";

/** One race's actual result, keyed by driverId -- shared shape every model/baseline is scored against. */
export type ActualResult = { driverId: number; finishPosition: number | null; status: string | null; gridPosition: number | null };

/** One model's prediction for one race: a win probability per driver, already normalized to sum to 1 across the field it actually predicted. */
export type ModelRacePrediction = {
  raceId: number;
  season: number;
  round: number;
  /** driverId -> win probability. Only drivers this model actually predicted are present -- see "race set" rules in evaluateModels. */
  winProbByDriver: Map<number, number>;
  /**
   * driverId -> predicted finishing position (Monte Carlo: avgFinishPosition,
   * the mean across iterations; XGBoost: predFinishPosition). Lower is
   * better. Used for rank correlation instead of win-probability rank, since
   * win probability collapses most of the field to near-identical long-shot
   * odds and isn't meant to convey their relative order -- a model can be
   * well calibrated on who wins while saying nothing useful about 8th vs
   * 9th. Baselines that only produce a win probability (uniform, grid,
   * standings) leave this undefined; rank correlation is then reported as
   * null for that model, not silently computed off win-probability rank.
   */
  expectedPositionByDriver?: Map<number, number>;
};

export type PerRaceScore = {
  raceId: number;
  season: number;
  round: number;
  winnerId: number | null;
  winnerGridPosition: number | null;
  winnerProb: number | null;
  winnerRank: number | null;
  logLoss: number | null;
  brier: number;
  top1: boolean | null;
  top3: boolean | null;
  rankCorrelation: number | null;
  driversScored: number;
  /** (predicted win probability, did they actually win) for every driver scored this race -- not just the winner's own pick. Feeds buildCalibration so the calibration curve reflects the whole field, same convention as backtest.ts's scoreRaces. */
  calibrationPoints: { p: number; won: boolean }[];
};

export type ModelSummary = {
  model: EvalModelName;
  mode: EvalMode;
  season: number | "pooled";
  raceCount: number;
  meanLogLoss: number;
  meanBrier: number;
  top1Accuracy: number;
  top3Accuracy: number;
  meanRankCorrelation: number;
  calibration: CalibrationBucket[];
  perRace: PerRaceScore[];
  /** Worst 3 races by log loss (lowest probability given to the actual winner), so outliers are visible in every report instead of buried in perRace. */
  worstRaces: { raceId: number; season: number; round: number; winnerId: number | null; winnerGridPosition: number | null; winnerProb: number | null; logLoss: number | null }[];
};

/** A completed race, with its actual result, for one evaluation season. */
export type EvalRace = { id: number; season: number; round: number };

/**
 * Every completed race of `season`, in round order -- the pool a fold draws
 * its scorable races from before per-model/per-mode filtering narrows it.
 * Exported for standalone scripts (e.g. eval-blend-run.ts) that need the
 * same race set evaluateModels uses without going through its full
 * multi-model orchestration.
 */
export async function loadCompletedRaces(season: number): Promise<EvalRace[]> {
  const seasonRaces = await db
    .select({ id: races.id, season: races.season, round: races.round })
    .from(races)
    .where(eq(races.season, season))
    .orderBy(asc(races.round));

  const out: EvalRace[] = [];
  for (const race of seasonRaces) {
    const [hasResult] = await db.select({ id: raceResults.id }).from(raceResults).where(eq(raceResults.raceId, race.id)).limit(1);
    if (hasResult) out.push(race);
  }
  return out;
}

export async function loadActualResults(raceId: number): Promise<ActualResult[]> {
  return db
    .select({
      driverId: raceResults.driverId,
      finishPosition: raceResults.finishPosition,
      status: raceResults.status,
      gridPosition: raceResults.gridPosition,
    })
    .from(raceResults)
    .where(eq(raceResults.raceId, raceId));
}

// ============================================================================
// Monte Carlo model
// ============================================================================

/**
 * Predicts every completed race of `season` with the current production
 * Monte Carlo model (no per-fold refit -- its params were tuned against
 * these same seasons, a known bias in its favour, called out in the report).
 * `mode: "pre-quali"` forces a simulated grid via buildSimContext's
 * forceSimulatedGrid, mirroring what the model would have predicted before
 * qualifying; `"real-grid"` uses the race's actual grid.
 */
export async function predictMonteCarlo(
  completedRaces: EvalRace[],
  mode: EvalMode,
  iterations: number,
  seed: number,
): Promise<ModelRacePrediction[]> {
  const out: ModelRacePrediction[] = [];
  for (const race of completedRaces) {
    const ctx = await buildSimContext(race.id, undefined, undefined, false, mode === "pre-quali");
    if (!ctx) continue;
    const outcome = runSimulation(ctx, iterations, { seed: seed + race.id });
    const winProbByDriver = new Map(outcome.drivers.map((d) => [d.driverId, d.winPct]));
    const expectedPositionByDriver = new Map(
      outcome.drivers.filter((d) => d.avgFinishPosition != null).map((d) => [d.driverId, d.avgFinishPosition as number]),
    );
    out.push({ raceId: race.id, season: race.season, round: race.round, winProbByDriver, expectedPositionByDriver });
  }
  return out;
}

// ============================================================================
// XGBoost model
// ============================================================================

/**
 * Predicts every completed race of `season` with a fold-specific XGBoost
 * model (trained on seasons strictly before `season` -- see
 * scripts/xgboost/train.py's --train-until). `useRaw` reports the raw
 * (pre-Platt) win probability instead of the model's own calibrated one --
 * xgboost-model.ts's predictRace computes both from one pass, so this is
 * just which field to read, not a second inference.
 *
 * XGBoost has no pre-quali mode: buildXgboostFeatures needs a real grid
 * (see that file's own doc comment), so mode: "pre-quali" always returns an
 * empty list here -- the caller reports this model/mode combination as n/a.
 */
export async function predictXgboost(
  completedRaces: EvalRace[],
  mode: EvalMode,
  foldModelPath: string,
  useRaw: boolean,
): Promise<ModelRacePrediction[]> {
  if (mode === "pre-quali") return [];
  if (!xgboostModelAvailable(foldModelPath)) return [];

  const driverRows = await db.select({ id: drivers.id, externalRef: drivers.externalRef }).from(drivers);
  const driverIdByRef = new Map(driverRows.map((d) => [d.externalRef, d.id]));

  const out: ModelRacePrediction[] = [];
  for (const race of completedRaces) {
    const features = await buildXgboostFeatures(race.id);
    if (!features) continue;

    const entrants = features
      .map((f) => {
        const driverId = driverIdByRef.get(f.driverRef);
        if (driverId == null) return null;
        return { driverId, ...f };
      })
      .filter((e): e is NonNullable<typeof e> => e != null);
    if (entrants.length === 0) continue;

    const predictions = predictXgboostRace(entrants, foldModelPath);
    const winProbByDriver = new Map(
      predictions.map((p) => [p.driverId, useRaw ? p.rawWinProbability : p.winProbability]),
    );
    const expectedPositionByDriver = new Map(predictions.map((p) => [p.driverId, p.predFinishPosition]));
    out.push({ raceId: race.id, season: race.season, round: race.round, winProbByDriver, expectedPositionByDriver });
  }
  return out;
}

// ============================================================================
// Baselines
// ============================================================================

/** Uniform 1/N for every driver actually in the field that race. */
export function predictUniform(completedRaces: EvalRace[], fieldSizeByRaceId: Map<number, number[]>): ModelRacePrediction[] {
  const out: ModelRacePrediction[] = [];
  for (const race of completedRaces) {
    const driverIds = fieldSizeByRaceId.get(race.id);
    if (!driverIds || driverIds.length === 0) continue;
    const p = 1 / driverIds.length;
    out.push({ raceId: race.id, season: race.season, round: race.round, winProbByDriver: new Map(driverIds.map((id) => [id, p])) });
  }
  return out;
}

/**
 * Minimal CSV line splitter for data/historical/*.csv: every field this
 * function reads (raceId, year, grid, positionOrder) is a plain unquoted
 * number, so a naive split on "," is safe here -- the quoted fields in
 * these files (race name, URL) are in columns this never touches.
 */
function parseCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf-8").trim();
  const lines = text.split("\n");
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

let historicalGridResultsCache: { raceId: number; year: number; grid: number | null; won: boolean }[] | null = null;

/**
 * Loads grid/win outcomes from data/historical/ (results.csv joined with
 * races.csv on raceId) -- used instead of the live DB because the app has
 * only ingested 2024-2026, which would leave the grid baseline with zero
 * training data for the 2024 test season ("seasons strictly before 2024"
 * is empty in the live DB). The historical CSVs cover 2007-2026 (see
 * scripts/xgboost/build_features.py), the same source scripts/xgboost/
 * train.py trains on, so this baseline gets real pre-2024 history the same
 * way the XGBoost overlay does. Read-only, training-data use only -- see
 * that file's own doc comment on why these CSVs are never touched at
 * prediction time for the production app.
 */
function loadHistoricalGridResults(): typeof historicalGridResultsCache {
  if (historicalGridResultsCache) return historicalGridResultsCache;
  const dataDir = join(process.cwd(), "data", "historical");
  const racesRows = parseCsv(join(dataDir, "races.csv"));
  const yearByRaceId = new Map(racesRows.map((r) => [parseInt(r.raceId, 10), parseInt(r.year, 10)]));

  const resultsRows = parseCsv(join(dataDir, "results.csv"));
  historicalGridResultsCache = resultsRows.map((r) => {
    const raceId = parseInt(r.raceId, 10);
    const gridRaw = parseInt(r.grid, 10);
    return {
      raceId,
      year: yearByRaceId.get(raceId) ?? 0,
      grid: Number.isFinite(gridRaw) && gridRaw > 0 ? gridRaw : null,
      // positionOrder is the DNF-last-ordered finish position (see
      // build_features.py) -- 1 means the actual race winner.
      won: parseInt(r.positionOrder, 10) === 1,
    };
  });
  return historicalGridResultsCache;
}

/**
 * Win probability by starting grid slot, fit from historical win rates
 * per grid position using only seasons strictly before `season` (no
 * lookahead) -- a simple, honest reference for "how much does the model
 * beat just knowing where everyone starts." Sourced from data/historical/
 * (2007-2026) rather than the live DB (2024-2026 only) -- see
 * loadHistoricalGridResults's own doc comment.
 */
function fitGridPositionWinRates(beforeSeason: number): Map<number, number> {
  const rows = loadHistoricalGridResults()!.filter((r) => r.year < beforeSeason);

  const winsByGrid = new Map<number, number>();
  const startsByGrid = new Map<number, number>();
  for (const r of rows) {
    if (r.grid == null) continue;
    startsByGrid.set(r.grid, (startsByGrid.get(r.grid) ?? 0) + 1);
    if (r.won) winsByGrid.set(r.grid, (winsByGrid.get(r.grid) ?? 0) + 1);
  }

  const rates = new Map<number, number>();
  for (const [grid, starts] of startsByGrid) {
    rates.set(grid, (winsByGrid.get(grid) ?? 0) / starts);
  }
  return rates;
}

/**
 * Grid-position baseline for real-grid mode: each driver's win probability
 * is that grid slot's historical win rate (seasons < this race's season),
 * renormalized across the actual field so probabilities sum to 1. A grid
 * slot with no historical data (rare, very back of a larger-than-usual
 * grid) falls back to a small floor rather than 0, so a genuine outsider
 * winning doesn't score -log(0).
 */
export async function predictGridBaseline(completedRaces: EvalRace[]): Promise<ModelRacePrediction[]> {
  const ratesBySeasonCutoff = new Map<number, Map<number, number>>();
  const out: ModelRacePrediction[] = [];

  for (const race of completedRaces) {
    if (!ratesBySeasonCutoff.has(race.season)) {
      ratesBySeasonCutoff.set(race.season, fitGridPositionWinRates(race.season));
    }
    const rates = ratesBySeasonCutoff.get(race.season)!;

    const gridRows = await db
      .select({ driverId: raceResults.driverId, gridPosition: raceResults.gridPosition })
      .from(raceResults)
      .where(eq(raceResults.raceId, race.id));
    const validGrid = gridRows.filter((g) => g.gridPosition != null && g.gridPosition > 0) as { driverId: number; gridPosition: number }[];
    if (validGrid.length === 0) continue;

    const floor = 1e-3;
    const raw = validGrid.map((g) => Math.max(rates.get(g.gridPosition) ?? floor, floor));
    const sum = raw.reduce((a, b) => a + b, 0);
    const winProbByDriver = new Map(validGrid.map((g, i) => [g.driverId, raw[i] / sum]));
    out.push({ raceId: race.id, season: race.season, round: race.round, winProbByDriver });
  }
  return out;
}

/**
 * Standings baseline: win probability proportional to points scored before
 * this race (getStandings(season, round - 1)), with a small floor so a
 * driver with 0 points so far isn't assigned exactly 0 (a rookie's first
 * race, or an early-season race before anyone has scored, would otherwise
 * either divide by zero or unfairly rule out the whole field).
 */
export async function predictStandingsBaseline(completedRaces: EvalRace[]): Promise<ModelRacePrediction[]> {
  const out: ModelRacePrediction[] = [];
  const standingsCache = new Map<string, Awaited<ReturnType<typeof getStandings>>>();

  for (const race of completedRaces) {
    const key = `${race.season}:${race.round - 1}`;
    if (!standingsCache.has(key)) {
      standingsCache.set(key, await getStandings(race.season, race.round > 1 ? race.round - 1 : 0));
    }
    const standings = standingsCache.get(key)!;

    const gridRows = await db.select({ driverId: raceResults.driverId }).from(raceResults).where(eq(raceResults.raceId, race.id));
    const fieldIds = new Set(gridRows.map((r) => r.driverId));
    if (fieldIds.size === 0) continue;

    const floor = 1;
    const pointsById = new Map(standings.drivers.map((d) => [d.driverId, d.points]));
    const raw = [...fieldIds].map((id) => Math.max(pointsById.get(id) ?? 0, 0) + floor);
    const sum = raw.reduce((a, b) => a + b, 0);
    const winProbByDriver = new Map([...fieldIds].map((id, i) => [id, raw[i] / sum]));
    out.push({ raceId: race.id, season: race.season, round: race.round, winProbByDriver });
  }
  return out;
}

// ============================================================================
// Probability floor experiment (eval-only -- see eval-floor-run.ts)
// ============================================================================

/**
 * p' = (1 - eps) * p + eps / N applied per race, N = the number of drivers
 * this model actually predicted that race (not the full grid size -- a
 * model that already excludes some drivers shouldn't have the floor
 * computed against a field it never scored). eps=0 is a no-op copy, so
 * callers can treat this as a strict superset of the original predictions
 * rather than special-casing eps=0. expectedPositionByDriver passes through
 * unchanged -- the floor only touches win probability, not predicted
 * finishing order.
 */
export function applyProbabilityFloor(predictions: ModelRacePrediction[], eps: number): ModelRacePrediction[] {
  if (eps === 0) return predictions;
  return predictions.map((pred) => {
    const n = pred.winProbByDriver.size;
    const floored = new Map([...pred.winProbByDriver].map(([id, p]) => [id, (1 - eps) * p + eps / n]));
    return { ...pred, winProbByDriver: floored };
  });
}

// ============================================================================
// MC + XGBoost blend (eval-only -- see eval-blend-run.ts)
// ============================================================================

/**
 * blendWinPct[driver] = alpha * mcWinPct[driver] + (1-alpha) * xgbWinPct[driver],
 * renormalized to sum to 1 across the field. Only races present in BOTH
 * predictions are blended -- a driver present in one model's map but not
 * the other (shouldn't happen once both are scored against the shared race
 * set, but this function doesn't assume that) is dropped rather than
 * silently getting the other model's full weight. expectedPositionByDriver
 * is taken from the Monte Carlo side unchanged -- rank correlation isn't
 * part of this experiment, and blending two different notions of
 * "predicted position" (mean simulated finish vs a regression output) isn't
 * something alpha meaningfully controls.
 */
export function blendPredictions(mc: ModelRacePrediction[], xgb: ModelRacePrediction[], alpha: number): ModelRacePrediction[] {
  const xgbByRaceId = new Map(xgb.map((p) => [p.raceId, p]));
  const out: ModelRacePrediction[] = [];
  for (const mcPred of mc) {
    const xgbPred = xgbByRaceId.get(mcPred.raceId);
    if (!xgbPred) continue;

    const driverIds = [...mcPred.winProbByDriver.keys()].filter((id) => xgbPred.winProbByDriver.has(id));
    if (driverIds.length === 0) continue;

    const raw = driverIds.map((id) => alpha * mcPred.winProbByDriver.get(id)! + (1 - alpha) * xgbPred.winProbByDriver.get(id)!);
    const sum = raw.reduce((a, b) => a + b, 0);
    const winProbByDriver = new Map(driverIds.map((id, i) => [id, raw[i] / sum]));

    out.push({
      raceId: mcPred.raceId,
      season: mcPred.season,
      round: mcPred.round,
      winProbByDriver,
      expectedPositionByDriver: mcPred.expectedPositionByDriver,
    });
  }
  return out;
}

// ============================================================================
// Scoring
// ============================================================================

/** Spearman rank correlation over drivers who finished and were predicted -- same method as backtest.ts's scoreRaces. */
function rankCorrelationOf(predOrder: { driverId: number; rank: number }[], actualByDriver: Map<number, number>): number | null {
  const paired = predOrder
    .map((p) => ({ pred: p.rank, act: actualByDriver.get(p.driverId) }))
    .filter((p): p is { pred: number; act: number } => p.act != null);
  const n = paired.length;
  if (n < 2) return null;

  const predRankOf = new Map([...paired].sort((a, b) => a.pred - b.pred).map((p, i) => [p, i + 1]));
  const actRankOf = new Map([...paired].sort((a, b) => a.act - b.act).map((p, i) => [p, i + 1]));
  let dSquaredSum = 0;
  for (const p of paired) {
    const pr = predRankOf.get(p)!;
    const ar = actRankOf.get(p)!;
    dSquaredSum += (pr - ar) ** 2;
  }
  return 1 - (6 * dSquaredSum) / (n * (n * n - 1));
}

/**
 * Scores one model's predictions against actual results, race by race.
 * `raceIds` restricts scoring to the shared race set (see evaluateModels) --
 * a model may have predicted more races than that, but only the shared set
 * counts toward a fair comparison.
 */
export function scoreModel(
  predictions: ModelRacePrediction[],
  actualByRaceId: Map<number, ActualResult[]>,
  raceIds: Set<number>,
): PerRaceScore[] {
  const out: PerRaceScore[] = [];
  for (const pred of predictions) {
    if (!raceIds.has(pred.raceId)) continue;
    const actual = actualByRaceId.get(pred.raceId);
    if (!actual) continue;

    const winnerRow = actual.find((a) => a.finishPosition === 1);
    const winnerId = winnerRow?.driverId ?? null;
    const winnerGridPosition = winnerRow?.gridPosition ?? null;

    // Tie-break by driverId, not insertion order: a uniform (or
    // near-uniform) baseline assigns every driver the same probability, and
    // an unstable/insertion-order tiebreak would silently leak whatever
    // order winProbByDriver happened to be built in (which, for a baseline
    // built from a DB query with no ORDER BY, can correlate with finishing
    // order well above chance -- caught by this exact bug during
    // development, where "uniform"'s rank correlation matched the real
    // model's). driverId has no relationship to a race's outcome, so this
    // tiebreak can't leak anything.
    const ranked = [...pred.winProbByDriver.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const winnerRank = winnerId != null ? ranked.findIndex(([id]) => id === winnerId) + 1 || null : null;
    const winnerProb = winnerId != null ? pred.winProbByDriver.get(winnerId) ?? null : null;

    const logLoss = winnerProb != null ? -Math.log(Math.max(winnerProb, LOG_LOSS_FLOOR)) : null;
    const brier = ranked.reduce((sum, [id, p]) => sum + (id === winnerId ? (p - 1) ** 2 : p ** 2), 0);

    const actualByDriver = new Map(
      actual.filter((a) => a.finishPosition != null && a.status === "finished").map((a) => [a.driverId, a.finishPosition as number]),
    );
    // Rank correlation compares predicted *finishing order* against actual
    // finishing order -- expectedPositionByDriver (mean simulated finish for
    // Monte Carlo, predFinishPosition for XGBoost), not win-probability rank.
    // A model with no notion of finishing order (the baselines) reports null
    // here rather than a misleading rank derived from win odds.
    let rankCorrelation: number | null = null;
    if (pred.expectedPositionByDriver) {
      const posMap = pred.expectedPositionByDriver;
      const predOrder = [...posMap.entries()]
        .sort((a, b) => a[1] - b[1] || a[0] - b[0])
        .map(([driverId], i) => ({ driverId, rank: i + 1 }));
      rankCorrelation = rankCorrelationOf(predOrder, actualByDriver);
    }

    const calibrationPoints = ranked.map(([id, p]) => ({ p, won: id === winnerId }));

    out.push({
      raceId: pred.raceId,
      season: pred.season,
      round: pred.round,
      winnerId,
      winnerGridPosition,
      winnerProb,
      winnerRank,
      logLoss,
      brier,
      top1: winnerRank != null ? winnerRank === 1 : null,
      top3: winnerRank != null ? winnerRank <= 3 : null,
      rankCorrelation,
      driversScored: ranked.length,
      calibrationPoints,
    });
  }
  return out;
}

export function summarizeScores(model: EvalModelName, mode: EvalMode, season: number | "pooled", perRace: PerRaceScore[]): ModelSummary {
  const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const withLoss = perRace.filter((r) => r.logLoss != null);
  const withTop1 = perRace.filter((r) => r.top1 != null);
  const withCorr = perRace.filter((r) => r.rankCorrelation != null);
  // One calibration point per driver scored per race (not just the winner's
  // pick), same convention as backtest.ts's scoreRaces -- a driver given 15%
  // should win about 15% of the time, and that only shows up if every
  // driver's (probability, did they win) pair is counted, not just winners'.
  const calibrationPoints = perRace.flatMap((r) => r.calibrationPoints);

  return {
    model,
    mode,
    season,
    raceCount: perRace.length,
    meanLogLoss: mean(withLoss.map((r) => r.logLoss!)),
    meanBrier: mean(perRace.map((r) => r.brier)),
    top1Accuracy: withTop1.length > 0 ? withTop1.filter((r) => r.top1).length / withTop1.length : 0,
    top3Accuracy: withTop1.length > 0 ? withTop1.filter((r) => r.top3).length / withTop1.length : 0,
    meanRankCorrelation: mean(withCorr.map((r) => r.rankCorrelation!)),
    calibration: buildCalibration(calibrationPoints),
    perRace,
    worstRaces: [...withLoss]
      .sort((a, b) => b.logLoss! - a.logLoss!)
      .slice(0, 3)
      .map((r) => ({
        raceId: r.raceId,
        season: r.season,
        round: r.round,
        winnerId: r.winnerId,
        winnerGridPosition: r.winnerGridPosition,
        winnerProb: r.winnerProb,
        logLoss: r.logLoss,
      })),
  };
}

// ============================================================================
// Bootstrap: is a difference real?
// ============================================================================

export type BootstrapResult = {
  meanDiff: number;
  ci95: [number, number];
  significant: boolean;
  n: number;
};

/** mulberry32 -- same generator as random.ts, kept local so this file has no engine-noise coupling to the simulation's own RNG usage. */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paired bootstrap over races: resamples the same set of races (with
 * replacement) `resamples` times, and each time computes mean(scoreA -
 * scoreB) over the resampled races. Returns the mean difference and a 95%
 * percentile interval across resamples. Races are the resampling unit (not
 * drivers), since a race's per-driver predictions aren't independent draws.
 *
 * "Significant" means the 95% interval excludes 0 -- the usual, if blunt,
 * bootstrap significance rule. At the race counts here (a season is
 * 14-24 races), a single-season comparison should be read as suggestive,
 * not conclusive; the pooled 2024+2025+2026 comparison is the one with
 * enough races for this interval to mean much.
 */
export function pairedBootstrap(
  scoresA: Map<number, number>,
  scoresB: Map<number, number>,
  options: { resamples?: number; seed?: number } = {},
): BootstrapResult {
  const { resamples = 5000, seed = 1 } = options;
  const sharedRaceIds = [...scoresA.keys()].filter((id) => scoresB.has(id));
  const n = sharedRaceIds.length;
  if (n === 0) return { meanDiff: 0, ci95: [0, 0], significant: false, n: 0 };

  const diffs = sharedRaceIds.map((id) => scoresA.get(id)! - scoresB.get(id)!);
  const rng = createRng(seed);
  const bootstrapMeans: number[] = [];
  for (let i = 0; i < resamples; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      sum += diffs[idx];
    }
    bootstrapMeans.push(sum / n);
  }
  bootstrapMeans.sort((a, b) => a - b);

  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n;
  const lo = bootstrapMeans[Math.floor(0.025 * resamples)];
  const hi = bootstrapMeans[Math.ceil(0.975 * resamples) - 1];
  return { meanDiff, ci95: [lo, hi], significant: !(lo <= 0 && hi >= 0), n };
}

/** Extracts per-race log loss as a Map<raceId, logLoss>, dropping races with no loss (no known winner or model didn't predict it). */
export function logLossMap(perRace: PerRaceScore[]): Map<number, number> {
  return new Map(perRace.filter((r) => r.logLoss != null).map((r) => [r.raceId, r.logLoss!]));
}

// ============================================================================
// Top-level orchestration
// ============================================================================

export type EvaluateOptions = {
  seasons: number[];
  modes: EvalMode[];
  iterations: number;
  seed: number;
  /** Fold model paths by season, e.g. { 2025: "scripts/xgboost/model/fold-2025.json" }. Missing entries mean XGBoost is skipped for that season. */
  xgboostFoldPaths: Map<number, string>;
  /**
   * Eval-only probability floor experiment (see eval-floor-run.ts):
   * p' = (1 - eps) * p + eps / N, applied to Monte Carlo's and XGBoost's
   * (raw and calibrated) win probabilities before scoring -- not to the
   * baselines, which the experiment isn't about. undefined/0 is a no-op, so
   * the default evaluateModels() call (no floor option passed) behaves
   * exactly as before this option existed.
   */
  probabilityFloor?: number;
};

export type EvaluateResult = {
  bySeasonAndMode: Map<string, Map<EvalModelName, ModelSummary>>;
  pooledByMode: Map<EvalMode, Map<EvalModelName, ModelSummary>>;
  excludedRaces: { season: number; round: number; raceId: number; reason: string }[];
};

/**
 * Runs every model + baseline against every requested season/mode, applies
 * the "score only races every evaluated model can predict in that mode"
 * rule, and returns per-season and pooled summaries. XGBoost is silently
 * skipped (reported as n/a, not an excluded race) for pre-quali mode and
 * for any season with no fold model path supplied.
 */
export async function evaluateModels(options: EvaluateOptions): Promise<EvaluateResult> {
  const bySeasonAndMode = new Map<string, Map<EvalModelName, ModelSummary>>();
  const pooledPerRaceByMode = new Map<EvalMode, Map<EvalModelName, PerRaceScore[]>>();
  const excludedRaces: EvaluateResult["excludedRaces"] = [];

  for (const mode of options.modes) {
    pooledPerRaceByMode.set(mode, new Map());

    for (const season of options.seasons) {
      const completedRaces = await loadCompletedRaces(season);
      const actualByRaceId = new Map<number, ActualResult[]>();
      for (const race of completedRaces) actualByRaceId.set(race.id, await loadActualResults(race.id));

      const fieldByRaceId = new Map(completedRaces.map((r) => [r.id, actualByRaceId.get(r.id)!.map((a) => a.driverId)]));

      const eps = options.probabilityFloor ?? 0;
      const mcPredictions = applyProbabilityFloor(
        await predictMonteCarlo(completedRaces, mode, options.iterations, options.seed),
        eps,
      );
      const foldPath = options.xgboostFoldPaths.get(season);
      const xgbPredictions = foldPath
        ? applyProbabilityFloor(await predictXgboost(completedRaces, mode, foldPath, false), eps)
        : [];
      const xgbRawPredictions = foldPath
        ? applyProbabilityFloor(await predictXgboost(completedRaces, mode, foldPath, true), eps)
        : [];
      const uniformPredictions = predictUniform(completedRaces, fieldByRaceId);
      const gridPredictions = mode === "real-grid" ? await predictGridBaseline(completedRaces) : [];
      // Standings baseline doesn't touch the grid at all (points scored
      // before this race), so it's active in both modes -- pre-quali mode
      // gains a second reference point besides uniform.
      const standingsPredictions = await predictStandingsBaseline(completedRaces);

      // Shared race set: only races every model that's actually active in
      // this mode managed to predict. XGBoost's absence in pre-quali mode
      // (or a season with no fold model) does not narrow the set -- it's
      // reported as n/a for that combination, not used to exclude MC/
      // baseline races that XGBoost simply has no opinion on this mode. The
      // mode check here matters: XGBoost is only "active" (and only gates
      // the shared set) in real-grid mode -- predictXgboost always returns
      // [] for pre-quali (it has no pre-quali mode at all, see that
      // function's own doc comment), so gating on foldPath alone would
      // intersect every mode's shared set against an always-empty XGBoost
      // set in pre-quali, emptying it out entirely.
      const xgboostActive = mode === "real-grid" && !!foldPath;
      const activePredictionSets = [mcPredictions, uniformPredictions, standingsPredictions];
      if (xgboostActive) activePredictionSets.push(xgbPredictions);
      if (mode === "real-grid") activePredictionSets.push(gridPredictions);

      const raceIdSets = activePredictionSets.map((preds) => new Set(preds.map((p) => p.raceId)));
      const sharedRaceIds = new Set(completedRaces.map((r) => r.id).filter((id) => raceIdSets.every((s) => s.has(id))));

      for (const race of completedRaces) {
        if (sharedRaceIds.has(race.id)) continue;
        const reasons: string[] = [];
        if (!mcPredictions.some((p) => p.raceId === race.id)) reasons.push("Monte Carlo: no sim context");
        if (xgboostActive && !xgbPredictions.some((p) => p.raceId === race.id)) reasons.push("XGBoost: no grid/features available");
        if (mode === "real-grid" && !gridPredictions.some((p) => p.raceId === race.id)) reasons.push("grid baseline: no valid grid");
        if (!standingsPredictions.some((p) => p.raceId === race.id)) reasons.push("standings baseline: no field");
        excludedRaces.push({ season, round: race.round, raceId: race.id, reason: reasons.join("; ") || "excluded from shared race set" });
      }

      const modelResults: [EvalModelName, ModelRacePrediction[]][] = [
        ["monte-carlo", mcPredictions],
        ["uniform", uniformPredictions],
        ["standings-baseline", standingsPredictions],
      ];
      if (mode === "real-grid") {
        modelResults.push(["grid-baseline", gridPredictions]);
      }
      if (foldPath) {
        modelResults.push(["xgboost", xgbPredictions], ["xgboost-raw", xgbRawPredictions]);
      }

      const key = `${season}:${mode}`;
      const perModeSummaries = new Map<EvalModelName, ModelSummary>();
      for (const [modelName, predictions] of modelResults) {
        const perRace = scoreModel(predictions, actualByRaceId, sharedRaceIds);
        perModeSummaries.set(modelName, summarizeScores(modelName, mode, season, perRace));

        const pooledMap = pooledPerRaceByMode.get(mode)!;
        pooledMap.set(modelName, [...(pooledMap.get(modelName) ?? []), ...perRace]);
      }
      bySeasonAndMode.set(key, perModeSummaries);
    }
  }

  const pooledByMode = new Map<EvalMode, Map<EvalModelName, ModelSummary>>();
  for (const [mode, perModel] of pooledPerRaceByMode) {
    const summaries = new Map<EvalModelName, ModelSummary>();
    for (const [modelName, perRace] of perModel) {
      summaries.set(modelName, summarizeScores(modelName, mode, "pooled", perRace));
    }
    pooledByMode.set(mode, summaries);
  }

  return { bySeasonAndMode, pooledByMode, excludedRaces };
}
