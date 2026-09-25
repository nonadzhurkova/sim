import { db } from "@/db";
import {
  drivers,
  teams,
  races,
  circuits,
  raceResults,
  qualifyingResults,
  driverRatings,
} from "@/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

/**
 * Everything the driver page shows, assembled from stored results.
 *
 * All of this comes from the database rather than a live API call: unlike the
 * telemetry analysis, a driver's results history doesn't change between page
 * loads, so there's nothing to gain from fetching it each time.
 */

export type DriverRaceRow = {
  raceId: number;
  season: number;
  round: number;
  circuitName: string;
  date: string;
  teamName: string | null;
  gridPosition: number | null;
  finishPosition: number | null;
  status: "finished" | "dnf" | "dsq" | null;
  qualifyingPosition: number | null;
  gapToPole: number | null;
  /** Positions gained from grid to finish; null if either is unknown. */
  placesGained: number | null;
};

export type SeasonSummary = {
  season: number;
  races: number;
  wins: number;
  poles: number;
  podiums: number;
  pointsFinishes: number;
  /** Championship points, computed from finishing positions. */
  points: number;
  dnfs: number;
  /** Races where this driver out-qualified their team-mate. */
  qualiWins: number;
  qualiBattles: number;
  avgGrid: number | null;
  avgFinish: number | null;
  bestFinish: number | null;
  bestGrid: number | null;
};

/** Current F1 scoring for positions 1-10. */
const POINTS_BY_POSITION = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export type DriverProfile = {
  driverId: number;
  name: string;
  nationality: string | null;
  dateOfBirth: string | null;
  currentTeam: string | null;
  /** Driver number and headshot, from OpenF1 where available. */
  driverNumber: number | null;
  headshotUrl: string | null;
  recentRaces: DriverRaceRow[];
  seasonSummaries: SeasonSummary[];
  /** Latest stored ratings, so the page explains what the model thinks. */
  ratings: {
    basePace: number | null;
    driverReliability: number | null;
    trackAffinity: number | null;
    practicePace: number | null;
    asOfSeason: number;
    asOfRound: number;
  } | null;
};

const RECENT_RACE_COUNT = 10;

