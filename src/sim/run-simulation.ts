import { db } from "@/db";
import { simulationRuns, simulationResults, races, drivers, xgboostPredictions } from "@/db/schema";
import { eq, sql, desc, and } from "drizzle-orm";
import { buildSimContext } from "./entrants";
import { runSimulation, simulationIterator, type SimulationOutcome } from "./engine";
import { DEFAULT_ITERATIONS, WIN_PROBABILITY_CALIBRATION, MODEL_VERSION } from "./params";
import { applyCalibration } from "./calibration";
import { buildXgboostFeatures } from "./xgboost-features";
import { predictRace, xgboostModelAvailable } from "./xgboost-model";

/** How often (in iterations) partial results are flushed to the DB mid-run. */
const PROGRESS_INTERVAL = 1000;

/**
 * Whether `raceId`'s race session hasn't started yet, relative to right now
 * — stamped onto a run at creation so it can be told apart later from a
 * post-race replay. Uses the actual race start instant (`races.startsAt`,
 * ingested from Jolpica's date+time), not just the calendar date: comparing
 * against midnight UTC of race day wrongly classified a prediction made
 * hours before lights-out (still the same calendar day) as post-race,
 * since midnight had already passed. Falls back to end-of-day on the
 * calendar date only for rows without a startsAt (ingested before this
 * field existed, or a malformed upstream entry) -- looser than the real
 * start time, but strictly closer to correct than the old start-of-day
 * comparison it replaces.
 */
export async function isBeforeRaceStart(raceId: number): Promise<boolean> {
  const [row] = await db.select({ date: races.date, startsAt: races.startsAt }).from(races).where(eq(races.id, raceId));
  if (!row) return false;
  if (row.startsAt) return row.startsAt.getTime() > Date.now();
  const endOfRaceDay = new Date(`${row.date}T23:59:59Z`).getTime();
  return endOfRaceDay > Date.now();
}

/**
 * Applies Platt-scaling calibration (see WIN_PROBABILITY_CALIBRATION) to a
 * simulation outcome's win probabilities, right at the boundary where a
 * prediction is stored or shown — not inside engine.ts itself, so the
 * backtest harness keeps measuring the model's true raw output (recalibrating
 * against already-calibrated numbers would be circular). A monotonic
 * per-driver correction can't change who's the favourite, but applied
 * independently per driver it no longer sums to 1 across the field, so it's
 * renormalized back to a proper distribution afterward.
 *
 * Only applied when the grid is real or quali-derived (outcome.hasRealGrid).
 * WIN_PROBABILITY_CALIBRATION was fit against real-grid predictions only,
 * and the horizon backtest found it doesn't transfer to pre-qualifying
 * (simulated-grid) predictions -- checked against those, it applies a
 * substantial, wrong correction where a near-identity transform (or none at
 * all) already fits close to observed outcomes (see QUALI_NOISE_STD_DEV's
 * own doc comment for the backtest this is based on). A second Platt model
 * fit specifically for the simulated-grid case was deliberately not built --
 * raw probabilities there are already close to calibrated, so identity is
 * the simpler, equally-honest choice.
 */
export function calibrateOutcome(outcome: SimulationOutcome): SimulationOutcome {
  if (!outcome.hasRealGrid) return outcome;
  const calibratedRaw = outcome.drivers.map((d) => applyCalibration(d.winPct, WIN_PROBABILITY_CALIBRATION));
  const sum = calibratedRaw.reduce((a, b) => a + b, 0);
  return {
    ...outcome,
    drivers: outcome.drivers.map((d, i) => ({
      ...d,
      winPct: sum > 0 ? calibratedRaw[i] / sum : d.winPct,
    })),
  };
}

export type StoredSimulation = {
  runId: number;
  raceId: number;
  iterations: number;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: Date | null;
  completedAt: Date | null;
  hasRealGrid: boolean;
  gridIsProvisional: boolean;
  /** True when the XGBoost overlay also produced (and froze) a prediction for this race, so a blend can be computed from it (see blendPrediction in src/queries/race-prediction.ts). False for pre-quali runs or when the XGBoost model/grid isn't available -- the stored result is pure Monte Carlo either way. */
  xgboostAvailable: boolean;
  drivers: SimulationOutcome["drivers"];
};

