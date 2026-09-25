import { db } from "@/db";
import { races, sessions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { ingestSeason } from "@/ingest/jolpica";
import { ingestSeasonSessions } from "@/ingest/openf1";
import { computeSeasonRatings } from "@/ratings/compute";
import type { IngestProgress } from "@/ingest/progress";
import { syncDriverMedia } from "@/queries/driver-media";

async function countsForSeason(season: number) {
  const [{ raceCount }] = await db
    .select({ raceCount: sql<number>`count(*)` })
    .from(races)
    .where(eq(races.season, season));
  const [{ sessionCount }] = await db
    .select({ sessionCount: sql<number>`count(*)` })
    .from(sessions)
    .innerJoin(races, eq(sessions.raceId, races.id))
    .where(eq(races.season, season));
  return { races: Number(raceCount), sessions: Number(sessionCount) };
}

export async function POST(req: Request) {
  let season: number;
  let wantsStream = true;
  try {
    const body = await req.json();
    season = Number(body?.season);
    if (body?.stream === false) wantsStream = false;
    if (!Number.isInteger(season) || season < 1950) {
      return Response.json({ error: "Invalid season" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Non-streaming path, kept for scripts and any caller that just wants the
  // final summary.
  if (!wantsStream) {
    try {
      const before = await countsForSeason(season);
      await ingestSeason(season);
      await ingestSeasonSessions(season);
      await syncDriverMedia(season);
      await computeSeasonRatings(season);
      const after = await countsForSeason(season);
      return Response.json({ season, before, after });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Ingestion failed" },
        { status: 500 },
      );
    }
  }

  // NDJSON progress stream. An import runs three long phases (race results,
  // timing data, then a full ratings recompute) and can take minutes, so it
  // reports which phase it is in and how far through — otherwise the button
  // sits on "Importing..." with no sign of whether it is working or stuck.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      // The ingest functions are async and await network calls throughout, so
      // progress events flush naturally without needing to yield explicitly.
      const report = (phase: string) => (p: IngestProgress) =>
        send({ type: "progress", ...p, phase: p.phase ?? phase });

      try {
        const before = await countsForSeason(season);
        send({ type: "start", season, before });

        send({ type: "phase", phase: "jolpica", label: "Race results & qualifying" });
        await ingestSeason(season, report("jolpica"));

        send({ type: "phase", phase: "openf1", label: "Timing, laps & stints" });
        await ingestSeasonSessions(season, report("openf1"));

        send({ type: "phase", phase: "openf1", label: "Driver photos & numbers" });
        const mediaUpdated = await syncDriverMedia(season);
        send({
          type: "progress",
          phase: "openf1",
          message: `${mediaUpdated} driver photo${mediaUpdated === 1 ? "" : "s"} updated`,
        });

        send({ type: "phase", phase: "ratings", label: "Recomputing ratings" });
        await computeSeasonRatings(season, report("ratings"));

        const after = await countsForSeason(season);
        send({ type: "done", season, before, after });
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Ingestion failed",
        });
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
