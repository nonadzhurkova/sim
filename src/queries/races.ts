import { db } from "@/db";
import { races, circuits } from "@/db/schema";
import { eq, and, sql, lt, gt, asc, desc } from "drizzle-orm";

export type RaceSummary = {
  id: number;
  season: number;
  round: number;
  circuitId: number;
  date: string;
  isSprintWeekend: boolean;
};

export async function getLatestSeason(): Promise<number> {
  const [row] = await db
    .select({ maxSeason: sql<number>`max(${races.season})` })
    .from(races);
  return row?.maxSeason ?? new Date().getFullYear();
}

/** Every season with at least one race, newest first — for season-picker UI (standings, team, races pages). */
export async function getAllSeasons(): Promise<number[]> {
  const rows = await db.selectDistinct({ season: races.season }).from(races).orderBy(desc(races.season));
  return rows.map((r) => r.season);
}

/**
 * Resolves a `?season=` query param against the seasons that actually have
 * data, falling back to the latest season for anything invalid or absent —
 * the same resolution logic the standings/team/races pages each ran
 * independently before this was factored out.
 */
export function resolveSeasonParam(seasonParam: string | undefined, seasons: number[], latest: number): number {
  const requested = seasonParam ? parseInt(seasonParam, 10) : NaN;
  return seasons.includes(requested) ? requested : latest;
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
      isSprintWeekend: races.isSprintWeekend,
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
      isSprintWeekend: races.isSprintWeekend,
      circuitName: circuits.name,
      circuitType: circuits.type,
      country: circuits.country,
    })
    .from(races)
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .where(and(eq(races.season, season), eq(races.round, round)));
  return row ?? null;
}

export type AdjacentRace = { season: number; round: number; circuitName: string };

/**
 * The race immediately before/after this one by calendar date, crossing a
 * season boundary naturally (the last race of a season's "next" is the
 * first race of the following season, not null) -- so race-page navigation
 * doesn't dead-end at a season's edges.
 */
export async function getAdjacentRaces(
  raceDate: string,
): Promise<{ previous: AdjacentRace | null; next: AdjacentRace | null }> {
  const [[previous], [next]] = await Promise.all([
    db
      .select({ season: races.season, round: races.round, circuitName: circuits.name })
      .from(races)
      .innerJoin(circuits, eq(races.circuitId, circuits.id))
      .where(lt(races.date, raceDate))
      .orderBy(desc(races.date))
      .limit(1),
    db
      .select({ season: races.season, round: races.round, circuitName: circuits.name })
      .from(races)
      .innerJoin(circuits, eq(races.circuitId, circuits.id))
      .where(gt(races.date, raceDate))
      .orderBy(asc(races.date))
      .limit(1),
  ]);
  return { previous: previous ?? null, next: next ?? null };
}
