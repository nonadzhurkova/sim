import { db } from "@/db";
import { raceResults, qualifyingResults, drivers, teams, circuits, races, xgboostPredictions } from "@/db/schema";
import { eq, inArray, and, desc } from "drizzle-orm";
import { buildSimContext } from "@/sim/entrants";
import { runSimulation } from "@/sim/engine";
import { calibrateOutcome, getFrozenPrediction } from "@/sim/run-simulation";
import { buildXgboostFeatures } from "@/sim/xgboost-features";
import { predictRace, xgboostModelAvailable } from "@/sim/xgboost-model";
import { BLEND_ALPHA } from "@/sim/params";

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
  /** Pre-Platt-calibration win probability. Only set on xgboost review rows -- what the production blend (BLEND_ALPHA) actually uses, since XGBoost's own Platt fit was dropped (see README). */
  rawWinProbability?: number;
  /**
   * The model's own per-driver DNF probability, when available. Monte Carlo
   * rows only have this when reconstructed live (DriverOutcome.dnfPct) --
   * a genuinely frozen run only stored winPct/podiumPct/pointsPct, so this
   * is null for a frozen row, not a bug. XGBoost rows always have it
   * (predDnfProb is stored/computed either way).
   */
  predictedDnfProbability: number | null;
  /**
   * True when this driver's actual starting grid position differs from
   * their qualifying classification -- a grid penalty or pit-lane start,
   * the one concretely knowable reason a prediction (built from qualifying
   * form) can miss without it being the model's fault. Null when either
   * position is unknown.
   */
  startedOutOfPosition: boolean | null;
  /** This driver's actual starting grid position for the race, when known. */
  gridPosition: number | null;
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
  /**
   * The production prediction (BLEND_ALPHA*mc + (1-BLEND_ALPHA)*xgbRaw,
   * renormalized) scored the same way as the two parent models above. Null
   * when xgboost is null (no frozen/live XGBoost prediction for this race)
   * -- there's nothing to blend, and the production prediction for this race
   * actually was pure Monte Carlo (see run-simulation.ts's
   * freezeXgboostPrediction), so showing a reconstructed blend here would be
   * showing something that was never actually served.
   */
  blended: {
    rows: (PredictionReviewRow & { closerModel: "monte-carlo" | "xgboost" | "tie" | null })[];
    favourite: PredictionReviewRow | null;
    winnerPredictedRank: number | null;
    podiumHits: number;
    logLoss: number | null;
    /**
     * How many finishers each parent model called closer, for the one-line
     * "XGBoost was closer on N, Monte Carlo on M, tied on T" summary. Null
     * when there's nothing to compare (no xgboost review, handled by the
     * surrounding `blended` being null in that case).
     */
    closerModelCounts: { monteCarlo: number; xgboost: number; tie: number };
  } | null;
  /** Circuit type (street/technical/high_speed), for the pipeline strip's plain-English description of this race's inputs. */
  circuitType: string | null;
  /** The production blend weight (BLEND_ALPHA in params.ts) in effect when this review was built -- same value regardless of race, surfaced here so the UI doesn't need its own import of a sim-internal constant. */
  blendAlpha: number;
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
  actualByDriver: Map<number, { finishPosition: number | null; status: "finished" | "dnf" | "dsq" | null; gridPosition: number | null }>,
  winnerRow: { driverId: number } | undefined,
  actualPodiumIds: Set<number>,
  outOfPositionByDriver: Map<number, boolean>,
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

  let predictions: { driverId: number; predFinishPosition: number; predDnfProb: number; winProbability: number; rawWinProbability: number }[];

  if (frozen) {
    predictions = frozen.map((r) => ({
      driverId: r.driverId,
      predFinishPosition: r.predFinishPosition ?? 0,
      predDnfProb: r.predDnfProb ?? 0,
      winProbability: r.winProbability ?? 0,
      // Rows written before the raw_win_probability column existed fall
      // back to the calibrated value -- not exactly right, but strictly
      // better than null for a blend that would otherwise silently exclude
      // this driver.
      rawWinProbability: r.rawWinProbability ?? r.winProbability ?? 0,
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
      rawWinProbability: p.rawWinProbability,
      predictedDnfProbability: p.predDnfProb,
      startedOutOfPosition: outOfPositionByDriver.get(p.driverId) ?? null,
      gridPosition: actual?.gridPosition ?? null,
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
  actualByDriver: Map<number, { finishPosition: number | null; status: "finished" | "dnf" | "dsq" | null; gridPosition: number | null }>,
  outOfPositionByDriver: Map<number, boolean>,
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
      // simulation_results only persists winPct/podiumPct/pointsPct -- a
      // frozen Monte Carlo run has no per-driver DNF probability to recover,
      // unlike the live-reconstruction path below (DriverOutcome.dnfPct).
      predictedDnfProbability: null,
      startedOutOfPosition: outOfPositionByDriver.get(r.driverId) ?? null,
      gridPosition: actual?.gridPosition ?? null,
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
      gridPosition: raceResults.gridPosition,
    })
    .from(raceResults)
    .where(eq(raceResults.raceId, raceId));
  if (actualRows.length === 0) return null; // race hasn't happened yet — nothing to review

  const actualByDriver = new Map(actualRows.map((r) => [r.driverId, r]));
  const winnerRow = actualRows.find((a) => a.status === "finished" && a.finishPosition === 1);
  const actualPodiumIds = new Set(
    actualRows.filter((a) => a.status === "finished" && a.finishPosition != null && a.finishPosition <= 3).map((a) => a.driverId),
  );

  // "Started out of position": actual starting grid slot differs from the
  // qualifying classification -- a grid penalty or pit-lane start, the one
  // concretely knowable reason a prediction can miss without it being the
  // model's fault (the model predicts from qualifying form, not penalties
  // handed out afterward).
  const qualiRows = await db
    .select({ driverId: qualifyingResults.driverId, position: qualifyingResults.position })
    .from(qualifyingResults)
    .where(eq(qualifyingResults.raceId, raceId));
  const qualiPositionByDriver = new Map(qualiRows.map((r) => [r.driverId, r.position]));
  const outOfPositionByDriver = new Map<number, boolean>();
  for (const a of actualRows) {
    const qualiPos = qualiPositionByDriver.get(a.driverId);
    if (qualiPos != null && a.gridPosition != null) {
      outOfPositionByDriver.set(a.driverId, qualiPos !== a.gridPosition);
    }
  }

  const [circuitRow] = await db
    .select({ circuitType: circuits.type })
    .from(races)
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .where(eq(races.id, raceId));

  const frozen = await getFrozenPrediction(raceId);

  let rows: PredictionReviewRow[];
  let iterationsUsed: number;
  let hasRealGrid: boolean;
  let isFrozen: boolean;
  let modelVersion: string | null;

  if (frozen) {
    rows = await rowsFromFrozen(frozen, raceId, actualByDriver, outOfPositionByDriver);
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
      predictedDnfProbability: d.dnfPct,
      startedOutOfPosition: outOfPositionByDriver.get(d.driverId) ?? null,
      gridPosition: actualByDriver.get(d.driverId)?.gridPosition ?? null,
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

  const xgboost = await buildXgboostReview(raceId, actualByDriver, winnerRow, actualPodiumIds, outOfPositionByDriver);
  const blended = buildBlendedReview(rows, xgboost, actualByDriver, winnerRow, actualPodiumIds);

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
    blended,
    circuitType: circuitRow?.circuitType ?? null,
    blendAlpha: BLEND_ALPHA,
  };
}

/**
 * Builds the blended review block from the already-scored MC and XGBoost
 * rows -- same BLEND_ALPHA formula as the production prediction (see
 * run-simulation.ts/race-prediction.ts), applied here for review purposes
 * only, not stored anywhere. Null when xgboost review rows don't exist (see
 * the `blended` field's own doc comment on PredictionReview for why that's
 * the honest answer, not a reconstruction).
 */
function buildBlendedReview(
  mcRows: PredictionReviewRow[],
  xgboost: PredictionReview["xgboost"],
  actualByDriver: Map<number, { finishPosition: number | null; status: "finished" | "dnf" | "dsq" | null }>,
  winnerRow: { driverId: number } | undefined,
  actualPodiumIds: Set<number>,
): PredictionReview["blended"] {
  if (!xgboost) return null;
  const xgbByDriver = new Map(xgboost.rows.map((r) => [r.driverId, r]));

  const raw = mcRows.map((r) => {
    const xgbRow = xgbByDriver.get(r.driverId);
    const xgbRaw = xgbRow?.rawWinProbability;
    return xgbRaw != null ? BLEND_ALPHA * r.winProbability + (1 - BLEND_ALPHA) * xgbRaw : r.winProbability;
  });
  const sum = raw.reduce((a, b) => a + b, 0);

  const ranked = mcRows
    .map((r, i) => ({ driverId: r.driverId, winProbability: sum > 0 ? raw[i] / sum : r.winProbability }))
    .sort((a, b) => b.winProbability - a.winProbability);

  const rows = ranked.map((r, i) => {
    const mcRow = mcRows.find((m) => m.driverId === r.driverId)!;
    const xgbRow = xgbByDriver.get(r.driverId);
    const actual = actualByDriver.get(r.driverId);
    const predictedRank = i + 1;
    const actualFinish = actual?.status === "finished" ? actual.finishPosition : null;

    // Which parent model's own rank was closer to the actual finish, for
    // this driver -- lets a viewer see whether the blend is actually
    // drawing on both models or just tracking whichever one happened to be
    // closer, race to race.
    let closerModel: "monte-carlo" | "xgboost" | "tie" | null = null;
    if (actualFinish != null && xgbRow) {
      const mcAbsError = Math.abs(actualFinish - mcRow.predictedRank);
      const xgbAbsError = Math.abs(actualFinish - xgbRow.predictedRank);
      closerModel = mcAbsError < xgbAbsError ? "monte-carlo" : xgbAbsError < mcAbsError ? "xgboost" : "tie";
    }

    return {
      driverId: r.driverId,
      driverName: mcRow.driverName,
      teamName: mcRow.teamName,
      predictedRank,
      winProbability: r.winProbability,
      predictedFinish: null, // the blend has no equivalent of its own -- avgFinishPosition/predFinishPosition come from each parent model, not something a win-probability blend produces
      actualFinish,
      actualStatus: actual?.status ?? null,
      rankError: actualFinish != null ? actualFinish - predictedRank : null,
      closerModel,
      // Neither parent's DNF estimate is "the blend's" own -- show the
      // Monte Carlo row's (same convention the table already uses for
      // predictedFinish being null on the blend: this field isn't something
      // a win-probability blend produces on its own).
      predictedDnfProbability: mcRow.predictedDnfProbability,
      startedOutOfPosition: mcRow.startedOutOfPosition,
      gridPosition: mcRow.gridPosition,
    };
  });

  const favourite = rows.find((r) => r.predictedRank === 1) ?? null;
  const winnerRowBlend = winnerRow ? rows.find((r) => r.driverId === winnerRow.driverId) ?? null : null;
  const podiumHits = rows.filter((r) => r.predictedRank <= 3 && actualPodiumIds.has(r.driverId)).length;
  const winnerProb = winnerRowBlend?.winProbability ?? null;
  const logLoss = winnerProb != null ? -Math.log(Math.max(winnerProb, LOG_LOSS_FLOOR)) : null;

  const closerModelCounts = { monteCarlo: 0, xgboost: 0, tie: 0 };
  for (const r of rows) {
    if (r.closerModel === "monte-carlo") closerModelCounts.monteCarlo++;
    else if (r.closerModel === "xgboost") closerModelCounts.xgboost++;
    else if (r.closerModel === "tie") closerModelCounts.tie++;
  }

  return {
    rows,
    favourite,
    winnerPredictedRank: winnerRowBlend?.predictedRank ?? null,
    podiumHits,
    logLoss,
    closerModelCounts,
  };
}
