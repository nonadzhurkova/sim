import { db } from "@/db";
import { races, raceResults } from "@/db/schema";
import { eq, and, gt, asc } from "drizzle-orm";
import { buildSimContext, type SimContext } from "./entrants";
import { createRng, sampleNormal, sampleBernoulli } from "./random";
import { getStandings } from "@/queries/standings";
import {
  PACE_NOISE_STD_DEV,
  QUALI_NOISE_STD_DEV,
  QUALI_FORM_BLEND,
  GRID_PENALTY_PER_POSITION,
  GRID_PENALTY_DEFAULT,
  SAFETY_CAR_PROBABILITY,
  SAFETY_CAR_PROBABILITY_DEFAULT,
  SAFETY_CAR_COMPRESSION,
  SAFETY_CAR_SHUFFLE_FACTOR,
  POINTS_BY_POSITION,
} from "./params";

/**
 * Championship prediction: simulates every remaining race of the season and
 * accumulates points onto the standings as they actually are today.
 *
 * The key difference from a single-race simulation is that the whole season
 * must be simulated *within one iteration* — a driver's title chance depends
 * on correlated outcomes across races (the same fast car tends to keep
 * winning), so running each race independently and combining the averages
 * would understate how decisive a points lead already is.
 */

export type TitleOdds = {
  id: number;
  name: string;
  teamName: string | null;
  headshotUrl: string | null;
  /** Points already scored. */
  currentPoints: number;
  currentPosition: number;
  /** Mean final points across all simulated seasons. */
  projectedPoints: number;
  titlePct: number;
  top3Pct: number;
  /** Mean final championship position. */
  avgFinalPosition: number;
  /**
   * Probability of finishing in each championship position, index 0 = P1.
   * Kept because a title can be effectively settled long before the season
   * ends — once the leader is at 100%, the live question is who takes 2nd,
   * 3rd and 4th, and a single title percentage cannot show that.
   */
  positionPct: number[];
};

/** Positions tracked individually before being grouped as "outside". */
export const TRACKED_POSITIONS = 6;

export type SeasonProjection = {
  season: number;
  iterations: number;
  racesRemaining: number;
  roundsScored: number;
  drivers: TitleOdds[];
  teams: TitleOdds[];
  /** True when the season is over and these are just the final standings. */
  complete: boolean;
};

/** Fewer iterations than a single race: each one simulates many races. */
const DEFAULT_SEASON_ITERATIONS = 2000;

/**
 * Simulates one race and returns the finishing order as entrant indices.
 * A trimmed copy of the single-race engine: the season model needs only the
 * order, not the full per-driver statistics, and runs it thousands of times
 * across many races.
 */
function simulateRaceOrder(
  ctx: SimContext,
  rng: () => number,
  scratch: { pace: number[]; grid: number[]; retired: boolean[]; order: number[] },
): { order: number[]; retired: boolean[] } {
  const n = ctx.entrants.length;
  const { pace, grid, retired, order } = scratch;
  const type = ctx.circuitType;
  const gridPenalty =
    (type != null ? GRID_PENALTY_PER_POSITION[type] : undefined) ?? GRID_PENALTY_DEFAULT;
  const scProbability =
    (type != null ? SAFETY_CAR_PROBABILITY[type] : undefined) ?? SAFETY_CAR_PROBABILITY_DEFAULT;

  // Grid. A future race has no qualifying, so it is simulated every time —
  // which is also what makes each simulated season differ from the last.
  if (ctx.hasRealGrid) {
    for (let i = 0; i < n; i++) grid[i] = ctx.entrants[i].gridPosition ?? n;
  } else {
    for (let i = 0; i < n; i++) {
      order[i] = i;
      const e = ctx.entrants[i];
      const base =
        e.qualiForm != null
          ? e.expectedPace * (1 - QUALI_FORM_BLEND) + e.qualiForm * QUALI_FORM_BLEND
          : e.expectedPace;
      pace[i] = base + sampleNormal(rng, 0, QUALI_NOISE_STD_DEV);
    }
    order.sort((a, b) => pace[a] - pace[b]);
    for (let pos = 0; pos < n; pos++) grid[order[pos]] = pos + 1;
  }

  const safetyCar = sampleBernoulli(rng, scProbability);
  for (let i = 0; i < n; i++) {
    const e = ctx.entrants[i];
    retired[i] = sampleBernoulli(rng, e.dnfRate);
    pace[i] = e.expectedPace + sampleNormal(rng, 0, PACE_NOISE_STD_DEV) + (grid[i] - 1) * gridPenalty;
  }
  if (safetyCar) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += pace[i];
    const mean = sum / n;
    const shuffle = PACE_NOISE_STD_DEV * SAFETY_CAR_SHUFFLE_FACTOR;
    for (let i = 0; i < n; i++) {
      pace[i] = mean + (pace[i] - mean) * SAFETY_CAR_COMPRESSION + sampleNormal(rng, 0, shuffle);
    }
  }

  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => {
    if (retired[a] !== retired[b]) return retired[a] ? 1 : -1;
    return pace[a] - pace[b];
  });
  return { order, retired };
}

