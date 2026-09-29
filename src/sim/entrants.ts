import { db } from "@/db";
import {
  races,
  circuits,
  drivers,
  driverRatings,
  teamRatings,
  qualifyingResults,
  raceResults,
  sessions,
  laps,
} from "@/db/schema";
import { eq, and, lt, or, desc } from "drizzle-orm";
import { getDriverTeamsAsOf } from "@/queries/driver-teams";
import { computeRacePaceProjection } from "@/ratings/practice-pace";
import { computeQualiForm } from "@/ratings/quali-form";
import { computeRaceForm } from "@/ratings/race-form";
import { computeRaceCraft } from "@/ratings/race-craft";
import { sampleNormal, sampleBernoulli } from "./random";
import {
  PACE_WEIGHTS,
  DEFAULT_DNF_RATE,
  MIN_DNF_RATE,
  MAX_DNF_RATE,
  QUALI_FORM_BLEND,
} from "./params";

/** One driver's fixed inputs for a simulation run — ratings resolved to numbers. */
export type SimEntrant = {
  driverId: number;
  driverName: string;
  teamId: number | null;
  teamName: string | null;
  /** Expected field-relative race pace, seconds/lap. Negative = faster. */
  expectedPace: number;
  /** Per-race DNF probability, clamped. */
  dnfRate: number;
  /** Real grid position if qualifying has happened, else null (simulate it). */
  gridPosition: number | null;
  /** Which signals actually backed expectedPace — surfaced in the UI so a prediction built on thin data is visible as such. */
  signals: {
    basePace: boolean;
    practicePace: boolean;
    racePaceProjection: boolean;
    carStrength: boolean;
    trackAffinity: boolean;
    qualiForm: boolean;
    raceForm: boolean;
  };
  /** Recent qualifying form, used to seed a simulated grid when qualifying hasn't happened. */
  qualiForm: number | null;
  /** expectedPace's composition without qualiForm folded in — see engine.ts's simulated-grid blend for why this exists separately (avoids double-counting qualiForm). */
  racePaceExQualiForm: number;
  /** Recent race form — field-relative race pace over the driver's last few races. */
  raceForm: number | null;
  /** Kalman posterior variance on the driver's pace estimate — shrinks with sample size. Scales per-iteration pace noise. */
  paceUncertainty: number | null;
  /**
   * Positions this driver typically beats their grid slot by. Applied as an
   * effective grid offset rather than a pace change: it models converting a
   * starting position, not raw speed.
   */
  raceCraft: number | null;
};

export type SimContext = {
  raceId: number;
  season: number;
  round: number;
  circuitType: string | null;
  /** True when the grid comes from real qualifying rather than being simulated. */
  hasRealGrid: boolean;
  /**
   * True when the grid was reconstructed from qualifying lap times because
   * the classified results aren't published yet. Accurate as an order, but it
   * cannot know about grid penalties or pit-lane starts.
   */
  gridIsProvisional: boolean;
  entrants: SimEntrant[];
};

/**
 * One driver's simulated one-lap qualifying pace for a single Monte Carlo
 * iteration -- used by both engine.ts (single-race prediction) and
 * season.ts (season/championship projection) to simulate a grid when no
 * real one exists yet. Previously implemented twice, independently; the
 * season.ts copy kept using `expectedPace` after engine.ts's copy was fixed
 * on 2026-09-27 to use `racePaceExQualiForm` instead (expectedPace already
 * has qualiForm folded in at weights.qualiForm, so blending it in again here
 * double-counts it) -- found and fixed 2026-09-28 by an outside review.
 * Pulled into one function so a third copy can't silently diverge again.
 */
export function simulatedQualiPace(
  entrant: Pick<SimEntrant, "racePaceExQualiForm" | "qualiForm">,
  rng: () => number,
  qualiNoiseStdDev: number,
): number {
  const qualiBase =
    entrant.qualiForm != null
      ? entrant.racePaceExQualiForm * (1 - QUALI_FORM_BLEND) + entrant.qualiForm * QUALI_FORM_BLEND
      : entrant.racePaceExQualiForm;
  return qualiBase + sampleNormal(rng, 0, qualiNoiseStdDev);
}

