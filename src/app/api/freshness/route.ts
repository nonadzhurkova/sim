import { checkFreshness } from "@/ingest/freshness";

// OpenF1's lock state can flip within minutes (a session starting/ending),
// so this must never be served from a cache -- a stale "locked" response
// would keep telling the user to wait long after the API actually freed up.
export const dynamic = "force-dynamic";

/**
 * Backs the home page's freshness banner. Split out from the page's own
 * server render so the two live upstream calls inside checkFreshness
 * (Jolpica + OpenF1) don't block the initial page load -- the banner loads
 * in on its own once the page is already visible.
 */
export async function GET(req: Request) {
  const season = Number(new URL(req.url).searchParams.get("season"));
  if (!Number.isInteger(season) || season < 1) {
    return Response.json({ error: "Invalid season" }, { status: 400 });
  }
  const freshness = await checkFreshness(season);
  return Response.json(freshness);
}
