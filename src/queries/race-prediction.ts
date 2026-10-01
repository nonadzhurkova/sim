import { db } from "@/db";
import { drivers, teams, raceResults, xgboostPredictions } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { BLEND_ALPHA } from "@/sim/params";
import { getFrozenPrediction, type StoredSimulation } from "@/sim/run-simulation";
import type { SimulationOutcome } from "@/sim/engine";

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
export async function getBlendedPrediction(raceId: number): Promise<RacePrediction | null> {
  const frozen = await getFrozenPrediction(raceId);
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