/**
 * Resolved numeric knobs for one race's simulation, after circuit-type
 * lookups and ModelOverrides/horizon-noise adjustments have already been
 * applied by the caller. Kept distinct from params.ts's raw constants so
 * this function never has to know about circuit types, overrides, or where
 * PACE_NOISE_STD_DEV itself is widened for horizon uncertainty.
 */
export type RaceIterationParams = {
  /** Per-driver pace-noise std dev (already widened by paceUncertainty and any horizon multiplier), same length/order as ctx.entrants. */
  paceNoiseByDriver: number[];
  qualiNoiseStdDev: number;
  gridPenaltyPerPosition: number;
  raceCraftWeight: number;
  safetyCarProbability: number;
  safetyCarCompression: number;
  /** Extra noise during a safety car, in absolute seconds (already multiplied by the base pace-noise std dev). */
  safetyCarShuffleStdDev: number;
};

/** Scratch arrays reused across iterations by simulateRaceIteration's caller, sized to the field. */
export type RaceIterationScratch = {
  grid: number[];
  effectivePace: number[];
  retired: boolean[];
  order: number[];
};

/**
 * Runs the shared per-iteration race logic -- grid, pace + noise, DNFs,
 * safety car, grid penalty, finishing order -- used by both engine.ts
 * (single-race prediction) and season.ts (season/championship projection).
 *
 * Pulled out as one function after the two call sites drifted once already
 * (season.ts's own copy silently missed the raceCraft grid-position offset
 * engine.ts applied -- see this file's simulatedQualiPace doc comment for
 * the earlier, related qualiForm double-count bug). A single shared
 * implementation makes that class of bug impossible to reintroduce.
 *
 * Mutates and returns `scratch`'s arrays in place rather than allocating --
 * at thousands of iterations x ~20 cars, per-iteration allocation is a
 * meaningful share of runtime (see engine.ts's own note on this).
 */
export function simulateRaceIteration(
  ctx: Pick<SimContext, "entrants" | "hasRealGrid">,
  rng: () => number,
  params: RaceIterationParams,
  scratch: RaceIterationScratch,
): { order: number[]; retired: boolean[] } {
  const { entrants, hasRealGrid } = ctx;
  const n = entrants.length;
  const { grid, effectivePace, retired, order } = scratch;
  const {
    paceNoiseByDriver,
    qualiNoiseStdDev,
    gridPenaltyPerPosition,
    raceCraftWeight,
    safetyCarProbability,
    safetyCarCompression,
    safetyCarShuffleStdDev,
  } = params;

  // --- grid ---
  if (hasRealGrid) {
    for (let i = 0; i < n; i++) {
      grid[i] = entrants[i].gridPosition ?? n;
    }
  } else {
    for (let i = 0; i < n; i++) {
      order[i] = i;
      effectivePace[i] = simulatedQualiPace(entrants[i], rng, qualiNoiseStdDev);
    }
    order.sort((a, b) => effectivePace[a] - effectivePace[b]);
    for (let pos = 0; pos < n; pos++) grid[order[pos]] = pos + 1;
  }

  // --- race pace, retirements, safety car ---
  const safetyCar = sampleBernoulli(rng, safetyCarProbability);

  for (let i = 0; i < n; i++) {
    const e = entrants[i];
    retired[i] = sampleBernoulli(rng, e.dnfRate);
    const paceRoll = e.expectedPace + sampleNormal(rng, 0, paceNoiseByDriver[i]);
    const effectiveGrid = grid[i] - (e.raceCraft ?? 0) * raceCraftWeight;
    const gridCost = Math.max(0, effectiveGrid - 1) * gridPenaltyPerPosition;
    effectivePace[i] = paceRoll + gridCost;
  }

  if (safetyCar) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += effectivePace[i];
    const fieldMean = sum / n;
    for (let i = 0; i < n; i++) {
      effectivePace[i] =
        fieldMean +
        (effectivePace[i] - fieldMean) * safetyCarCompression +
        sampleNormal(rng, 0, safetyCarShuffleStdDev);
    }
  }

  // --- finishing order ---
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => {
    if (retired[a] !== retired[b]) return retired[a] ? 1 : -1;
    return effectivePace[a] - effectivePace[b];
  });

  return { order, retired };
}

