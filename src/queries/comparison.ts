import { db } from "@/db";
import { races, raceResults, drivers, teams, driverRatings, teamRatings, sessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getRaceByRoute, type RaceSummary } from "./races";
import { getAllSessionPaceForRace, type SessionType, type DriverSessionPace } from "./session-pace";

export type RaceWeekendSnapshot = {
  race: RaceSummary;
  sessionPace: Partial<Record<SessionType, DriverSessionPace[]>>;
  raceResult:
    | { driverId: number; driverName: string; teamName: string | null; finishPosition: number | null; status: string | null }[]
    | null;
  driverRatings: { driverId: number; driverName: string; basePace: number | null }[];
  teamRatings: { teamId: number; teamName: string; carStrength: number | null }[];
  weatherBySession: Partial<Record<SessionType, string | null>>;
};

export type YearOverYearComparison = {
  thisYear: RaceWeekendSnapshot;
  lastYear: RaceWeekendSnapshot | null;
};

async function buildSnapshot(race: RaceSummary): Promise<RaceWeekendSnapshot> {
  const [sessionPace, resultRows, driverRatingRows, teamRatingRows, sessionRows] = await Promise.all([
    getAllSessionPaceForRace(race.id),
    db
      .select({
        driverId: raceResults.driverId,
        driverName: drivers.name,
        teamName: teams.name,
        finishPosition: raceResults.finishPosition,
        status: raceResults.status,
      })
      .from(raceResults)
      .innerJoin(drivers, eq(raceResults.driverId, drivers.id))
      .innerJoin(teams, eq(raceResults.teamId, teams.id))
      .where(eq(raceResults.raceId, race.id))
      .orderBy(raceResults.finishPosition),
    db
      .select({ driverId: driverRatings.driverId, driverName: drivers.name, basePace: driverRatings.basePace })
      .from(driverRatings)
      .innerJoin(drivers, eq(driverRatings.driverId, drivers.id))
      .where(eq(driverRatings.raceId, race.id)),
    db
      .select({ teamId: teamRatings.teamId, teamName: teams.name, carStrength: teamRatings.carStrength })
      .from(teamRatings)
      .innerJoin(teams, eq(teamRatings.teamId, teams.id))
      .where(eq(teamRatings.raceId, race.id)),
    db
      .select({ sessionType: sessions.sessionType, weather: sessions.weather })
      .from(sessions)
      .where(eq(sessions.raceId, race.id)),
  ]);

  const weatherBySession: Partial<Record<SessionType, string | null>> = {};
  for (const s of sessionRows) weatherBySession[s.sessionType] = s.weather;

  return {
    race,
    sessionPace,
    raceResult: resultRows.length > 0 ? resultRows : null,
    driverRatings: driverRatingRows,
    teamRatings: teamRatingRows,
    weatherBySession,
  };
}

/**
 * Year-over-year comparison for a race weekend against the same circuit the
 * prior season. "Last year" is resolved by matching circuitId at
 * season - 1, taking the first match by round if a circuit somehow hosted
 * multiple events that season (rare; not disambiguated further).
 */
export async function getYearOverYearComparison(
  season: number,
  round: number,
): Promise<YearOverYearComparison | null> {
  const thisRace = await getRaceByRoute(season, round);
  if (!thisRace) return null;

  const [lastYearRace] = await db
    .select({
      id: races.id,
      season: races.season,
      round: races.round,
      circuitId: races.circuitId,
      date: races.date,
    })
    .from(races)
    .where(and(eq(races.circuitId, thisRace.circuitId), eq(races.season, season - 1)))
    .orderBy(races.round)
    .limit(1);

  const [thisYear, lastYear] = await Promise.all([
    buildSnapshot(thisRace),
    lastYearRace ? buildSnapshot(lastYearRace) : Promise.resolve(null),
  ]);

  return { thisYear, lastYear };
}
