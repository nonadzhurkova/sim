import { db } from "@/db";
import { drivers, teams, raceResults, xgboostPredictions, retroactivePredictionCache } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { BLEND_ALPHA, DEFAULT_ITERATIONS } from "@/sim/params";
import { getFrozenPrediction, calibrateOutcome, type StoredSimulation } from "@/sim/run-simulation";
import { buildSimContext } from "@/sim/entrants";
import { runSimulation, type SimulationOutcome } from "@/sim/engine";
import { buildPredictionReview, type PredictionReview } from "./prediction-review";

export type BlendedDriverPrediction = {
  driverId: number;
  driverName: string;
  teamName: string | null;
  /** The production prediction: BLEND_ALPHA*mc + (1-BLEND_ALPHA)*xgbRaw when both exist, otherwise pure MC. */
  winPct: number;
  podiumPct: number;
  pointsPct: number;
  /** Pure Monte Carlo win probability, for the "model breakdown" view. Always present when a frozen MC run exists. */
  mcWinPct: number;
  /** Pure XGBoost-raw win probability, for the "model breakdown" view. Null when XGBoost couldn't predict this race (no grid yet, no model trained). */
  xgbWinPct: number | null;
};

export type RacePrediction = {
  raceId: number;
  runId: number;
  iterations: number;
  hasRealGrid: boolean;
  gridIsProvisional: boolean;
  /** True when drivers[].winPct is the MC+XGBoost blend; false when it's pure Monte Carlo (pre-quali, or XGBoost unavailable for this race). */
  isBlended: boolean;
  drivers: BlendedDriverPrediction[];
};

/**
 * The most recent frozen XGBoost prediction for a race -- same table and
 * "latest predictedAt wins" semantics src/queries/prediction-review.ts's own
 * (module-private) getFrozenXgboostPrediction uses, exported here so the
 * production blend can read it without duplicating the query.
 */
async function getFrozenXgboostRawPrediction(raceId: number): Promise<Map<number, number> | null> {
  const rows = await db
    .select({ driverId: xgboostPredictions.driverId, rawWinProbability: xgboostPredictions.rawWinProbability })
    .from(xgboostPredictions)
    .where(and(eq(xgboostPredictions.raceId, raceId), eq(xgboostPredictions.predictedBeforeRace, true)))
    .orderBy(desc(xgboostPredictions.predictedAt));
  if (rows.length === 0) return null;
  // rawWinProbability can be null for a row written before the column
  // existed -- treated as "XGBoost has no opinion for this driver," same as
  // the driver being absent entirely.
  const withRaw = rows.filter((r): r is { driverId: number; rawWinProbability: number } => r.rawWinProbability != null);
  return withRaw.length > 0 ? new Map(withRaw.map((r) => [r.driverId, r.rawWinProbability])) : null;
}

/**
 * Builds driver name/team lookups for a race's field -- shared by both
 * blendPrediction's output and anything else needing to label frozen rows.
 */
async function loadDriverLabels(raceId: number, driverIds: number[]) {
  const nameRows = driverIds.length ? await db.select({ id: drivers.id, name: drivers.name }).from(drivers) : [];
  const nameById = new Map(nameRows.map((d) => [d.id, d.name]));

  const teamRows = await db.select({ driverId: raceResults.driverId, teamId: raceResults.teamId }).from(raceResults).where(eq(raceResults.raceId, raceId));
  const teamIdByDriver = new Map(teamRows.map((r) => [r.driverId, r.teamId]));
  const teamIds = [...new Set(teamRows.map((r) => r.teamId).filter((id): id is number => id != null))];
  const teamNameRows = teamIds.length ? await db.select({ id: teams.id, name: teams.name }).from(teams) : [];
  const teamNameById = new Map(teamNameRows.map((t) => [t.id, t.name]));

  return { nameById, teamIdByDriver, teamNameById };
}

/**
 * The production real-grid prediction: Monte Carlo blended with the
 * XGBoost overlay's raw win probability (BLEND_ALPHA in params.ts), computed
 * at read time from each model's own independently frozen prediction rather
 * than a third stored value -- see BLEND_ALPHA's doc comment for why, and
 * run-simulation.ts's freezeXgboostPrediction for how the XGBoost side gets
 * frozen (automatically, alongside every Monte Carlo run).
 *
 * Falls back to pure Monte Carlo (isBlended: false) whenever no frozen
 * XGBoost prediction exists for this race -- pre-qualifying (XGBoost has no
 * pre-quali mode), the model not yet trained, or simply no Monte Carlo run
 * has been made since the raw_win_probability column started being
 * populated. Returns null only when there's no frozen Monte Carlo
 * prediction at all (nobody has run a simulation for this race yet) -- the
 * caller is expected to fall back to its own live-replay logic the same way
 * prediction-review.ts already does for the pure-MC case.
 */