/**
 * Combines the available pace signals into one expected-pace number.
 * Weights come from PACE_WEIGHTS and are renormalized over whichever signals
 * are present, so a missing signal dilutes nothing — it just leaves the
 * others to carry the estimate.
 */
function composePace(parts: { value: number | null; weight: number }[]): number | null {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const p of parts) {
    if (p.value == null) continue;
    weightedSum += p.value * p.weight;
    totalWeight += p.weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

/**
 * Builds the full entrant list for a race: who is racing, how fast each is
 * expected to be, how likely each is to retire, and where each starts.
 *
 * Ratings are read from the stored driver_ratings/team_ratings rows for this
 * race, which computeSeasonRatings built using only pre-race data — so this
 * stays valid for backtesting a past race, not just predicting a future one.
 *
 * The race-pace projection is computed live rather than read from a column,
 * since it's derived from this weekend's practice long runs and has no
 * stored home of its own (driver_ratings.practice_pace holds the qualifying-
 * pace signal). Mid-weekend it changes as each FP session lands.
 */
export async function buildSimContext(
  raceId: number,
  /** Overrides PACE_WEIGHTS; used by the backtest harness to calibrate them. */
  weightOverrides?: Partial<typeof PACE_WEIGHTS>,
  /**
   * Replaces driver_ratings.basePace per driver when provided — used by the
   * backtest harness to A/B the Bayesian rating (src/ratings/bayesian) against
   * the stored hand-tuned basePace without changing anything else about the
   * pipeline (practice pace, car strength, track affinity, quali form all stay
   * as-is either way).
   */
  basePaceOverride?: Map<number, number>,
  /**
   * Folds sprint-weekend sprint quali/race pace into qualiForm/raceForm as
   * extra history entries, alongside the round's main sessions. Defaults to
   * off (production behavior unchanged) — used by the backtest harness to
   * validate the idea against the 2024 holdout before it's trusted on.
   */
  includeSprintsInForm = false,
  /**
   * Ignores a real/derived grid even if one exists, forcing the same
   * simulated-qualifying path a genuine pre-qualifying prediction uses —
   * used by the backtest harness to isolate and validate the no-real-grid
   * scenario specifically (weight tuning for it needs to be measured against
   * that scenario alone, not diluted by races that already have a real grid).
   */
  forceSimulatedGrid = false,
  /**
   * See ratings/quali-form.ts's computeQualiForm — sweeps the recency-decay
   * half-life for qualifying form specifically. Not yet validated; defaults
   * to today's behavior (half-life 5, lookback 5).
   */
  qualiFormHalfLife?: number,
  qualiFormLookback?: number,
  /** See ratings/quali-form.ts's computeQualiForm — averaging mode override for the backtest harness; production leaves this unset so computeQualiForm's own "trimmed" default applies. */
  qualiFormAveragingMode?: import("@/ratings/quali-form").AveragingMode,
  /**
   * Used only by the horizon backtest (src/sim/backtest.ts): pretends ratings
   * are frozen as of this earlier race instead of `raceId`'s own row, and
   * suppresses practice pace / race-pace projection entirely (a real future
   * race has no FP sessions yet, but `raceId` here already happened
   * historically and its FP data is sitting in the DB — using it directly
   * would leak information the model wouldn't actually have had). Everything
   * else — the field, circuit type, grid (still forced simulated by the
   * caller) — still comes from `raceId` itself, since that's the race being
   * predicted. Defaults to unset, i.e. today's behavior (ratings as-of the
   * target race itself).
   */
  ratingsAsOfRaceId?: number,
): Promise<SimContext | null> {
  const weights = { ...PACE_WEIGHTS, ...weightOverrides };
  const ratingsRaceId = ratingsAsOfRaceId ?? raceId;
  const [race] = await db
    .select({
      id: races.id,
      season: races.season,
      round: races.round,
      circuitId: races.circuitId,
      circuitType: circuits.type,
    })
    .from(races)
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .where(eq(races.id, raceId));
  if (!race) return null;

  const ratingsRace =
    ratingsAsOfRaceId != null
      ? (await db
          .select({ season: races.season, round: races.round })
          .from(races)
          .where(eq(races.id, ratingsAsOfRaceId)))[0]
      : race;
  if (!ratingsRace) return null;

  const [ratingRows, teamRatingRows, qualiRows, gridRows, racePaceProjection] = await Promise.all([
    db
      .select({
        driverId: driverRatings.driverId,
        driverName: drivers.name,
        basePace: driverRatings.basePace,
        driverReliability: driverRatings.driverReliability,
        trackAffinity: driverRatings.trackAffinity,
        practicePace: driverRatings.practicePace,
        paceUncertainty: driverRatings.paceUncertainty,
      })
      .from(driverRatings)
      .innerJoin(drivers, eq(driverRatings.driverId, drivers.id))
      .where(eq(driverRatings.raceId, ratingsRaceId)),
    db
      .select({ teamId: teamRatings.teamId, carStrength: teamRatings.carStrength })
      .from(teamRatings)
      .where(eq(teamRatings.raceId, ratingsRaceId)),
    db
      .select({ driverId: qualifyingResults.driverId, position: qualifyingResults.position })
      .from(qualifyingResults)
      .where(eq(qualifyingResults.raceId, raceId)),
    // The actual starting grid, which is not the same thing as qualifying
    // order: penalties and pit-lane starts move cars, and in the ingested
    // 2026 data 19 of 22 cars at one race started somewhere other than where
    // they qualified. Only available once the race has been run, so it
    // sharpens backtests without affecting genuine pre-race predictions.
    db
      .select({ driverId: raceResults.driverId, gridPosition: raceResults.gridPosition })
      .from(raceResults)
      .where(eq(raceResults.raceId, raceId)),
    ratingsAsOfRaceId != null ? Promise.resolve(new Map()) : computeRacePaceProjection(raceId),
  ]);

  if (ratingRows.length === 0) return null;

  // Only drivers actually taking part this weekend. driver_ratings carries a
  // row for every driver with any history — including ones who have since
  // left the sport — so it can't define the field on its own. Qualifying is
  // the authority once it exists; before that, fall back to whoever has a
  // practice-pace signal this weekend (i.e. actually drove an FP session).
  // Prefer the real starting grid; fall back to qualifying order when the
  // race hasn't been run yet (the normal prediction case).
  const realGridByDriver = new Map(
    gridRows.filter((g) => g.gridPosition != null && g.gridPosition > 0).map((g) => [g.driverId, g.gridPosition as number]),
  );
  const qualiByDriver = new Map(
    qualiRows.filter((q) => q.position != null).map((q) => [q.driverId, q.position as number]),
  );
  // Third fallback: derive the order from the qualifying session's own lap
  // times. OpenF1 publishes timing within minutes of a session ending, while
  // Jolpica's classified results can lag by hours — so between the two there
  // is a window where qualifying has demonstrably happened but the grid table
  // is still empty. Simulating a grid in that window throws away the single
  // strongest predictor available, so the lap times are used instead.
  let derivedGrid = new Map<number, number>();
  if (realGridByDriver.size === 0 && qualiByDriver.size === 0) {
    derivedGrid = await deriveGridFromQualifyingLaps(raceId);
  }

  // The field (who's racing) still comes from the real grid/qualifying data
  // even under forceSimulatedGrid -- only the grid *order* is hidden, so the
  // backtest isolates "how well would the model have ranked this field
  // without knowing qualifying" rather than also hiding who showed up.
  const knownFieldIds = new Set([...realGridByDriver.keys(), ...qualiByDriver.keys(), ...derivedGrid.keys()]);

  const gridByDriver = forceSimulatedGrid
    ? new Map<number, number>()
    : realGridByDriver.size > 0
      ? realGridByDriver
      : qualiByDriver.size > 0
        ? qualiByDriver
        : derivedGrid;
  const hasRealGrid = gridByDriver.size > 0;
  const gridIsProvisional =
    !forceSimulatedGrid && realGridByDriver.size === 0 && qualiByDriver.size === 0 && derivedGrid.size > 0;

  let fieldDriverIds: Set<number>;
  if (forceSimulatedGrid && knownFieldIds.size > 0) {
    fieldDriverIds = knownFieldIds;
  } else if (hasRealGrid) {
    fieldDriverIds = new Set(gridByDriver.keys());
  } else {
    const active = ratingRows.filter(
      (r) => r.practicePace != null || racePaceProjection.has(r.driverId),
    );
    // No practice either (a purely future race): fall back to the most recent
    // prior race's entry list, which is the best available guess at the field.
    if (active.length > 0) {
      fieldDriverIds = new Set(active.map((r) => r.driverId));
    } else {
      fieldDriverIds = await getMostRecentFieldBefore(race.season, race.round);
      // Deliberately no "all rated drivers" fallback here: driver_ratings
      // spans every season ingested, so that set includes drivers who left
      // the sport years ago. Predicting a field containing them is worse
      // than admitting we don't know the field (handled by the null return).
    }
  }

  const fieldRatings = ratingRows.filter((r) => fieldDriverIds.has(r.driverId));
  if (fieldRatings.length === 0) return null;

  const fieldDriverIdList = fieldRatings.map((r) => r.driverId);
  const [teamsByDriver, qualiFormByDriver, raceFormByDriver, raceCraftByDriver] = await Promise.all([
    getDriverTeamsAsOf(ratingsRaceId, fieldDriverIdList),
    computeQualiForm(ratingsRaceId, fieldDriverIdList, qualiFormLookback ?? 5, includeSprintsInForm, qualiFormHalfLife, qualiFormAveragingMode),
    computeRaceForm(ratingsRaceId, fieldDriverIdList, 5, includeSprintsInForm),
    computeRaceCraft(ratingsRace.season, ratingsRace.round),
  ]);
  const carStrengthByTeam = new Map(
    teamRatingRows
      .filter((t) => t.carStrength != null)
      .map((t) => [t.teamId, t.carStrength as number]),
  );

  const entrants: SimEntrant[] = [];
  for (const r of fieldRatings) {
    const team = teamsByDriver.get(r.driverId) ?? null;
    const carStrength = team ? carStrengthByTeam.get(team.teamId) ?? null : null;
    const projection = racePaceProjection.get(r.driverId)?.pace ?? null;
    const qualiForm = qualiFormByDriver.get(r.driverId) ?? null;
    const raceForm = raceFormByDriver.get(r.driverId) ?? null;
    const raceCraft = raceCraftByDriver.get(r.driverId)?.value ?? null;

    const basePace = basePaceOverride?.get(r.driverId) ?? r.basePace;
    const paceParts = [
      { value: basePace, weight: weights.basePace },
      { value: r.practicePace, weight: weights.practicePace },
      { value: projection, weight: weights.racePaceProjection },
      { value: carStrength, weight: weights.carStrength },
      { value: r.trackAffinity, weight: weights.trackAffinity },
      { value: raceForm, weight: weights.raceForm },
    ];
    const expectedPace = composePace([...paceParts, { value: qualiForm, weight: weights.qualiForm }]);
    // A driver with no pace signal at all can't be meaningfully simulated;
    // including them at an assumed pace would invent a result from nothing.
    if (expectedPace == null) continue;
    // Same composite but without qualiForm, for the engine's simulated-grid
    // blend (QUALI_FORM_BLEND) to mix qualiForm into. Blending against
    // expectedPace itself would double-count qualiForm -- it's already
    // folded in above at weights.qualiForm, so a driver's simulated grid
    // would get their qualifying-form advantage twice over.
    const racePaceExQualiForm = composePace(paceParts) ?? expectedPace;

    const rawDnf = r.driverReliability ?? DEFAULT_DNF_RATE;
    entrants.push({
      driverId: r.driverId,
      driverName: r.driverName,
      teamId: team?.teamId ?? null,
      teamName: team?.teamName ?? null,
      expectedPace,
      racePaceExQualiForm,
      dnfRate: Math.min(MAX_DNF_RATE, Math.max(MIN_DNF_RATE, rawDnf)),
      gridPosition: gridByDriver.get(r.driverId) ?? null,
      qualiForm,
      raceForm,
      paceUncertainty: r.paceUncertainty,
      raceCraft,
      signals: {
        basePace: basePace != null,
        practicePace: r.practicePace != null,
        racePaceProjection: projection != null,
        carStrength: carStrength != null,
        trackAffinity: r.trackAffinity != null,
        qualiForm: qualiForm != null,
        raceForm: raceForm != null,
      },
    });
  }

  if (entrants.length === 0) return null;

  return {
    raceId,
    season: race.season,
    round: race.round,
    circuitType: race.circuitType,
    hasRealGrid,
    gridIsProvisional,
    entrants,
  };
}

/**
 * Reconstructs qualifying order from the Q session's lap times: each driver's
 * fastest clean lap, ranked. Implausibly quick laps (broken timing records,
 * which do occur in the ingested data) are discarded against the session
 * median before ranking, the same guard the session-pace tables use.
 */
export async function deriveGridFromQualifyingLaps(raceId: number): Promise<Map<number, number>> {
  const [qSession] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.raceId, raceId), eq(sessions.sessionType, "q")));
  if (!qSession) return new Map();

  const qLaps = await db
    .select({ driverId: laps.driverId, lapDuration: laps.lapDuration })
    .from(laps)
    .where(and(eq(laps.sessionId, qSession.id), eq(laps.isPitInOut, false)));

  const durations = qLaps
    .map((l) => l.lapDuration)
    .filter((d): d is number => d != null);
  if (durations.length === 0) return new Map();
  const sorted = [...durations].sort((a, b) => a - b);
  const sessionMedian = sorted[Math.floor(sorted.length / 2)];
  const minPlausible = sessionMedian * 0.8;

  const bestByDriver = new Map<number, number>();
  for (const lap of qLaps) {
    if (lap.lapDuration == null || lap.lapDuration < minPlausible) continue;
    const current = bestByDriver.get(lap.driverId);
    if (current == null || lap.lapDuration < current) bestByDriver.set(lap.driverId, lap.lapDuration);
  }

  return new Map(
    [...bestByDriver.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([driverId], i) => [driverId, i + 1]),
  );
}

