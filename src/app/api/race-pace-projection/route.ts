import { computeRacePaceProjection } from "@/ratings/practice-pace";
import { toRankedPaceRows } from "@/queries/pace-projection";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raceId = Number(searchParams.get("raceId"));
  if (!Number.isInteger(raceId) || raceId < 1) {
    return Response.json({ error: "Invalid raceId" }, { status: 400 });
  }

  const paceMap = await computeRacePaceProjection(raceId);
  const result = await toRankedPaceRows(raceId, paceMap);
  return Response.json({ raceId, drivers: result });
}
