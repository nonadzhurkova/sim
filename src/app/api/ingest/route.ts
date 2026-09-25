import { db } from "@/db";
import { races, sessions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { ingestSeason } from "@/ingest/jolpica";
import { ingestSeasonSessions } from "@/ingest/openf1";
import { computeSeasonRatings } from "@/ratings/compute";

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
  try {
    const body = await req.json();
    season = Number(body?.season);
    if (!Number.isInteger(season) || season < 1950) {
      return Response.json({ error: "Invalid season" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const before = await countsForSeason(season);
    await ingestSeason(season);
    await ingestSeasonSessions(season);
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