/**
 * Driver ids who took part in the most recent race before (season, round)
 * that actually has an entry list.
 *
 * It is not enough to look at the immediately-preceding round: later rounds
 * of the current season exist as scheduled rows long before they're run, so
 * the nearest prior race is usually itself empty. This walks back to the
 * last race with real participation data. Qualifying is preferred over race
 * results because it includes drivers who qualified but retired on lap 1,
 * and falls back to race results where qualifying wasn't ingested.
 */
async function getMostRecentFieldBefore(season: number, round: number): Promise<Set<number>> {
  const beforeTarget = or(
    lt(races.season, season),
    and(eq(races.season, season), lt(races.round, round)),
  );

  const [latestQuali] = await db
    .select({ raceId: races.id, season: races.season, round: races.round })
    .from(races)
    .innerJoin(qualifyingResults, eq(qualifyingResults.raceId, races.id))
    .where(beforeTarget)
    .orderBy(desc(races.season), desc(races.round))
    .limit(1);

  const [latestResult] = await db
    .select({ raceId: races.id, season: races.season, round: races.round })
    .from(races)
    .innerJoin(raceResults, eq(raceResults.raceId, races.id))
    .where(beforeTarget)
    .orderBy(desc(races.season), desc(races.round))
    .limit(1);

  // Whichever source reaches closest to the target race wins; on a tie
  // (same race has both) qualifying is used, per the note above.
  const candidates = [
    latestQuali ? { ...latestQuali, source: "quali" as const } : null,
    latestResult ? { ...latestResult, source: "result" as const } : null,
  ].filter((c): c is NonNullable<typeof c> => c != null);
  if (candidates.length === 0) return new Set();

  candidates.sort(
    (a, b) => b.season - a.season || b.round - a.round || (a.source === "quali" ? -1 : 1),
  );
  const best = candidates[0];

  const rows =
    best.source === "quali"
      ? await db
          .select({ driverId: qualifyingResults.driverId })
          .from(qualifyingResults)
          .where(eq(qualifyingResults.raceId, best.raceId))
      : await db
          .select({ driverId: raceResults.driverId })
          .from(raceResults)
          .where(eq(raceResults.raceId, best.raceId));
  return new Set(rows.map((r) => r.driverId));
}
