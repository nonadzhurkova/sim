import { db } from "@/db";
import { drivers } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { computePracticePace } from "@/ratings/practice-pace";
import { getDriverTeamsAsOf } from "@/queries/driver-teams";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raceId = Number(searchParams.get("raceId"));
  if (!Number.isInteger(raceId) || raceId < 1) {
    return Response.json({ error: "Invalid raceId" }, { status: 400 });
  }

  const paceMap = await computePracticePace(raceId);
  if (paceMap.size === 0) {
    return Response.json({ raceId, drivers: [] });
  }

  const driverIds = [...paceMap.keys()];
  const [driverRows, teamById] = await Promise.all([
    db.select({ id: drivers.id, name: drivers.name }).from(drivers).where(inArray(drivers.id, driverIds)),
    getDriverTeamsAsOf(raceId, driverIds),
  ]);

  const nameById = new Map(driverRows.map((d) => [d.id, d.name]));

  const result = [...paceMap.entries()]
    .map(([driverId, pace]) => ({
      driverId,
      driverName: nameById.get(driverId) ?? "Unknown",
      teamName: teamById.get(driverId)?.teamName ?? null,
      relativePace: pace,
    }))
    .sort((a, b) => a.relativePace - b.relativePace)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return Response.json({ raceId, drivers: result });
}
