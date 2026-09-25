import { db } from "@/db";
import { races, circuits } from "@/db/schema";
import { eq, gte, asc, desc, and } from "drizzle-orm";
import type { RaceListItem } from "./races";

/**
 * The race to show by default: the next upcoming race this season, or the
 * most recent past race if the season has already finished.
 *
 * Includes the circuit name so the home page can show it directly rather
 * than just a round number.
 */
export async function getCurrentRace(season: number): Promise<RaceListItem | null> {
  const selection = {
    id: races.id,
    season: races.season,
    round: races.round,
    circuitId: races.circuitId,
    date: races.date,
    circuitName: circuits.name,
    country: circuits.country,
  };

  const [upcoming] = await db
    .select(selection)
    .from(races)
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .where(and(eq(races.season, season), gte(races.date, new Date().toISOString().slice(0, 10))))
    .orderBy(asc(races.date))
    .limit(1);
  if (upcoming) return upcoming;

  const [mostRecent] = await db
    .select(selection)
    .from(races)
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .where(eq(races.season, season))
    .orderBy(desc(races.date))
    .limit(1);
  return mostRecent ?? null;
}
