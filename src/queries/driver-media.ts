import { db } from "@/db";
import { drivers, sessions, races } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { openF1Fetch } from "@/lib/openf1-client";

/**
 * Driver headshots and car numbers, from OpenF1's drivers endpoint.
 *
 * Stored on the `drivers` table rather than fetched per request: a headshot
 * and a car number change at most once a season, so looking them up on every
 * page load would mean repeated calls to a rate-limited API for data that
 * never moves. This runs as part of ingestion instead.
 */

type OpenF1DriverRecord = {
  driver_number: number;
  name_acronym: string;
  full_name: string;
  headshot_url: string | null;
  team_name: string | null;
  team_colour: string | null;
};

/** Our stored driver names are "Charles Leclerc"; OpenF1 keys on "LEC". */
export function acronymFor(driverName: string): string {
  const parts = driverName.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? driverName).slice(0, 3).toUpperCase();
}

/**
 * Populates driver_number and headshot_url for every driver OpenF1 knows
 * about in this season. Safe to re-run: it only writes when a value is
 * missing or has actually changed.
 *
 * Returns how many rows were updated, so ingestion can report it.
 */
export async function syncDriverMedia(season: number): Promise<number> {
  // One session covers the whole grid, so a single call does the lot.
  const [latest] = await db
    .select({ key: sessions.openf1SessionKey })
    .from(sessions)
    .innerJoin(races, eq(sessions.raceId, races.id))
    .where(and(eq(races.season, season), eq(sessions.sessionType, "q")))
    .orderBy(desc(races.round))
    .limit(1);
  if (!latest?.key) return 0;

  const res = await openF1Fetch<OpenF1DriverRecord>(`/drivers?session_key=${latest.key}`);
  if (!res.ok) return 0;

  const byAcronym = new Map<string, OpenF1DriverRecord>();
  for (const d of res.data) {
    // OpenF1 repeats each driver once per data revision; first record wins.
    if (d.name_acronym && !byAcronym.has(d.name_acronym)) byAcronym.set(d.name_acronym, d);
  }

  const ourDrivers = await db
    .select({
      id: drivers.id,
      name: drivers.name,
      driverNumber: drivers.driverNumber,
      headshotUrl: drivers.headshotUrl,
    })
    .from(drivers);

  let updated = 0;
  for (const driver of ourDrivers) {
    const match = byAcronym.get(acronymFor(driver.name));
    if (!match) continue;

    // Every URL contains "d_driver_fallback_image.png" — that is a Cloudinary
    // *default* directive telling the CDN what to serve if the real photo is
    // missing, not a sign that this driver has no photo. Filtering on it
    // rejected all 20 drivers. A genuinely missing photo instead has no
    // driver-specific path segment, so check for that.
    const url = match.headshot_url;
    const headshot = url && /\/drivers\/[A-Z]\//.test(url) ? url : null;

    if (driver.driverNumber === match.driver_number && driver.headshotUrl === headshot) {
      continue;
    }
    await db
      .update(drivers)
      .set({ driverNumber: match.driver_number, headshotUrl: headshot })
      .where(eq(drivers.id, driver.id));
    updated++;
  }
  return updated;
}

/** How many drivers currently have a stored headshot — for ingest reporting. */
export async function countDriversWithMedia(): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(drivers)
    .where(sql`${drivers.headshotUrl} is not null`);
  return Number(count);
}
