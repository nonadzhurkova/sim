import { db } from "@/db";
import { races, raceResults, qualifyingResults, teams } from "@/db/schema";
import { eq, and, lte, inArray, desc } from "drizzle-orm";

/**
 * Resolves each driver's current team as of `raceId`: qualifying/race
 * results for that race if they exist, otherwise falls back to their most
 * recent team from any earlier race (needed for a race weekend where only
 * practice has happened so far — no quali/race results exist yet to read
 * team from directly).
 */
export async function getDriverTeamsAsOf(
  raceId: number,
  driverIds: number[],
): Promise<Map<number, { teamId: number; teamName: string }>> {
  const [target] = await db
    .select({ season: races.season, round: races.round })
    .from(races)
    .where(eq(races.id, raceId));
  if (!target) return new Map();

  const [raceResultTeams, qualifyingTeams] = await Promise.all([
    db
      .select({ driverId: raceResults.driverId, teamId: raceResults.teamId, teamName: teams.name })
      .from(raceResults)
      .innerJoin(teams, eq(raceResults.teamId, teams.id))
      .where(and(eq(raceResults.raceId, raceId), inArray(raceResults.driverId, driverIds))),
    db
      .select({ driverId: qualifyingResults.driverId, teamId: qualifyingResults.teamId, teamName: teams.name })
      .from(qualifyingResults)
      .innerJoin(teams, eq(qualifyingResults.teamId, teams.id))
      .where(and(eq(qualifyingResults.raceId, raceId), inArray(qualifyingResults.driverId, driverIds))),
  ]);

  const teamByDriverId = new Map<number, { teamId: number; teamName: string }>();
  for (const t of qualifyingTeams) teamByDriverId.set(t.driverId, { teamId: t.teamId, teamName: t.teamName });
  for (const t of raceResultTeams) teamByDriverId.set(t.driverId, { teamId: t.teamId, teamName: t.teamName });

  const missingDriverIds = driverIds.filter((id) => !teamByDriverId.has(id));
  if (missingDriverIds.length === 0) return teamByDriverId;

  // Fallback: most recent race_results row at or before this race's date,
  // per missing driver. Small dataset (one season at a time), fine to do
  // per-driver rather than a single windowed query.
  for (const driverId of missingDriverIds) {
    const [row] = await db
      .select({ teamId: raceResults.teamId, teamName: teams.name, season: races.season, round: races.round })
      .from(raceResults)
      .innerJoin(races, eq(raceResults.raceId, races.id))
      .innerJoin(teams, eq(raceResults.teamId, teams.id))
      .where(
        and(
          eq(raceResults.driverId, driverId),
          lte(races.season, target.season),
        ),
      )
      .orderBy(desc(races.season), desc(races.round))
      .limit(1);
    if (row) teamByDriverId.set(driverId, { teamId: row.teamId, teamName: row.teamName });
  }

  return teamByDriverId;
}
