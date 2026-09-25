import { db } from "@/db";
import { races, raceResults } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { weightedAverage } from "./decay";

/**
 * Race craft: how much better or worse a driver finishes than their starting
 * position would normally yield.
 *
 * Grid position is the model's strongest single predictor, but it is a blunt
 * one — it treats every car starting P8 as equivalent. In reality some drivers
 * reliably beat their grid slot (good starts, overtaking, tyre management,
 * staying out of trouble) and others reliably lose to it.
 *
 * Crucially this is measured *against what that grid slot normally produces*,
 * not as raw places gained. Raw places gained mostly measures where a driver
 * starts — a car starting P18 has far more room to gain than one starting P2.
 * Controlling for the grid slot strengthens the signal from r=0.10 to r=0.19
 * across the ingested data, which is what shows it is a real trait rather than
 * an artefact of where the car qualifies. The effect is modest: about 1.4
 * positions between the best and worst converters.
 */

/** Minimum prior races before a driver gets a race-craft value at all. */
const MIN_HISTORY = 3;
/** How many recent races feed the estimate. */
const LOOKBACK = 8;

export type RaceCraftResult = {
  /** Positions better than the grid slot's historical average. Positive = good. */
  value: number;
  sampleRaces: number;
};

type ResultRow = {
  season: number;
  round: number;
  driverId: number;
  grid: number | null;
  finish: number | null;
  status: "finished" | "dnf" | "dsq" | null;
};

/**
 * Computes race craft for every driver as of the target race, using only
 * races strictly before it — required for the backtest to stay honest.
 */
export async function computeRaceCraft(
  targetSeason: number,
  targetRound: number,
): Promise<Map<number, RaceCraftResult>> {
  const rows: ResultRow[] = await db
    .select({
      season: races.season,
      round: races.round,
      driverId: raceResults.driverId,
      grid: raceResults.gridPosition,
      finish: raceResults.finishPosition,
      status: raceResults.status,
    })
    .from(raceResults)
    .innerJoin(races, eq(raceResults.raceId, races.id))
    .orderBy(asc(races.season), asc(races.round));

  const prior = rows.filter(
    (r) =>
      r.status === "finished" &&
      r.grid != null &&
      r.grid > 0 &&
      r.finish != null &&
      (r.season < targetSeason || (r.season === targetSeason && r.round < targetRound)),
  );
  if (prior.length === 0) return new Map();

  // What each grid slot historically yields. This is the baseline a driver is
  // measured against, so the metric isn't dominated by where they start.
  const finishesByGrid = new Map<number, number[]>();
  for (const r of prior) {
    if (!finishesByGrid.has(r.grid as number)) finishesByGrid.set(r.grid as number, []);
    finishesByGrid.get(r.grid as number)!.push(r.finish as number);
  }
  const expectedFinish = new Map<number, number>();
  for (const [grid, finishes] of finishesByGrid) {
    expectedFinish.set(grid, finishes.reduce((a, b) => a + b, 0) / finishes.length);
  }

  // Per driver, most recent first, so recency weighting applies correctly.
  const byDriver = new Map<number, number[]>();
  for (let i = prior.length - 1; i >= 0; i--) {
    const r = prior[i];
    const expected = expectedFinish.get(r.grid as number);
    if (expected == null) continue;
    const residual = expected - (r.finish as number); // positive = beat the slot
    if (!byDriver.has(r.driverId)) byDriver.set(r.driverId, []);
    const history = byDriver.get(r.driverId)!;
    if (history.length < LOOKBACK) history.push(residual);
  }

  const result = new Map<number, RaceCraftResult>();
  for (const [driverId, history] of byDriver) {
    if (history.length < MIN_HISTORY) continue;
    const value = weightedAverage(history);
    if (value == null) continue;
    result.set(driverId, { value, sampleRaces: history.length });
  }
  return result;
}