/**
 * Runs the XGBoost overlay for `raceId` (if it can predict this race at all)
 * and freezes its prediction into xgboost_predictions, the same table and
 * "replace this race's rows wholesale" semantics /api/xgboost-predict's
 * manual trigger already uses (see that route's own doc comment) -- this
 * just means every Monte Carlo run now also keeps XGBoost's frozen
 * prediction up to date, instead of requiring a separate click.
 *
 * Does NOT blend or mutate the Monte Carlo outcome -- simulation_results
 * keeps storing pure MC, by design (see the "compute-on-read" discussion in
 * BLEND_ALPHA's doc comment): the production blend is computed at read time
 * in src/queries/race-prediction.ts from the two independently frozen
 * tables, so each model's own frozen number stays recoverable for the
 * "model breakdown" UI without a third stored value to keep in sync.
 *
 * Returns false (does nothing else) whenever XGBoost can't predict this
 * race: no trained model artifact (xgboostModelAvailable), no real/quali-
 * derived grid yet (buildXgboostFeatures returns null -- XGBoost has no
 * pre-quali proxy, see that file's own doc comment), or a pre-quali outcome
 * (!outcome.hasRealGrid, checked first since it's free and covers the most
 * common case).
 */
async function freezeXgboostPrediction(raceId: number, outcome: SimulationOutcome): Promise<boolean> {
  if (!outcome.hasRealGrid) return false;
  if (!xgboostModelAvailable()) return false;

  const features = await buildXgboostFeatures(raceId);
  if (!features) return false;

  const driverRows = await db.select({ id: drivers.id, externalRef: drivers.externalRef }).from(drivers);
  const driverIdByRef = new Map(driverRows.map((d) => [d.externalRef, d.id]));

  const entrants = features
    .map((f) => {
      const driverId = driverIdByRef.get(f.driverRef);
      if (driverId == null) return null;
      return { driverId, ...f };
    })
    .filter((e): e is NonNullable<typeof e> => e != null);
  if (entrants.length === 0) return false;

  const predictions = predictRace(entrants);
  if (predictions.length === 0) return false;

  const predictedBeforeRace = await isBeforeRaceStart(raceId);
  await db.delete(xgboostPredictions).where(eq(xgboostPredictions.raceId, raceId));
  await db.insert(xgboostPredictions).values(
    predictions.map((p) => ({
      raceId,
      driverId: p.driverId,
      predFinishPosition: p.predFinishPosition,
      predDnfProb: p.predDnfProb,
      winProbability: p.winProbability,
      rawWinProbability: p.rawWinProbability,
      predictedBeforeRace,
      modelVersion: MODEL_VERSION,
    })),
  );
  return true;
}

/**
 * Runs a simulation for `raceId` and persists it.
 *
 * Creates a simulation_runs row up front, writes partial per-driver results
 * every PROGRESS_INTERVAL iterations (so a long run is observable while it's
 * still going, per the project plan), and marks the run completed or failed
 * at the end.
 *
 * The engine itself is synchronous and CPU-bound. At the plan's target of
 * 5,000-10,000 iterations over ~20 cars this is comfortably sub-second, so
 * it runs inline; the plan's note about moving to a separate worker only
 * becomes relevant if per-lap modelling is added later.
 */
