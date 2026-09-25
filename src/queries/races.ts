import { db } from "@/db";
import { races, circuits } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

export type RaceSummary = {
  id: number;
  season: number;
  round: number;
  circuitId: number;
  date: string;
};

export async function getLatestSeason(): Promise<number> {
  const [row] = await db
    .select({ maxSeason: sql<number>`max(${races.season})` })
    .from(races);
  return row?.maxSeason ?? new Date().getFullYear();
}

export type RaceListItem = RaceSummary & { circuitName: string; country: string | null };

export async function listRacesForSeason(season: number): Promise<RaceListItem[]> {
  const rows = await db
    .select({
      id: races.id,
      season: races.season,
      round: races.round,
      circuitId: races.circuitId,
      date: races.date,
      circuitName: circuits.name,
      country: circuits.country,
    })
    .from(races)
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .where(eq(races.season, season))
    .orderBy(races.round);
  return rows;
}

export async function getRaceByRoute(
  season: number,
  round: number,
): Promise<
  | (RaceSummary & { circuitName: string; circuitType: string | null; country: string | null })
  | null
> {
  const [row] = await db
    .select({
      id: races.id,
      season: races.season,
      round: races.round,
      circuitId: races.circuitId,
      date: races.date,
      circuitName: circuits.name,
      circuitType: circuits.type,
      country: circuits.country,
    })
    .from(races)
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .where(and(eq(races.season, season), eq(races.round, round)));
  return row ?? null;
}