export async function listDrivers(season: number) {
  // Drivers who actually appear in this season's results, so the picker isn't
  // every driver in history.
  const rows = await db
    .selectDistinct({ id: drivers.id, name: drivers.name })
    .from(raceResults)
    .innerJoin(drivers, eq(raceResults.driverId, drivers.id))
    .innerJoin(races, eq(raceResults.raceId, races.id))
    .where(eq(races.season, season));

  // Mid-season a driver may have qualified but not yet raced.
  const qualiOnly = await db
    .selectDistinct({ id: drivers.id, name: drivers.name })
    .from(qualifyingResults)
    .innerJoin(drivers, eq(qualifyingResults.driverId, drivers.id))
    .innerJoin(races, eq(qualifyingResults.raceId, races.id))
    .where(eq(races.season, season));

  const byId = new Map<number, { id: number; name: string }>();
  for (const r of [...rows, ...qualiOnly]) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDriverProfile(driverId: number): Promise<DriverProfile | null> {
  const [driver] = await db
    .select({
      id: drivers.id,
      name: drivers.name,
      nationality: drivers.nationality,
      dateOfBirth: drivers.dateOfBirth,
      driverNumber: drivers.driverNumber,
      headshotUrl: drivers.headshotUrl,
    })
    .from(drivers)
    .where(eq(drivers.id, driverId));
  if (!driver) return null;

  // Full results history, newest first.
  const results = await db
    .select({
      raceId: races.id,
      season: races.season,
      round: races.round,
      date: races.date,
      circuitName: circuits.name,
      teamName: teams.name,
      gridPosition: raceResults.gridPosition,
      finishPosition: raceResults.finishPosition,
      status: raceResults.status,
    })
    .from(raceResults)
    .innerJoin(races, eq(raceResults.raceId, races.id))
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .innerJoin(teams, eq(raceResults.teamId, teams.id))
    .where(eq(raceResults.driverId, driverId))
    .orderBy(desc(races.season), desc(races.round));

  const qualifying = await db
    .select({
      raceId: qualifyingResults.raceId,
      position: qualifyingResults.position,
      gapToPole: qualifyingResults.gapToPole,
    })
    .from(qualifyingResults)
    .where(eq(qualifyingResults.driverId, driverId));
  const qualiByRace = new Map(qualifying.map((q) => [q.raceId, q]));

  // Team-mate qualifying positions, for the intra-team head-to-head. Fetched
  // as every qualifying row for the races this driver took part in, then
  // narrowed to the same team — the cleanest like-for-like comparison there
  // is, since both drivers have the same car.
  const raceIds = results.map((r) => r.raceId);
  const teammateQuali =
    raceIds.length > 0
      ? await db
          .select({
            raceId: qualifyingResults.raceId,
            driverId: qualifyingResults.driverId,
            teamId: qualifyingResults.teamId,
            position: qualifyingResults.position,
          })
          .from(qualifyingResults)
          .where(inArray(qualifyingResults.raceId, raceIds))
      : [];
  const ownTeamByRace = new Map<number, number>();
  const ownQualiTeam = teammateQuali.filter((q) => q.driverId === driverId);
  for (const q of ownQualiTeam) ownTeamByRace.set(q.raceId, q.teamId);

  const recentRaces: DriverRaceRow[] = results.slice(0, RECENT_RACE_COUNT).map((r) => {
    const q = qualiByRace.get(r.raceId);
    return {
      raceId: r.raceId,
      season: r.season,
      round: r.round,
      circuitName: r.circuitName,
      date: r.date,
      teamName: r.teamName,
      gridPosition: r.gridPosition,
      finishPosition: r.finishPosition,
      status: r.status,
      qualifyingPosition: q?.position ?? null,
      gapToPole: q?.gapToPole ?? null,
      placesGained:
        r.gridPosition != null && r.finishPosition != null && r.status === "finished"
          ? r.gridPosition - r.finishPosition
          : null,
    };
  });

  // Per-season summary rows, newest season first.
  const bySeason = new Map<number, typeof results>();
  for (const r of results) {
    if (!bySeason.has(r.season)) bySeason.set(r.season, []);
    bySeason.get(r.season)!.push(r);
  }
  const seasonSummaries: SeasonSummary[] = [...bySeason.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([s, rs]) => {
      const finished = rs.filter((r) => r.status === "finished" && r.finishPosition != null);
      const grids = rs.map((r) => r.gridPosition).filter((g): g is number => g != null && g > 0);
      const finishes = finished.map((r) => r.finishPosition as number);
      const mean = (xs: number[]) =>
        xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

      const seasonRaceIds = new Set(rs.map((r) => r.raceId));
      const poles = [...qualiByRace.entries()].filter(
        ([raceId, q]) => seasonRaceIds.has(raceId) && q.position === 1,
      ).length;

      // Team-mate qualifying head-to-head: both cars are identical, so this
      // isolates the driver from the machinery better than any other stat here.
      let qualiWins = 0;
      let qualiBattles = 0;
      for (const raceId of seasonRaceIds) {
        const own = qualiByRace.get(raceId);
        const teamId = ownTeamByRace.get(raceId);
        if (own?.position == null || teamId == null) continue;
        const mate = teammateQuali.find(
          (q) => q.raceId === raceId && q.teamId === teamId && q.driverId !== driverId,
        );
        if (mate?.position == null) continue;
        qualiBattles++;
        if (own.position < mate.position) qualiWins++;
      }

      return {
        season: s,
        races: rs.length,
        wins: finishes.filter((f) => f === 1).length,
        poles,
        podiums: finishes.filter((f) => f <= 3).length,
        pointsFinishes: finishes.filter((f) => f <= 10).length,
        points: finishes.reduce(
          (total, f) => total + (f <= POINTS_BY_POSITION.length ? POINTS_BY_POSITION[f - 1] : 0),
          0,
        ),
        dnfs: rs.filter((r) => r.status !== "finished").length,
        qualiWins,
        qualiBattles,
        avgGrid: mean(grids),
        avgFinish: mean(finishes),
        bestFinish: finishes.length > 0 ? Math.min(...finishes) : null,
        bestGrid: grids.length > 0 ? Math.min(...grids) : null,
      };
    });

  // Most recent stored ratings for this driver.
  const [rating] = await db
    .select({
      basePace: driverRatings.basePace,
      driverReliability: driverRatings.driverReliability,
      trackAffinity: driverRatings.trackAffinity,
      practicePace: driverRatings.practicePace,
      season: races.season,
      round: races.round,
    })
    .from(driverRatings)
    .innerJoin(races, eq(driverRatings.raceId, races.id))
    .where(eq(driverRatings.driverId, driverId))
    .orderBy(desc(races.season), desc(races.round))
    .limit(1);

  return {
    driverId: driver.id,
    name: driver.name,
    nationality: driver.nationality,
    dateOfBirth: driver.dateOfBirth,
    currentTeam: results[0]?.teamName ?? null,
    driverNumber: driver.driverNumber,
    headshotUrl: driver.headshotUrl,
    recentRaces,
    seasonSummaries,
    ratings: rating
      ? {
          basePace: rating.basePace,
          driverReliability: rating.driverReliability,
          trackAffinity: rating.trackAffinity,
          practicePace: rating.practicePace,
          asOfSeason: rating.season,
          asOfRound: rating.round,
        }
      : null,
  };
}

/**
 * Same-circuit history: how this driver has gone at one particular circuit in
 * previous years. Answers "how did they do here last year?" directly.
 */
export async function getDriverCircuitHistory(
  driverId: number,
  circuitId: number,
): Promise<DriverRaceRow[]> {
  const results = await db
    .select({
      raceId: races.id,
      season: races.season,
      round: races.round,
      date: races.date,
      circuitName: circuits.name,
      teamName: teams.name,
      gridPosition: raceResults.gridPosition,
      finishPosition: raceResults.finishPosition,
      status: raceResults.status,
    })
    .from(raceResults)
    .innerJoin(races, eq(raceResults.raceId, races.id))
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .innerJoin(teams, eq(raceResults.teamId, teams.id))
    .where(and(eq(raceResults.driverId, driverId), eq(races.circuitId, circuitId)))
    .orderBy(desc(races.season));

  const qualifying = await db
    .select({
      raceId: qualifyingResults.raceId,
      position: qualifyingResults.position,
      gapToPole: qualifyingResults.gapToPole,
    })
    .from(qualifyingResults)
    .where(eq(qualifyingResults.driverId, driverId));
  const qualiByRace = new Map(qualifying.map((q) => [q.raceId, q]));

  return results.map((r) => {
    const q = qualiByRace.get(r.raceId);
    return {
      ...r,
      qualifyingPosition: q?.position ?? null,
      gapToPole: q?.gapToPole ?? null,
      placesGained:
        r.gridPosition != null && r.finishPosition != null && r.status === "finished"
          ? r.gridPosition - r.finishPosition
          : null,
    };
  });
}

/** Total races in a season, for "X of Y" style context. */
export async function countSeasonRaces(season: number): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(races)
    .where(eq(races.season, season));
  return Number(count);
}
