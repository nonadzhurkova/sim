import { createRng, sampleNormal, sampleBernoulli } from "./random";
import type { SimContext, SimEntrant } from "./entrants";
import {
  PACE_NOISE_STD_DEV,
  QUALI_NOISE_STD_DEV,
  QUALI_FORM_BLEND,
  GRID_PENALTY_PER_POSITION,
  GRID_PENALTY_DEFAULT,
  RACE_CRAFT_WEIGHT,
  SAFETY_CAR_PROBABILITY,
  SAFETY_CAR_PROBABILITY_DEFAULT,
  SAFETY_CAR_COMPRESSION,
  SAFETY_CAR_SHUFFLE_FACTOR,
  POINTS_BY_POSITION,
} from "./params";

export type DriverOutcome = {
  driverId: number;
  driverName: string;
  teamName: string | null;
  /** Mean finishing position across iterations where the driver finished. */
  avgFinishPosition: number | null;
  winPct: number;
  podiumPct: number;
  pointsPct: number;
  dnfPct: number;
  /** Expected championship points per race. */
  avgPoints: number;
  /** Mean grid slot — the real one, or the average of simulated qualis. */
  avgGridPosition: number | null;
  expectedPace: number;
  signals: SimEntrant["signals"];
};

export type SimulationOutcome = {
  raceId: number;
  iterations: number;
  hasRealGrid: boolean;
  /** Grid reconstructed from qualifying lap times, results not yet published. */
  gridIsProvisional: boolean;
  drivers: DriverOutcome[];
};

/**
 * Per-run overrides for the model constants in params.ts. Exists so the
 * backtest harness can sweep parameter values in-process to calibrate them
 * against real results, instead of the values being baked in at import time.
 * Omitted fields fall back to the params.ts defaults.
 */
export type ModelOverrides = {
  paceNoiseStdDev?: number;
  qualiNoiseStdDev?: number;
  gridPenaltyPerPosition?: number;
  raceCraftWeight?: number;
  safetyCarProbability?: number;
  safetyCarCompression?: number;
  safetyCarShuffleFactor?: number;
};

/** Running tallies for one driver across all iterations. */
type Tally = {
  wins: number;
  podiums: number;
  points: number;
  dnfs: number;
  finishPositionSum: number;
  finishCount: number;
  gridSum: number;
  pointsSum: number;
};

/**
 * Runs the Monte Carlo simulation for one race.
 *
 * Each iteration:
 *  1. establishes a grid (real qualifying, or a simulated one),
 *  2. samples each driver's race pace from their rating plus Gaussian noise,
 *  3. rolls a DNF per driver from their reliability rating,
 *  4. rolls a safety car, which compresses the field's pace spread,
 *  5. converts pace + grid into a finishing order and records it.
 *
 * `onProgress` is invoked periodically with the tallies so far, so a caller
 * can persist partial results mid-run and the UI can show probabilities
 * converging live rather than waiting for the whole batch.
 */
