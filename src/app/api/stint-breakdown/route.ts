import { getDriverStintBreakdown } from "@/ratings/practice-pace";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raceId = Number(searchParams.get("raceId"));
  const driverId = Number(searchParams.get("driverId"));
  if (!Number.isInteger(raceId) || raceId < 1 || !Number.isInteger(driverId) || driverId < 1) {
    return Response.json({ error: "Invalid raceId or driverId" }, { status: 400 });
  }

  const breakdown = await getDriverStintBreakdown(raceId, driverId);
  return Response.json({ raceId, driverId, stints: breakdown });
}