export async function getBlendedPrediction(
  raceId: number,
  stage?: "pre_quali" | "post_quali",
): Promise<RacePrediction | null> {
  const frozen = await getFrozenPrediction(raceId, stage);
  if (!frozen || frozen.results.length === 0) return null;

  const driverIds = frozen.results.map((r) => r.driverId);
  const { nameById, teamIdByDriver, teamNameById } = await loadDriverLabels(raceId, driverIds);

  const xgbRawByDriverId = await getFrozenXgboostRawPrediction(raceId);
  const isBlended = xgbRawByDriverId != null;

  const raw = frozen.results.map((r) => {
    const mcP = r.winPct ?? 0;
    const xgbP = xgbRawByDriverId?.get(r.driverId);
    return xgbP != null ? BLEND_ALPHA * mcP + (1 - BLEND_ALPHA) * xgbP : mcP;
  });
  const sum = raw.reduce((a, b) => a + b, 0);

  const driversOut: BlendedDriverPrediction[] = frozen.results
    .map((r, i) => {
      const teamId = teamIdByDriver.get(r.driverId);
      return {
        driverId: r.driverId,
        driverName: nameById.get(r.driverId) ?? `Driver ${r.driverId}`,
        teamName: teamId != null ? teamNameById.get(teamId) ?? null : null,
        winPct: sum > 0 ? raw[i] / sum : r.winPct ?? 0,
        podiumPct: r.podiumPct ?? 0,
        pointsPct: r.pointsPct ?? 0,
        mcWinPct: r.winPct ?? 0,
        xgbWinPct: xgbRawByDriverId?.get(r.driverId) ?? null,
      };
    })
    .sort((a, b) => b.winPct - a.winPct);

  return {
    raceId,
    runId: frozen.run.id,
    iterations: frozen.run.iterationCount,
    hasRealGrid: true, // a pre-race run only exists once the grid/context was buildable
    gridIsProvisional: false,
    isBlended,
    drivers: driversOut,
  };
}

/**
 * Same blend, applied to an in-memory (not-yet-persisted) simulation
 * outcome's driver list -- used right after a live /api/simulate run
 * completes, before the page would otherwise have to re-fetch the frozen
 * version. Takes the same xgboostAvailable flag runAndStoreSimulation/
 * streamSimulation already compute, and re-reads the just-frozen XGBoost row
 * rather than re-predicting, so this is cheap even though it's technically a
 * second query right after the write.
 */
export async function blendLiveOutcome(
  raceId: number,
  outcomeDrivers: SimulationOutcome["drivers"],
  xgboostAvailable: StoredSimulation["xgboostAvailable"],
): Promise<{ isBlended: boolean; drivers: (SimulationOutcome["drivers"][number] & { mcWinPct: number; xgbWinPct: number | null })[] }> {
  const xgbRawByDriverId = xgboostAvailable ? await getFrozenXgboostRawPrediction(raceId) : null;
  if (!xgbRawByDriverId) {
    return { isBlended: false, drivers: outcomeDrivers.map((d) => ({ ...d, mcWinPct: d.winPct, xgbWinPct: null })) };
  }

  const raw = outcomeDrivers.map((d) => {
    const xgbP = xgbRawByDriverId.get(d.driverId);
    return xgbP != null ? BLEND_ALPHA * d.winPct + (1 - BLEND_ALPHA) * xgbP : d.winPct;
  });
  const sum = raw.reduce((a, b) => a + b, 0);

  return {
    isBlended: true,
    drivers: outcomeDrivers.map((d, i) => ({
      ...d,
      mcWinPct: d.winPct,
      xgbWinPct: xgbRawByDriverId.get(d.driverId) ?? null,
      winPct: sum > 0 ? raw[i] / sum : d.winPct,
    })),
  };
}

export type PredictionStageEntry = {
  driverId: number;
  driverName: string;
  teamName: string | null;
  winPct: number;
  /** How this driver actually finished, once the race has a result -- null for an upcoming race. */
  actualFinish: number | null;
};

/** Cached/raw shape before actualFinish is joined in -- see withActual. */
type RawStageEntry = Omit<PredictionStageEntry, "actualFinish">;

export type PredictionStageResult = { entries: PredictionStageEntry[]; isRetroactive: boolean } | null;

export type ActualPodiumEntry = { driverId: number; driverName: string; teamName: string | null; finish: number };

export type PredictionStages = {
  preQuali: PredictionStageResult;
  postQuali: PredictionStageResult;
  /** The real top 3 finishers, for comparing both stages' calls against what actually happened. Null until the race is run. */
  actualPodium: ActualPodiumEntry[] | null;
};

const STAGE_TOP_N = 3;

/**
 * A pre_quali- or post_quali-style prediction for a race that has already
 * happened and never had a real run recorded at that stage. "pre_quali"
 * hides the real grid (forceSimulatedGrid); "post_quali" uses it. Either way
 * this runs against TODAY's driver/team ratings, not ratings as they stood
 * at that point in the weekend -- "what the current model guesses," not a
 * recovered historical prediction, which is why callers flag the result
 * isRetroactive: true rather than merging it into a genuine frozen run's
 * slot. Cached in retroactive_prediction_cache after the first computation
 * (a full Monte Carlo run, too slow to repeat on every page view).
 */
