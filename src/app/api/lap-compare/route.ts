import { db } from "@/db";
import { sessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { compareFastestLaps } from "@/queries/lap-telemetry";
import type { SessionType } from "@/queries/session-pace";

/**
 * Head-to-head telemetry for two drivers' fastest laps in one session.
 * Pulled live from OpenF1 and not stored — see lap-telemetry.ts.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raceId = Number(searchParams.get("raceId"));
  const sessionType = searchParams.get("session") as SessionType | null;
  const target = Number(searchParams.get("target"));
  const rival = Number(searchParams.get("rival"));

  if (!Number.isInteger(raceId) || raceId < 1) {
    return Response.json({ error: "Invalid raceId" }, { status: 400 });
  }
  if (!sessionType || !["fp1", "fp2", "fp3", "q", "r"].includes(sessionType)) {
    return Response.json({ error: "Invalid session" }, { status: 400 });
  }
  if (!Number.isInteger(target) || !Number.isInteger(rival)) {
    return Response.json({ error: "Invalid driver numbers" }, { status: 400 });
  }

  const [session] = await db
    .select({ key: sessions.openf1SessionKey })
    .from(sessions)
    .where(and(eq(sessions.raceId, raceId), eq(sessions.sessionType, sessionType)));

  if (!session?.key) {
    return Response.json({ error: "No OpenF1 data for that session" }, { status: 404 });
  }

  try {
    const comparison = await compareFastestLaps(session.key, target, rival);
    if (!comparison) {
      return Response.json(
        { error: "Telemetry unavailable — OpenF1 blocks access while a session is live." },
        { status: 503 },
      );
    }
    return Response.json(comparison);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Comparison failed" },
      { status: 500 },
    );
  }
}
