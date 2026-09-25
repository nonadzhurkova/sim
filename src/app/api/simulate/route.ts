import { runAndStoreSimulation, streamSimulation } from "@/sim/run-simulation";
import { DEFAULT_ITERATIONS } from "@/sim/params";

const MAX_ITERATIONS = 20000;

/**
 * Minimum wall-clock time a streamed run is spread over, in ms.
 *
 * The engine is genuinely fast — a few thousand iterations finish in well
 * under a second — so without this the "live" progress would be a single
 * flash and the stream would be pointless. This paces the batches so the
 * probabilities are visibly seen converging, which is the real information
 * being conveyed: early estimates are noisy and visibly settle down. It
 * never makes a run slower than this floor, and a genuinely long run (a
 * large iteration count) simply takes its own time and ignores it.
 */
const MIN_STREAM_DURATION_MS = 1600;

export async function POST(req: Request) {
  let body: { raceId?: unknown; iterations?: unknown; stream?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raceId = Number(body.raceId);
  if (!Number.isInteger(raceId) || raceId < 1) {
    return Response.json({ error: "Invalid raceId" }, { status: 400 });
  }

  const iterations = body.iterations == null ? DEFAULT_ITERATIONS : Number(body.iterations);
  if (!Number.isInteger(iterations) || iterations < 100 || iterations > MAX_ITERATIONS) {
    return Response.json(
      { error: `iterations must be an integer between 100 and ${MAX_ITERATIONS}` },
      { status: 400 },
    );
  }

  // Non-streaming path, kept for the CLI, tests, and any caller that just
  // wants the final answer in one response.
  if (body.stream === false) {
    try {
      const result = await runAndStoreSimulation(raceId, iterations);
      return Response.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Simulation failed";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  // NDJSON: one JSON object per line, so the client can parse each progress
  // snapshot as it arrives without waiting for the whole body.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      try {
        for await (const event of streamSimulation(raceId, iterations)) {
          if (event.type === "progress") {
            // Pace progress events across MIN_STREAM_DURATION_MS so the
            // convergence is actually visible. Never delays the final result
            // beyond that floor, and a slow run overshoots it naturally.
            const targetElapsed =
              (event.completed / event.total) * MIN_STREAM_DURATION_MS;
            const wait = targetElapsed - (Date.now() - startedAt);
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          }
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Simulation failed";
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
      // Without this some proxies buffer the whole body and nothing streams.
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
