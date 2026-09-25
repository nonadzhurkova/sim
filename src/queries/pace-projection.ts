import { db } from "@/db";
import { drivers } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { getDriverTeamsAsOf } from "./driver-teams";

export type PaceProjectionRow = {
  driverId: number;
  driverName: string;
  teamName: string | null;
  relativePace: number;
  sampleSize: number | null;
  rank: number;
};

/** Resolves driver names/teams and ranks a raceId->pace Map into API-ready rows. */
export async function toRankedPaceRows(
  raceId: number,
  paceMap: Map<number, number | { pace: number; sampleSize: number }>,
): Promise<PaceProjectionRow[]> {
  if (paceMap.size === 0) return [];

  const driverIds = [...paceMap.keys()];
  const [driverRows, teamById] = await Promise.all([
    db.select({ id: drivers.id, name: drivers.name }).from(drivers).where(inArray(drivers.id, driverIds)),
    getDriverTeamsAsOf(raceId, driverIds),
  ]);
  const nameById = new Map(driverRows.map((d) => [d.id, d.name]));

  return [...paceMap.entries()]
    .map(([driverId, entry]) => {
      const isObject = typeof entry === "object";
      return {
        driverId,
        driverName: nameById.get(driverId) ?? "Unknown",
        teamName: teamById.get(driverId)?.teamName ?? null,
        relativePace: isObject ? entry.pace : entry,
        sampleSize: isObject ? entry.sampleSize : null,
      };
    })
    .sort((a, b) => a.relativePace - b.relativePace)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
