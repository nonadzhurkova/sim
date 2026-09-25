import { getTeamTelemetryReport } from "@/queries/team-telemetry";

/**
 * On-demand team telemetry analysis. Nothing is stored — OpenF1 is queried
 * when the page asks, which is why this is a POST-triggered route rather than
 * part of the race page's own server render: pulling several sessions through
 * a rate-limited upstream takes seconds and shouldn't block the page.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raceId = Number(searchParams.get("raceId"));
  const team = searchParams.get("team");

  if (!Number.isInteger(raceId) || raceId < 1) {
    return Response.json({ error: "Invalid raceId" }, { status: 400 });
  }
  if (!team) {
    return Response.json({ error: "Missing team" }, { status: 400 });
  }

  try {
    const report = await getTeamTelemetryReport(raceId, team);
    if (!report) return Response.json({ error: "Race not found" }, { status: 404 });
    return Response.json(report);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status: 500 },
    );
  }
}
