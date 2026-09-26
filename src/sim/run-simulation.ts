import { db } from "@/db";
import { simulationRuns, simulationResults } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { buildSimContext } from "./entrants";
import { runSimulation, simulationIterator, type SimulationOutcome } from "./engine";
import { DEFAULT_ITERATIONS, WIN_PROBABILITY_CALIBRATION } from "./params";
import { applyCalibration } from "./calibration";

/** How often (in iterations) partial results are flushed to the DB mid-run. */
const PROGRESS_INTERVAL = 1000;

/**
 * Applies Platt-scaling calibration (see WIN_PROBABILITY_CALIBRATION) to a
 * simulation outcome's win probabilities, right at the boundary where a
 * prediction is stored or shown — not inside engine.ts itself, so the
 * backtest harness keeps measuring the model's true raw output (recalibrating
 * against already-calibrated numbers would be circular). A monotonic
 * per-driver correction can't change who's the favourite, but applied
 * independently per driver it no longer sums to 1 across the field, so it's
 * renormalized back to a proper distribution afterward.
 */
function calibrateOutcome(outcome: SimulationOutcome): SimulationOutcome {
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
  drivers: SimulationOutcome["drivers"];
};

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
    .values({ raceId, iterationCount: iterations, status: "running", startedAt: new Date() })
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
    .values({ raceId, iterationCount: iterations, status: "running", startedAt: new Date() })
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
