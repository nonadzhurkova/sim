import { db } from "@/db";
import { races, sessions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { SESSION_TYPE_MAP } from "./openf1";

const JOLPICA_BASE_URL = "https://api.jolpi.ca/ergast/f1";
const OPENF1_BASE_URL = "https://api.openf1.org/v1";

export type FreshnessResult = {
  season: number;
  jolpica: { upstreamRaceCount: number; storedRaceCount: number; hasNewData: boolean };
  openf1: { upstreamSessionCount: number; storedSessionCount: number; hasNewData: boolean };
};

/**
 * Lightweight check for the home page banner: fetches only counts from
 * upstream APIs (no full ingestion) and compares to what's stored.
 */
export async function checkFreshness(season: number): Promise<FreshnessResult> {
  const [jolpica, openf1] = await Promise.all([
    checkJolpicaFreshness(season),
    checkOpenF1Freshness(season),
  ]);
  return { season, jolpica, openf1 };
}

async function checkJolpicaFreshness(season: number) {
  const res = await fetch(`${JOLPICA_BASE_URL}/${season}.json?limit=1`);
  const data = (await res.json()) as { MRData: { total: string } };
  const upstreamRaceCount = parseInt(data.MRData.total, 10);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(races)
    .where(eq(races.season, season));

  return { upstreamRaceCount, storedRaceCount: Number(count), hasNewData: upstreamRaceCount > Number(count) };
}

async function checkOpenF1Freshness(season: number) {
  const res = await fetch(`${OPENF1_BASE_URL}/sessions?year=${season}`);
  const data = (await res.json()) as { session_name: string }[];
  const upstreamSessionCount = data.filter((s) => s.session_name in SESSION_TYPE_MAP).length;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessions)
    .innerJoin(races, eq(sessions.raceId, races.id))
    .where(eq(races.season, season));

  return { upstreamSessionCount, storedSessionCount: Number(count), hasNewData: upstreamSessionCount > Number(count) };
}
