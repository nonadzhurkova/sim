import { getBlendedPrediction } from "@/queries/race-prediction";

export type NextRaceContender = { driverId: number; driverName: string; winPct: number };

/**
 * Top-3 win chances for one race, from whatever prediction was actually
 * stored before it (see getBlendedPrediction, which blends Monte Carlo with
 * the frozen XGBoost prediction when available, same as the race page) —
 * deliberately not a fresh simulation run, since running one on every
 * home-page load would be expensive and simulations are otherwise a
 * user-triggered action (the "Run Simulation" button on the race page).
 * Returns null if nobody has clicked that button yet for this race, in
 * which case the home page falls back to a plain link with no numbers
 * rather than pretending to have data.
 */
export async function getNextRaceTopContenders(raceId: number): Promise<NextRaceContender[] | null> {
  const prediction = await getBlendedPrediction(raceId);
  if (!prediction || prediction.drivers.length === 0) return null;

  return prediction.drivers.slice(0, 3).map((d) => ({
    driverId: d.driverId,
    driverName: d.driverName,
    winPct: d.winPct,
  }));
}
