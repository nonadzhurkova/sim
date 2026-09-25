import { runAndStoreSimulation } from "@/sim/run-simulation";
import { DEFAULT_ITERATIONS } from "@/sim/params";

const MAX_ITERATIONS = 20000;

export async function POST(req: Request) {
  let body: { raceId?: unknown; iterations?: unknown };
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

  try {
    const result = await runAndStoreSimulation(raceId, iterations);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Simulation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
