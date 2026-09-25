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
import { computeRaceCraft } from "@/ratings/race-craft";
import {
  PACE_WEIGHTS,
  DEFAULT_DNF_RATE,
  MIN_DNF_RATE,
  MAX_DNF_RATE,
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
  };
  /** Recent qualifying form, used to seed a simulated grid when qualifying hasn't happened. */
  qualiForm: number | null;
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
): Promise<SimContext | null> {
  const weights = { ...PACE_WEIGHTS, ...weightOverrides };
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

  const [ratingRows, teamRatingRows, qualiRows, gridRows, racePaceProjection] = await Promise.all([
    db
      .select({
        driverId: driverRatings.driverId,
        driverName: drivers.name,
        basePace: driverRatings.basePace,
        driverReliability: driverRatings.driverReliability,
        trackAffinity: driverRatings.trackAffinity,
        practicePace: driverRatings.practicePace,
      })
      .from(driverRatings)
      .innerJoin(drivers, eq(driverRatings.driverId, drivers.id))
      .where(eq(driverRatings.raceId, raceId)),
    db
      .select({ teamId: teamRatings.teamId, carStrength: teamRatings.carStrength })
      .from(teamRatings)
      .where(eq(teamRatings.raceId, raceId)),
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
    computeRacePaceProjection(raceId),
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

  const gridByDriver =
    realGridByDriver.size > 0
      ? realGridByDriver
      : qualiByDriver.size > 0
        ? qualiByDriver
        : derivedGrid;
  const hasRealGrid = gridByDriver.size > 0;
  const gridIsProvisional =
    realGridByDriver.size === 0 && qualiByDriver.size === 0 && derivedGrid.size > 0;

  let fieldDriverIds: Set<number>;
  if (hasRealGrid) {
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
  const [teamsByDriver, qualiFormByDriver, raceCraftByDriver] = await Promise.all([
    getDriverTeamsAsOf(raceId, fieldDriverIdList),
    computeQualiForm(raceId, fieldDriverIdList),
    computeRaceCraft(race.season, race.round),
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
    const raceCraft = raceCraftByDriver.get(r.driverId)?.value ?? null;

    const expectedPace = composePace([
      { value: r.basePace, weight: weights.basePace },
      { value: r.practicePace, weight: weights.practicePace },
      { value: projection, weight: weights.racePaceProjection },
      { value: carStrength, weight: weights.carStrength },
      { value: r.trackAffinity, weight: weights.trackAffinity },
      { value: qualiForm, weight: weights.qualiForm },
    ]);
    // A driver with no pace signal at all can't be meaningfully simulated;
    // including them at an assumed pace would invent a result from nothing.
    if (expectedPace == null) continue;

    const rawDnf = r.driverReliability ?? DEFAULT_DNF_RATE;
    entrants.push({
      driverId: r.driverId,
      driverName: r.driverName,
      teamId: team?.teamId ?? null,
      teamName: team?.teamName ?? null,
      expectedPace,
      dnfRate: Math.min(MAX_DNF_RATE, Math.max(MIN_DNF_RATE, rawDnf)),
      gridPosition: gridByDriver.get(r.driverId) ?? null,
      qualiForm,
      raceCraft,
      signals: {
        basePace: r.basePace != null,
        practicePace: r.practicePace != null,
        racePaceProjection: projection != null,
        carStrength: carStrength != null,
        trackAffinity: r.trackAffinity != null,
        qualiForm: qualiForm != null,
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
async function deriveGridFromQualifyingLaps(raceId: number): Promise<Map<number, number>> {
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
