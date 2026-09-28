import { db } from "@/db";
import { driverRatings, drivers, teams, raceResults } from "@/db/schema";
import { eq } from "drizzle-orm";

export type BasePaceRow = {
  driverId: number;
  driverName: string;
  headshotUrl: string | null;
  teamName: string | null;
  basePace: number;
};

/**
 * The current season's fastest drivers by base pace (driver_ratings for the
 * given race, which is the latest one computeSeasonRatings has run for) —
 * negative = faster than the field average. Separate from standings, which
 * measures results; this measures the model's own read on raw pace.
 */
export async function getTopBasePace(raceId: number, limit = 5): Promise<BasePaceRow[]> {
  const rows = await db
    .select({
      driverId: driverRatings.driverId,
      driverName: drivers.name,
      headshotUrl: drivers.headshotUrl,
      basePace: driverRatings.basePace,
    })
    .from(driverRatings)
    .innerJoin(drivers, eq(driverRatings.driverId, drivers.id))
    .where(eq(driverRatings.raceId, raceId));

  const withPace = rows.filter((r): r is typeof r & { basePace: number } => r.basePace != null);

  // Team is read from this race's own entry list (raceResults/qualifying
  // would both work; raceResults is what's already indexed on raceId here),
  // not driver_ratings, which carries no team column.
  const resultRows = await db.select({ driverId: raceResults.driverId, teamId: raceResults.teamId }).from(raceResults).where(eq(raceResults.raceId, raceId));
  const teamIdByDriverId = new Map(resultRows.map((r) => [r.driverId, r.teamId]));
  const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams);
  const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

  return withPace
    .sort((a, b) => a.basePace - b.basePace)
    .slice(0, limit)
    .map((r) => ({
      driverId: r.driverId,
      driverName: r.driverName,
      headshotUrl: r.headshotUrl,
      teamName: teamIdByDriverId.has(r.driverId) ? teamNameById.get(teamIdByDriverId.get(r.driverId)!) ?? null : null,
      basePace: r.basePace,
    }));
}
