import { db } from "@/db";
import { races, raceResults } from "@/db/schema";
import { eq } from "drizzle-orm";
import { weightedAverage } from "./decay";

/**
 * Season-long car strength per team, as of `targetRaceId`, using only prior
 * races. Approximated as the average of both teammates' field-relative race
 * pace (see race-pace.ts) each race, recency-weighted. This mixes in some
 * driver skill rather than isolating the car perfectly, but is a reasonable
 * starting proxy — see project plan notes on refining post-backtest.
 */
export async function computeTeamStrength(
  targetRaceId: number,
  teamIds: number[],
  priorRaces: { id: number; season: number; round: number }[],
  racePaceByRace: Map<number, Map<number, number>>,
): Promise<Map<number, number | null>> {
  const driverTeamByRace = await db
    .select({ raceId: raceResults.raceId, driverId: raceResults.driverId, teamId: raceResults.teamId })
    .from(raceResults);

  const teamDriversByRace = new Map<number, Map<number, number[]>>(); // raceId -> teamId -> driverIds
  for (const row of driverTeamByRace) {
    if (!teamDriversByRace.has(row.raceId)) teamDriversByRace.set(row.raceId, new Map());
    const teamMap = teamDriversByRace.get(row.raceId)!;
    if (!teamMap.has(row.teamId)) teamMap.set(row.teamId, []);
    teamMap.get(row.teamId)!.push(row.driverId);
  }

  const result = new Map<number, number | null>();
  for (const teamId of teamIds) {
    const history: number[] = [];
    for (const race of priorRaces) {
      const driverIdsForTeam = teamDriversByRace.get(race.id)?.get(teamId) ?? [];
      const pace = racePaceByRace.get(race.id);
      if (!pace) continue;
      const teamPaces = driverIdsForTeam.map((d) => pace.get(d)).filter((p): p is number => p != null);
      if (teamPaces.length > 0) {
        history.push(teamPaces.reduce((a, b) => a + b, 0) / teamPaces.length);
      }
    }
    result.set(teamId, weightedAverage(history));
  }
  return result;
}