async function reconstructStage(
  raceId: number,
  stage: "pre_quali" | "post_quali",
): Promise<RawStageEntry[] | null> {
  const [cached] = await db
    .select({ entries: retroactivePredictionCache.entries })
    .from(retroactivePredictionCache)
    .where(and(eq(retroactivePredictionCache.raceId, raceId), eq(retroactivePredictionCache.stage, stage)));
  if (cached) return cached.entries as RawStageEntry[];

  const ctx = await buildSimContext(raceId, undefined, undefined, false, stage === "pre_quali");
  if (!ctx) return null;
  const outcome = calibrateOutcome(runSimulation(ctx, DEFAULT_ITERATIONS, { seed: raceId }));
  if (outcome.drivers.length === 0) return null;

  const entries = [...outcome.drivers]
    .sort((a, b) => b.winPct - a.winPct)
    .slice(0, STAGE_TOP_N)
    .map((d) => ({ driverId: d.driverId, driverName: d.driverName, teamName: d.teamName, winPct: d.winPct }));

  await db
    .insert(retroactivePredictionCache)
    .values({ raceId, stage, entries })
    .onConflictDoNothing();

  return entries;
}

/**
 * The model's top 3 at two points in a race weekend -- before qualifying
 * (simulated grid) and after qualifying but before the race (real grid) --
 * each annotated with how that driver actually finished, so both calls can
 * be checked against reality side by side. A stage is null when no
 * prediction exists for it yet; preQuali is null if the first simulation
 * for this race wasn't run until after qualifying already happened.
 *
 * preQuali/postQuali come from simulation_runs' own stored stage (see
 * predictionStageEnum in schema.ts). actualFinish per entry, and the
 * separate actualPodium list, come from an already-built PredictionReview
 * when the caller has one (the race page always does) rather than
 * re-deriving the same actual-result lookup a second time.
 */
export async function getPredictionStages(raceId: number, existingReview?: PredictionReview | null): Promise<PredictionStages> {
  const [preQualiFrozen, postQualiFrozen, review] = await Promise.all([
    getBlendedPrediction(raceId, "pre_quali"),
    getBlendedPrediction(raceId, "post_quali"),
    existingReview !== undefined ? Promise.resolve(existingReview) : buildPredictionReview(raceId),
  ]);

  const actualFinishByDriver = new Map(review?.rows.map((r) => [r.driverId, r.actualFinish]) ?? []);

  const toTopN = (p: RacePrediction | null): PredictionStageEntry[] | null => {
    if (!p || p.drivers.length === 0) return null;
    return p.drivers.slice(0, STAGE_TOP_N).map((d) => ({
      driverId: d.driverId,
      driverName: d.driverName,
      teamName: d.teamName,
      winPct: d.winPct,
      actualFinish: actualFinishByDriver.get(d.driverId) ?? null,
    }));
  };

  const isFinished = review != null;

  const withActual = (entries: RawStageEntry[]): PredictionStageEntry[] =>
    entries.map((e) => ({ ...e, actualFinish: actualFinishByDriver.get(e.driverId) ?? null }));

  const preQualiEntries = toTopN(preQualiFrozen);
  let preQuali: PredictionStageResult = preQualiEntries ? { entries: preQualiEntries, isRetroactive: false } : null;
  // No genuine pre_quali run was ever recorded for this race. If it's
  // already finished, there's no way to recover a real one -- qualifying
  // already happened -- so fall back to a clearly-flagged retroactive
  // reconstruction instead of leaving the slot empty. An upcoming race just
  // waits for a real run (no fallback): "no prediction made yet" is the
  // honest state there, not something to paper over.
  if (!preQuali && isFinished) {
    const retro = await reconstructStage(raceId, "pre_quali");
    preQuali = retro ? { entries: withActual(retro), isRetroactive: true } : null;
  }

  const postQualiEntries = toTopN(postQualiFrozen);
  let postQuali: PredictionStageResult = postQualiEntries ? { entries: postQualiEntries, isRetroactive: false } : null;
  // Same honesty rule as preQuali above: a finished race with no real
  // post_quali run recorded gets a flagged retroactive reconstruction
  // (real grid, today's ratings) instead of an empty slot.
  if (!postQuali && isFinished) {
    const retro = await reconstructStage(raceId, "post_quali");
    postQuali = retro ? { entries: withActual(retro), isRetroactive: true } : null;
  }

  const actualPodium: ActualPodiumEntry[] | null = review
    ? [...review.rows]
        .filter((r) => r.actualFinish != null && r.actualFinish <= 3)
        .sort((a, b) => a.actualFinish! - b.actualFinish!)
        .map((r) => ({ driverId: r.driverId, driverName: r.driverName, teamName: r.teamName, finish: r.actualFinish! }))
    : null;

  return { preQuali, postQuali, actualPodium };
}
