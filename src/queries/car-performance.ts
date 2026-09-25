import { db } from "@/db";
import { teamRatings, teams, races } from "@/db/schema";
import { eq } from "drizzle-orm";

export type CarPerformanceRow = {
  teamId: number;
  teamName: string;
  carStrength: number;
  gapToLeader: number;
  rank: number;
  rankAtSeasonStart: number | null;
  trend: "up" | "down" | "same" | null;
  positionsChanged: number | null;
};

/**
 * Ranks teams by car_strength for the given race, with a trend indicator
 * comparing each team's rank to their rank at the season's first race
 * (round 1) that has team_ratings data. Mirrors the official F1 broadcast's
 * "car performance" graphic (fastest team = 0, others shown as a gap).
 */
export async function getCarPerformance(season: number, raceId: number): Promise<CarPerformanceRow[]> {
  const currentRatings = await db
    .select({ teamId: teamRatings.teamId, teamName: teams.name, carStrength: teamRatings.carStrength })
    .from(teamRatings)
    .innerJoin(teams, eq(teamRatings.teamId, teams.id))
    .where(eq(teamRatings.raceId, raceId));

  const validCurrent = currentRatings.filter(
    (r): r is { teamId: number; teamName: string; carStrength: number } => r.carStrength != null,
  );
  if (validCurrent.length === 0) return [];

  const leaderStrength = Math.min(...validCurrent.map((r) => r.carStrength));
  const ranked = [...validCurrent]
    .sort((a, b) => a.carStrength - b.carStrength)
    .map((r, i) => ({ ...r, rank: i + 1, gapToLeader: r.carStrength - leaderStrength }));

  // find the earliest race in this season that has any team_ratings, to
  // compare against ("round 1" in spirit — the first race with a rating,
  // since round 1 itself never has one, no prior data to compute it from)
  const [firstRatedRace] = await db
    .select({ raceId: teamRatings.raceId, round: races.round })
    .from(teamRatings)
    .innerJoin(races, eq(teamRatings.raceId, races.id))
    .where(eq(races.season, season))
    .orderBy(races.round)
    .limit(1);

  let rankAtStartByTeam = new Map<number, number>();
  if (firstRatedRace && firstRatedRace.raceId !== raceId) {
    const startRatings = await db
      .select({ teamId: teamRatings.teamId, carStrength: teamRatings.carStrength })
      .from(teamRatings)
      .where(eq(teamRatings.raceId, firstRatedRace.raceId));
    const validStart = startRatings.filter(
      (r): r is { teamId: number; carStrength: number } => r.carStrength != null,
    );
    const startRanked = [...validStart].sort((a, b) => a.carStrength - b.carStrength);
    rankAtStartByTeam = new Map(startRanked.map((r, i) => [r.teamId, i + 1]));
  }

  return ranked.map((r) => {
    const rankAtSeasonStart = rankAtStartByTeam.get(r.teamId) ?? null;
    const positionsChanged = rankAtSeasonStart != null ? rankAtSeasonStart - r.rank : null;
    const trend =
      positionsChanged == null ? null : positionsChanged > 0 ? "up" : positionsChanged < 0 ? "down" : "same";
    return { ...r, rankAtSeasonStart, trend, positionsChanged };
  });
}
