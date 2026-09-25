import { projectSeason, streamSeasonProjection } from "@/sim/season";

/**
 * Championship projection, run on demand and streamed.
 *
 * Simulating every remaining race a few thousand times takes tens of seconds,
 * so this is never part of a page render — the home page asks for it when the
 * user presses the button, and the odds are streamed back as they converge.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const season = Number(searchParams.get("season"));
  const iterationsParam = searchParams.get("iterations");
  const iterations = iterationsParam ? Number(iterationsParam) : undefined;
  const wantsStream = searchParams.get("stream") !== "false";

  if (!Number.isInteger(season) || season < 1950) {
    return Response.json({ error: "Invalid season" }, { status: 400 });
  }
  if (
    iterations != null &&
    (!Number.isInteger(iterations) || iterations < 100 || iterations > 10000)
  ) {
    return Response.json(
      { error: "iterations must be an integer between 100 and 10000" },
      { status: 400 },
    );
  }

  if (!wantsStream) {
    try {
      return Response.json(await projectSeason(season, iterations));
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Projection failed" },
        { status: 500 },
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of streamSeasonProjection(season, iterations)) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Projection failed";
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", error: message }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