/** One event from a streamed season projection. */
export type SeasonProgressEvent =
  | { type: "progress"; completed: number; total: number; projection: SeasonProjection }
  | { type: "done"; projection: SeasonProjection }
  | { type: "error"; error: string };

/** Convenience wrapper: runs the projection and returns only the final result. */
export async function projectSeason(
  season: number,
  iterations = DEFAULT_SEASON_ITERATIONS,
): Promise<SeasonProjection> {
  let last: SeasonProjection | null = null;
  for await (const event of streamSeasonProjection(season, iterations)) {
    if (event.type === "done") last = event.projection;
    else if (event.type === "error") throw new Error(event.error);
  }
  if (!last) throw new Error("Projection produced no result");
  return last;
}

/**
 * Projection as a stream, reporting partial odds as they converge.
 *
 * The run takes tens of seconds, so the client watches the title percentages
 * settle rather than staring at a spinner. It also yields to the event loop
 * between batches; without that the synchronous simulation would hold the
 * thread and every chunk would arrive at once at the end.
 */
export async function* streamSeasonProjection(
  season: number,
  iterations = DEFAULT_SEASON_ITERATIONS,
): AsyncGenerator<SeasonProgressEvent> {
  const standings = await getStandings(season);

  // Emit the standings as they are before any simulation runs. Loading the
  // per-race contexts below takes tens of seconds of database work on its
  // own, so without this the client sits on an empty panel throughout —
  // showing the real table immediately means the page is useful at once and
  // the projected columns fill in over it.
  const baseline = (): SeasonProjection => ({
    season,
    iterations: 0,
    racesRemaining: 0,
    roundsScored: standings.roundsScored,
    complete: false,
    drivers: standings.drivers.map((d) => ({
      id: d.driverId,
      name: d.driverName,
      teamName: d.teamName,
      headshotUrl: d.headshotUrl,
      currentPoints: d.points,
      currentPosition: d.position,
      projectedPoints: d.points,
      titlePct: 0,
      top3Pct: 0,
      avgFinalPosition: d.position,
      positionPct: new Array(TRACKED_POSITIONS).fill(0),
    })),
    teams: standings.teams.map((t) => ({
      id: t.teamId,
      name: t.teamName,
      teamName: t.teamName,
      headshotUrl: null,
      currentPoints: t.points,
      currentPosition: t.position,
      projectedPoints: t.points,
      titlePct: 0,
      top3Pct: 0,
      avgFinalPosition: t.position,
      positionPct: new Array(TRACKED_POSITIONS).fill(0),
    })),
  });
  yield { type: "progress", completed: 0, total: iterations, projection: baseline() };

  // Races still to run: scheduled for this season with no results yet.
  const scheduled = await db
    .select({ id: races.id, round: races.round })
    .from(races)
    .where(and(eq(races.season, season), gt(races.round, standings.roundsScored)))
    .orderBy(asc(races.round));

  const remaining: SimContext[] = [];
  const pendingRaceIds: number[] = [];
  for (const race of scheduled) {
    // Skip anything that somehow already has results.
    const existing = await db
      .select({ id: raceResults.id })
      .from(raceResults)
      .where(eq(raceResults.raceId, race.id))
      .limit(1);
    if (existing.length === 0) pendingRaceIds.push(race.id);
  }

  const driverMeta = new Map(
    standings.drivers.map((d) => [
      d.driverId,
      { name: d.driverName, teamName: d.teamName, headshotUrl: d.headshotUrl },
    ]),
  );
  const teamMeta = new Map(standings.teams.map((t) => [t.teamId, { name: t.teamName }]));

  // Which team each driver races for, so driver points roll up correctly.
  const teamByDriver = new Map<number, number>();
  const teamRows = await db
    .selectDistinct({ driverId: raceResults.driverId, teamId: raceResults.teamId, round: races.round })
    .from(raceResults)
    .innerJoin(races, eq(raceResults.raceId, races.id))
    .where(eq(races.season, season))
    .orderBy(asc(races.round));
  for (const r of teamRows) teamByDriver.set(r.driverId, r.teamId);

  const startingDriverPoints = new Map(standings.drivers.map((d) => [d.driverId, d.points]));
  const startingTeamPoints = new Map(standings.teams.map((t) => [t.teamId, t.points]));

  // Season already finished, or nothing simulatable left: report the table.
  if (pendingRaceIds.length === 0) {
    yield { type: "done", projection: {
      season,
      iterations: 0,
      racesRemaining: 0,
      roundsScored: standings.roundsScored,
      complete: true,
      drivers: standings.drivers.map((d) => ({
        id: d.driverId,
        name: d.driverName,
        teamName: d.teamName,
        headshotUrl: d.headshotUrl,
        currentPoints: d.points,
        currentPosition: d.position,
        projectedPoints: d.points,
        titlePct: d.position === 1 ? 1 : 0,
        top3Pct: d.position <= 3 ? 1 : 0,
        avgFinalPosition: d.position,
        positionPct: Array.from({ length: TRACKED_POSITIONS }, (_, i) => (d.position === i + 1 ? 1 : 0)),
      })),
      teams: standings.teams.map((t) => ({
        id: t.teamId,
        name: t.teamName,
        teamName: t.teamName,
        headshotUrl: null,
        currentPoints: t.points,
        currentPosition: t.position,
        projectedPoints: t.points,
        titlePct: t.position === 1 ? 1 : 0,
        top3Pct: t.position <= 3 ? 1 : 0,
        avgFinalPosition: t.position,
        positionPct: Array.from({ length: TRACKED_POSITIONS }, (_, i) => (t.position === i + 1 ? 1 : 0)),
      })),
    } };
    return;
  }

  // Tallies across simulated seasons.
  const driverIds = [...startingDriverPoints.keys()];
  const teamIds = [...startingTeamPoints.keys()];
  const dTitle = new Map(driverIds.map((id) => [id, 0]));
  const dTop3 = new Map(driverIds.map((id) => [id, 0]));
  const dPoints = new Map(driverIds.map((id) => [id, 0]));
  const dPosition = new Map(driverIds.map((id) => [id, 0]));
  const tTitle = new Map(teamIds.map((id) => [id, 0]));
  const tTop3 = new Map(teamIds.map((id) => [id, 0]));
  const tPoints = new Map(teamIds.map((id) => [id, 0]));
  const tPosition = new Map(teamIds.map((id) => [id, 0]));
  const dPositionHits = new Map(driverIds.map((id) => [id, new Array(TRACKED_POSITIONS).fill(0)]));
  const tPositionHits = new Map(teamIds.map((id) => [id, new Array(TRACKED_POSITIONS).fill(0)]));

  const rng = createRng(season * 1000 + standings.roundsScored);
  const scratch = {
    pace: new Array<number>(30),
    grid: new Array<number>(30),
    retired: new Array<boolean>(30),
    order: new Array<number>(30),
  };

  let completed = 0;
  const progressInterval = Math.max(10, Math.floor(iterations / 40));

  /** Clears every tally, for when the set of simulated races changes. */
  const resetTallies = () => {
    completed = 0;
    for (const id of driverIds) {
      dTitle.set(id, 0);
      dTop3.set(id, 0);
      dPoints.set(id, 0);
      dPosition.set(id, 0);
      dPositionHits.set(id, new Array(TRACKED_POSITIONS).fill(0));
    }
    for (const id of teamIds) {
      tTitle.set(id, 0);
      tTop3.set(id, 0);
      tPoints.set(id, 0);
      tPosition.set(id, 0);
      tPositionHits.set(id, new Array(TRACKED_POSITIONS).fill(0));
    }
  };

  // Load the first race, then start simulating immediately and fold in each
  // further race as it loads. Building all nine contexts up front costs tens
  // of seconds of database work before a single season is simulated, which
  // is most of the wall time and leaves nothing to show meanwhile.
  //
  // Tallies reset whenever a race is added, because a projection over five
  // remaining races is not comparable with one over nine — mixing them would
  // quietly average two different questions together.
  let loadedUpTo = 0;
  const loadNextRace = async (): Promise<boolean> => {
    while (loadedUpTo < pendingRaceIds.length) {
      const ctx = await buildSimContext(pendingRaceIds[loadedUpTo]);
      loadedUpTo++;
      if (ctx) {
        remaining.push(ctx);
        return true;
      }
    }
    return false;
  };

  await loadNextRace();
  if (remaining.length === 0) {
    yield { type: "done", projection: baseline() };
    return;
  }

  for (let iter = 0; iter < iterations; iter++) {
    const seasonDriver = new Map(startingDriverPoints);
    const seasonTeam = new Map(startingTeamPoints);

    // One whole season per iteration, so results stay correlated across races.
    for (const ctx of remaining) {
      const { order, retired } = simulateRaceOrder(ctx, rng, scratch);
      let scoring = 0;
      for (let pos = 0; pos < order.length; pos++) {
        const i = order[pos];
        if (retired[i]) continue;
        scoring++;
        if (scoring > POINTS_BY_POSITION.length) break;
        const points = POINTS_BY_POSITION[scoring - 1];
        const driverId = ctx.entrants[i].driverId;
        seasonDriver.set(driverId, (seasonDriver.get(driverId) ?? 0) + points);
        const teamId = ctx.entrants[i].teamId ?? teamByDriver.get(driverId);
        if (teamId != null) seasonTeam.set(teamId, (seasonTeam.get(teamId) ?? 0) + points);
      }
    }

    const rankAndTally = (
      totals: Map<number, number>,
      title: Map<number, number>,
      top3: Map<number, number>,
      points: Map<number, number>,
      position: Map<number, number>,
      positionHits: Map<number, number[]>,
    ) => {
      const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      ranked.forEach(([id, total], idx) => {
        points.set(id, (points.get(id) ?? 0) + total);
        position.set(id, (position.get(id) ?? 0) + idx + 1);
        if (idx === 0) title.set(id, (title.get(id) ?? 0) + 1);
        if (idx < 3) top3.set(id, (top3.get(id) ?? 0) + 1);
        // Per-position counts, so "who finishes 3rd or 4th" is answerable
        // rather than collapsed into a single title percentage.
        const hits = positionHits.get(id);
        if (hits && idx < TRACKED_POSITIONS) hits[idx]++;
      });
    };
    rankAndTally(seasonDriver, dTitle, dTop3, dPoints, dPosition, dPositionHits);
    rankAndTally(seasonTeam, tTitle, tTop3, tPoints, tPosition, tPositionHits);
    completed++;

    // Report roughly 40 times over the run, and hand the event loop back so
    // the chunks actually reach the client instead of buffering to the end.
    if (completed % progressInterval === 0 && completed < iterations) {
      yield {
        type: "progress",
        completed,
        total: iterations,
        projection: buildProjection(completed),
      };
      await new Promise((resolve) => setImmediate(resolve));

      // Fold in the next race, if any are still unloaded. Each checkpoint
      // adds one, so the projection widens toward the full remaining calendar
      // while the user is already looking at meaningful numbers.
      if (loadedUpTo < pendingRaceIds.length) {
        const added = await loadNextRace();
        if (added) {
          resetTallies();
          iter = -1; // restart the count now the race set has changed
        }
      }
    }
  }

  yield { type: "done", projection: buildProjection(completed) };

  /** Assembles the projection from the tallies so far. */
  function buildProjection(done: number): SeasonProjection {
    const safe = Math.max(1, done);
    const driverOdds: TitleOdds[] = driverIds
      .map((id) => {
        const meta = driverMeta.get(id);
        const standing = standings.drivers.find((d) => d.driverId === id);
        return {
          id,
          name: meta?.name ?? "Unknown",
          teamName: meta?.teamName ?? null,
          headshotUrl: meta?.headshotUrl ?? null,
          currentPoints: startingDriverPoints.get(id) ?? 0,
          currentPosition: standing?.position ?? 0,
          projectedPoints: (dPoints.get(id) ?? 0) / safe,
          titlePct: (dTitle.get(id) ?? 0) / safe,
          top3Pct: (dTop3.get(id) ?? 0) / safe,
          avgFinalPosition: (dPosition.get(id) ?? 0) / safe,
          positionPct: (dPositionHits.get(id) ?? []).map((h) => h / safe),
        };
      })
      .sort((a, b) => b.titlePct - a.titlePct || b.projectedPoints - a.projectedPoints);

    const teamOdds: TitleOdds[] = teamIds
      .map((id) => {
        const standing = standings.teams.find((t) => t.teamId === id);
        return {
          id,
          name: teamMeta.get(id)?.name ?? "Unknown",
          teamName: teamMeta.get(id)?.name ?? null,
          headshotUrl: null,
          currentPoints: startingTeamPoints.get(id) ?? 0,
          currentPosition: standing?.position ?? 0,
          projectedPoints: (tPoints.get(id) ?? 0) / safe,
          titlePct: (tTitle.get(id) ?? 0) / safe,
          top3Pct: (tTop3.get(id) ?? 0) / safe,
          avgFinalPosition: (tPosition.get(id) ?? 0) / safe,
          positionPct: (tPositionHits.get(id) ?? []).map((h) => h / safe),
        };
      })
      .sort((a, b) => b.titlePct - a.titlePct || b.projectedPoints - a.projectedPoints);

    return {
      season,
      iterations: done,
      // Reported as the number actually being simulated, which grows as
      // contexts load, so the header cannot claim more than it is modelling.
      racesRemaining: remaining.length,
      roundsScored: standings.roundsScored,
      complete: false,
      drivers: driverOdds,
      teams: teamOdds,
    };
  }
}