export async function runAndStoreSimulation(
  raceId: number,
  iterations: number = DEFAULT_ITERATIONS,
  options: { seed?: number } = {},
): Promise<StoredSimulation> {
  const ctx = await buildSimContext(raceId);
  if (!ctx) {
    throw new Error(
      "Not enough data to simulate this race — no driver ratings or pace signals are available for it yet.",
    );
  }

  const [run] = await db
    .insert(simulationRuns)
    .values({
      raceId,
      iterationCount: iterations,
      status: "running",
      startedAt: new Date(),
      predictedBeforeRace: await isBeforeRaceStart(raceId),
      modelVersion: MODEL_VERSION,
    })
    .returning({ id: simulationRuns.id });

  try {
    let lastFlush: Promise<unknown> = Promise.resolve();
    const outcome = runSimulation(ctx, iterations, {
      seed: options.seed ?? raceId,
      progressInterval: PROGRESS_INTERVAL,
      onProgress: (_completed, snapshot) => {
        // Fire-and-forget: the engine loop is synchronous, so awaiting here
        // would mean blocking the whole run on a network round-trip every
        // interval. Errors are swallowed deliberately — a failed partial
        // write shouldn't abort a run whose final write is what matters.
        lastFlush = persistResults(run.id, calibrateOutcome(snapshot)).catch(() => {});
      },
    });

    const calibrated = calibrateOutcome(outcome);
    // XGBoost only runs once, against the final result -- its prediction is
    // deterministic given the same live grid/features, so there's no reason
    // to recompute it on every intermediate progress flush the way the
    // Monte Carlo simulation itself does.
    const xgboostAvailable = await freezeXgboostPrediction(raceId, calibrated);
    await lastFlush;
    await persistResults(run.id, calibrated);
    await db
      .update(simulationRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(simulationRuns.id, run.id));

    return {
      runId: run.id,
      raceId,
      iterations: calibrated.iterations,
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      hasRealGrid: calibrated.hasRealGrid,
      gridIsProvisional: calibrated.gridIsProvisional,
      xgboostAvailable,
      drivers: calibrated.drivers,
    };
  } catch (err) {
    await db
      .update(simulationRuns)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(simulationRuns.id, run.id));
    throw err;
  }
}

/** One event in a streamed simulation run. */
export type SimulationProgressEvent =
  | { type: "progress"; completed: number; total: number; drivers: SimulationOutcome["drivers"] }
  | { type: "done"; result: StoredSimulation }
  | { type: "error"; error: string };

/**
 * Runs a simulation, yielding progress snapshots as it goes, then the final
 * stored result. Same work and same persistence as runAndStoreSimulation —
 * this variant just reports intermediate state so a client can watch the
 * probabilities converge instead of staring at a spinner.
 *
 * Between batches it yields to the event loop (`setImmediate`). Without that
 * the synchronous engine loop would hold the thread for the whole run and
 * every chunk would reach the browser in one burst at the end, which defeats
 * the point of streaming.
 */
export async function* streamSimulation(
  raceId: number,
  iterations: number = DEFAULT_ITERATIONS,
  options: { seed?: number } = {},
): AsyncGenerator<SimulationProgressEvent> {
  const ctx = await buildSimContext(raceId);
  if (!ctx) {
    yield {
      type: "error",
      error:
        "Not enough data to simulate this race — no driver ratings or pace signals are available for it yet.",
    };
    return;
  }

  const [run] = await db
    .insert(simulationRuns)
    .values({
      raceId,
      iterationCount: iterations,
      status: "running",
      startedAt: new Date(),
      predictedBeforeRace: await isBeforeRaceStart(raceId),
      modelVersion: MODEL_VERSION,
    })
    .returning({ id: simulationRuns.id });
  const startedAt = new Date();

  try {
    // Report often enough to look alive even on a short run, but not so often
    // that the JSON writing costs more than the simulation it is reporting on.
    const progressInterval = Math.max(100, Math.floor(iterations / 40));
    const gen = simulationIterator(ctx, iterations, {
      seed: options.seed ?? raceId,
      progressInterval,
    });

    let step = gen.next();
    while (!step.done) {
      yield {
        type: "progress",
        completed: step.value.iterations,
        total: iterations,
        drivers: calibrateOutcome(step.value).drivers,
      };
      await new Promise((resolve) => setImmediate(resolve));
      step = gen.next();
    }
    const calibrated = calibrateOutcome(step.value);
    // Same as runAndStoreSimulation: XGBoost only runs once, against the
    // final result, not on every intermediate progress snapshot.
    const xgboostAvailable = await freezeXgboostPrediction(raceId, calibrated);

    await persistResults(run.id, calibrated);
    const completedAt = new Date();
    await db
      .update(simulationRuns)
      .set({ status: "completed", completedAt })
      .where(eq(simulationRuns.id, run.id));

    yield {
      type: "done",
      result: {
        runId: run.id,
        raceId,
        iterations: calibrated.iterations,
        status: "completed",
        startedAt,
        completedAt,
        hasRealGrid: calibrated.hasRealGrid,
        gridIsProvisional: calibrated.gridIsProvisional,
        xgboostAvailable,
        drivers: calibrated.drivers,
      },
    };
  } catch (err) {
    await db
      .update(simulationRuns)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(simulationRuns.id, run.id));
    yield { type: "error", error: err instanceof Error ? err.message : "Simulation failed" };
  }
}