export function runSimulation(
  ctx: SimContext,
  iterations: number,
  options: {
    seed?: number;
    onProgress?: (completed: number, snapshot: SimulationOutcome) => void;
    progressInterval?: number;
    overrides?: ModelOverrides;
  } = {},
): SimulationOutcome {
  // Drain the generator synchronously — identical work, just without pausing.
  const gen = simulationIterator(ctx, iterations, options);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

/**
 * The simulation as a generator, yielding a snapshot every
 * `progressInterval` iterations and returning the final outcome.
 *
 * The loop is CPU-bound and synchronous, so a caller that wants to stream
 * progress to a browser has to be able to pause it and let the event loop
 * breathe — otherwise every chunk is written in one burst at the end and
 * nothing actually streams. Yielding gives the caller that pause point
 * without the engine needing to know anything about streaming or timers.
 */
export function* simulationIterator(
  ctx: SimContext,
  iterations: number,
  options: {
    seed?: number;
    onProgress?: (completed: number, snapshot: SimulationOutcome) => void;
    progressInterval?: number;
    overrides?: ModelOverrides;
  } = {},
): Generator<SimulationOutcome, SimulationOutcome, void> {
  const { seed = 1, onProgress, progressInterval, overrides = {} } = options;
  const rng = createRng(seed);
  const entrants = ctx.entrants;
  const n = entrants.length;

  const paceNoise = overrides.paceNoiseStdDev ?? PACE_NOISE_STD_DEV;
  const qualiNoise = overrides.qualiNoiseStdDev ?? QUALI_NOISE_STD_DEV;
  const scCompression = overrides.safetyCarCompression ?? SAFETY_CAR_COMPRESSION;
  const raceCraftWeight = overrides.raceCraftWeight ?? RACE_CRAFT_WEIGHT;
  const gridPenalty =
    overrides.gridPenaltyPerPosition ??
    (ctx.circuitType != null ? GRID_PENALTY_PER_POSITION[ctx.circuitType] : undefined) ??
    GRID_PENALTY_DEFAULT;
  const safetyCarProbability =
    overrides.safetyCarProbability ??
    (ctx.circuitType != null ? SAFETY_CAR_PROBABILITY[ctx.circuitType] : undefined) ??
    SAFETY_CAR_PROBABILITY_DEFAULT;

  const tallies: Tally[] = entrants.map(() => ({
    wins: 0,
    podiums: 0,
    points: 0,
    dnfs: 0,
    finishPositionSum: 0,
    finishCount: 0,
    gridSum: 0,
    pointsSum: 0,
  }));

  // Scratch arrays reused across iterations — at 8,000 iterations x 20 cars,
  // reallocating per iteration is a meaningful share of total runtime.
  const grid = new Array<number>(n);
  const effectivePace = new Array<number>(n);
  const retired = new Array<boolean>(n);
  const order = new Array<number>(n);

  for (let iter = 0; iter < iterations; iter++) {
    // --- 1. grid ---
    if (ctx.hasRealGrid) {
      for (let i = 0; i < n; i++) {
        // A driver without a qualifying position (didn't set a time) starts last.
        grid[i] = entrants[i].gridPosition ?? n;
      }
    } else {
      // Simulate qualifying: pace plus a wider one-lap noise term, ranked.
      // Where a driver has recent qualifying form, blend it in — one-lap
      // pace is a distinguishable skill from race pace, and the grid it
      // produces then feeds the (heavily weighted) grid penalty below.
      for (let i = 0; i < n; i++) {
        order[i] = i;
        const e = entrants[i];
        const qualiBase =
          e.qualiForm != null
            ? e.expectedPace * (1 - QUALI_FORM_BLEND) + e.qualiForm * QUALI_FORM_BLEND
            : e.expectedPace;
        effectivePace[i] = qualiBase + sampleNormal(rng, 0, qualiNoise);
      }
      order.sort((a, b) => effectivePace[a] - effectivePace[b]);
      for (let pos = 0; pos < n; pos++) grid[order[pos]] = pos + 1;
    }

    // --- 2-4. race pace, retirements, safety car ---
    const safetyCar = sampleBernoulli(rng, safetyCarProbability);

    for (let i = 0; i < n; i++) {
      const e = entrants[i];
      retired[i] = sampleBernoulli(rng, e.dnfRate);
      const paceRoll = e.expectedPace + sampleNormal(rng, 0, paceNoise);
      // Grid position is a real handicap: a fast car starting 15th loses time
      // stuck behind slower cars, and how much depends on the circuit.
      // Race craft shifts the effective slot: a driver who reliably beats
      // their grid position is simulated as starting further forward, which
      // is where that skill actually shows up.
      const effectiveGrid = grid[i] - (e.raceCraft ?? 0) * raceCraftWeight;
      const gridCost = Math.max(0, effectiveGrid - 1) * gridPenalty;
      effectivePace[i] = paceRoll + gridCost;
      tallies[i].gridSum += grid[i];
    }

    // A safety car has to be modelled as *shuffling*, not as a uniform
    // slowdown. Any monotonic transform applied equally to every car — a
    // shared multiplier, or shrinking all cars toward the field mean —
    // preserves the running order exactly and therefore cannot change a
    // single finishing position (verified: sweeping the old multiplier
    // changed no metric at all). What a safety car really does is compress
    // the gaps and then redistribute position through pit-window luck, so
    // it shrinks each car's advantage toward the field mean *and* adds a
    // burst of extra noise on top, which is what actually reorders cars.
    if (safetyCar) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += effectivePace[i];
      const fieldMean = sum / n;
      const shuffle =
        paceNoise * (overrides.safetyCarShuffleFactor ?? SAFETY_CAR_SHUFFLE_FACTOR);
      for (let i = 0; i < n; i++) {
        effectivePace[i] =
          fieldMean +
          (effectivePace[i] - fieldMean) * scCompression +
          sampleNormal(rng, 0, shuffle);
      }
    }

    // --- 5. finishing order ---
    // Finishers sort by effective pace; retirements are classified behind all
    // of them, which matches how F1 orders a DNF in the final standings.
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => {
      if (retired[a] !== retired[b]) return retired[a] ? 1 : -1;
      return effectivePace[a] - effectivePace[b];
    });

    // --- 6. record ---
    for (let pos = 0; pos < n; pos++) {
      const i = order[pos];
      const t = tallies[i];
      if (retired[i]) {
        t.dnfs++;
        continue;
      }
      const finishPosition = pos + 1;
      t.finishPositionSum += finishPosition;
      t.finishCount++;
      if (finishPosition === 1) t.wins++;
      if (finishPosition <= 3) t.podiums++;
      if (finishPosition <= POINTS_BY_POSITION.length) {
        t.points++;
        t.pointsSum += POINTS_BY_POSITION[finishPosition - 1];
      }
    }

    if (progressInterval && (iter + 1) % progressInterval === 0 && iter + 1 < iterations) {
      const snapshot = buildOutcome(ctx, entrants, tallies, iter + 1);
      onProgress?.(iter + 1, snapshot);
      yield snapshot;
    }
  }

  return buildOutcome(ctx, entrants, tallies, iterations);
}

function buildOutcome(
  ctx: SimContext,
  entrants: SimEntrant[],
  tallies: Tally[],
  completed: number,
): SimulationOutcome {
  const drivers: DriverOutcome[] = entrants.map((e, i) => {
    const t = tallies[i];
    return {
      driverId: e.driverId,
      driverName: e.driverName,
      teamName: e.teamName,
      avgFinishPosition: t.finishCount > 0 ? t.finishPositionSum / t.finishCount : null,
      winPct: t.wins / completed,
      podiumPct: t.podiums / completed,
      pointsPct: t.points / completed,
      dnfPct: t.dnfs / completed,
      avgPoints: t.pointsSum / completed,
      avgGridPosition: completed > 0 ? t.gridSum / completed : null,
      expectedPace: e.expectedPace,
      signals: e.signals,
    };
  });

  drivers.sort((a, b) => b.winPct - a.winPct || b.podiumPct - a.podiumPct || b.avgPoints - a.avgPoints);

  return {
    raceId: ctx.raceId,
    iterations: completed,
    hasRealGrid: ctx.hasRealGrid,
    gridIsProvisional: ctx.gridIsProvisional,
    drivers,
  };
}
