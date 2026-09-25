import { db } from "@/db";
import { simulationRuns, simulationResults } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { buildSimContext } from "./entrants";
import { runSimulation, type SimulationOutcome } from "./engine";
import { DEFAULT_ITERATIONS } from "./params";

/** How often (in iterations) partial results are flushed to the DB mid-run. */
const PROGRESS_INTERVAL = 1000;

export type StoredSimulation = {
  runId: number;
  raceId: number;
  iterations: number;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: Date | null;
  completedAt: Date | null;
  hasRealGrid: boolean;
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
        lastFlush = persistResults(run.id, snapshot).catch(() => {});
      },
    });

    await lastFlush;
    await persistResults(run.id, outcome);
    await db
      .update(simulationRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(simulationRuns.id, run.id));

    return {
      runId: run.id,
      raceId,
      iterations: outcome.iterations,
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      hasRealGrid: outcome.hasRealGrid,
      drivers: outcome.drivers,
    };
  } catch (err) {
    await db
      .update(simulationRuns)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(simulationRuns.id, run.id));
    throw err;
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