/**
 * Upserts the per-driver probabilities for a run. simulation_results has no
 * natural unique key in the schema, so a partial flush replaces the run's
 * rows wholesale rather than updating in place — cheap at ~20 rows, and it
 * keeps a mid-run snapshot internally consistent.
 */
async function persistResults(runId: number, outcome: SimulationOutcome) {
  await db.delete(simulationResults).where(eq(simulationResults.simulationRunId, runId));
  if (outcome.drivers.length === 0) return;
  await db.insert(simulationResults).values(
    outcome.drivers.map((d) => ({
      simulationRunId: runId,
      driverId: d.driverId,
      winPct: d.winPct,
      podiumPct: d.podiumPct,
      pointsPct: d.pointsPct,
    })),
  );
}

/**
 * The most recent completed simulation for a race, if one exists — lets the
 * race page show a previous prediction immediately on load instead of
 * re-running the whole Monte Carlo on every page view.
 *
 * Only win/podium/points percentages are stored (that's the schema's shape),
 * so the richer per-driver detail the engine produces — expected pace, DNF
 * rate, average finishing position — is not available from a stored run.
 * The UI shows the fuller picture only after a fresh run in the same request.
 */
export async function getLatestSimulation(raceId: number) {
  const [run] = await db
    .select()
    .from(simulationRuns)
    .where(sql`${simulationRuns.raceId} = ${raceId} AND ${simulationRuns.status} = 'completed'`)
    .orderBy(desc(simulationRuns.completedAt))
    .limit(1);
  if (!run) return null;

  const rows = await db
    .select()
    .from(simulationResults)
    .where(eq(simulationResults.simulationRunId, run.id));

  return { run, results: rows };
}

/**
 * The most recent completed run that was actually made before this race
 * happened — the honest historical record of what the model said, untouched
 * by any tuning that happened afterward. Distinct from getLatestSimulation,
 * which returns whichever run is newest with no regard for whether it was
 * made before or after the race; that's fine for "show me a cached
 * prediction" but wrong for "what did the model call before the result was
 * known."
 *
 * Deliberately the LATEST pre-race run, not the first: re-running the
 * simulation (say, to refine iteration count) before the race happens is
 * still refining a genuine prediction, not tainting one — only a run made
 * after the result is known would be dishonest to show here, and
 * predictedBeforeRace already excludes those.
 *
 * Returns null if no pre-race run exists yet (e.g. every run for this race
 * so far was made after it already happened) — the caller falls back to a
 * live re-simulation, clearly labelled as reconstructed rather than
 * contemporaneous.
 */
export async function getFrozenPrediction(raceId: number) {
  const [run] = await db
    .select()
    .from(simulationRuns)
    .where(
      and(
        eq(simulationRuns.raceId, raceId),
        eq(simulationRuns.status, "completed"),
        eq(simulationRuns.predictedBeforeRace, true),
      ),
    )
    .orderBy(desc(simulationRuns.completedAt))
    .limit(1);
  if (!run) return null;

  const rows = await db
    .select()
    .from(simulationResults)
    .where(eq(simulationResults.simulationRunId, run.id));

  return { run, results: rows };
}
