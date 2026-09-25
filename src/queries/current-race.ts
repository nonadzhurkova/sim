import { db } from "@/db";
import { races } from "@/db/schema";
import { eq, gte, asc, desc, and } from "drizzle-orm";
import type { RaceSummary } from "./races";

/**
 * The race to show by default: the next upcoming race this season, or the
 * most recent past race if the season has already finished.
 */
export async function getCurrentRace(season: number): Promise<RaceSummary | null> {
  const today = new Date().toISOString().slice(0, 10);

  const [upcoming] = await db
    .select({
      id: races.id,
      season: races.season,
      round: races.round,
      circuitId: races.circuitId,
      date: races.date,
    })
    .from(races)
    .where(and(eq(races.season, season), gte(races.date, today)))
    .orderBy(asc(races.date))
    .limit(1);
  if (upcoming) return upcoming;

  const [mostRecent] = await db
    .select({
      id: races.id,
      season: races.season,
      round: races.round,
      circuitId: races.circuitId,
      date: races.date,
    })
    .from(races)
    .where(eq(races.season, season))
    .orderBy(desc(races.date))
    .limit(1);
  return mostRecent ?? null;
}
