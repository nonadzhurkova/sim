import { db } from "@/db";
import { races, raceResults } from "@/db/schema";
import { eq } from "drizzle-orm";
import { weightedAverage } from "./decay";

type ResultRow = {
  raceId: number;
  season: number;
  round: number;
  driverId: number;
  teamId: number;
  status: "finished" | "dnf" | "dsq" | null;
};

/**
 * Overall DNF rate as of `targetRaceId`, using only prior races. 1.0 = DNF'd
 * every recent race, 0.0 = never. Missing history (rookie) returns null.
 *
 * Ergast/Jolpica no longer exposes a specific retirement reason (engine vs
 * accident, etc.) — only a generic "Retired" status — so this can't be split
 * into car-caused vs driver-caused as the original plan intended. Tracking
 * one overall rate per driver until/unless a richer data source is found.
 */
export async function computeDriverReliability(
  targetRaceId: number,
  driverIds: number[],
  allResults: ResultRow[],
): Promise<Map<number, number | null>> {
  const [targetRace] = await db
    .select({ season: races.season, round: races.round })
    .from(races)
    .where(eq(races.id, targetRaceId));
  if (!targetRace) return new Map();

  const prior = allResults
    .filter((r) => r.season < targetRace.season || (r.season === targetRace.season && r.round < targetRace.round))
    .sort((a, b) => b.season - a.season || b.round - a.round);

  const result = new Map<number, number | null>();
  for (const driverId of driverIds) {
    const history = prior
      .filter((r) => r.driverId === driverId)
      .map((r) => (r.status === "dnf" ? 1 : 0));
    result.set(driverId, weightedAverage(history));
  }
  return result;
}

export async function fetchAllResults(): Promise<ResultRow[]> {
  const rows = await db
    .select({
      raceId: raceResults.raceId,
      season: races.season,
      round: races.round,
      driverId: raceResults.driverId,
      teamId: raceResults.teamId,
      status: raceResults.status,
    })
    .from(raceResults)
    .innerJoin(races, eq(raceResults.raceId, races.id));
  return rows;
}
