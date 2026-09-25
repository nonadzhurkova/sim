import { db } from "@/db";
import type { ProgressReporter } from "./progress";
import { races, sessions, drivers, laps, stints } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const BASE_URL = "https://api.openf1.org/v1";

type OpenF1Session = {
  session_key: number;
  session_name: string; // "Practice 1" | "Practice 2" | "Practice 3" | "Qualifying" | "Race"
  date_start: string;
  country_name: string;
  circuit_short_name: string;
};

type OpenF1Driver = {
  driver_number: number;
  full_name: string;
};

type OpenF1Lap = {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  is_pit_out_lap: boolean;
};

type OpenF1Stint = {
  driver_number: number;
  stint_number: number;
  compound: string;
  tyre_age_at_start: number;
  lap_start: number;
  lap_end: number;
};

type OpenF1Weather = {
  rainfall: number;
};

export const SESSION_TYPE_MAP: Record<string, "fp1" | "fp2" | "fp3" | "q" | "r"> = {
  "Practice 1": "fp1",
  "Practice 2": "fp2",
  "Practice 3": "fp3",
  Qualifying: "q",
  Race: "r",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, retries = 5): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      const backoffMs = 2000 * 2 ** attempt;
      console.warn(`[openf1] rate limited, retrying in ${backoffMs}ms: ${url}`);
      await sleep(backoffMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`OpenF1 request failed (${res.status}): ${url}`);
    }
    return res.json() as Promise<T>;
  }
  throw new Error(`OpenF1 request failed after ${retries} retries (429): ${url}`);
}

/** Strips diacritics so "Pérez" and "PEREZ" compare equal. */
function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * OpenF1 driver_number is per-session; we resolve it to our driver id via full_name.
 * OpenF1 name word order/casing/diacritics are inconsistent (e.g. "Max VERSTAPPEN" vs
 * "ZHOU Guanyu", "PEREZ" vs "Pérez"), so match ignores order, case, and accents, and
 * requires every word in the OpenF1 name to appear in ours.
 */
async function buildDriverNumberMap(
  sessionKey: number,
  allDrivers: { id: number; name: string }[],
): Promise<Map<number, number>> {
  const openf1Drivers = await fetchJson<OpenF1Driver[]>(
    `${BASE_URL}/drivers?session_key=${sessionKey}`,
  );
  const map = new Map<number, number>();

  for (const d of openf1Drivers) {
    const openf1Words = foldName(d.full_name.trim()).split(/\s+/);
    const match = allDrivers.find((m) => {
      const ourWords = foldName(m.name).split(/\s+/);
      return openf1Words.every((w) => ourWords.includes(w));
    });
    if (match) {
      map.set(d.driver_number, match.id);
    } else {
      console.warn(`[openf1] could not resolve driver ${d.full_name} (#${d.driver_number})`);
    }
  }
  return map;
}

async function ingestSessionWeather(sessionKey: number): Promise<"dry" | "wet"> {
  const readings = await fetchJson<OpenF1Weather[]>(
    `${BASE_URL}/weather?session_key=${sessionKey}`,
  );
  const wasWet = readings.some((r) => r.rainfall > 0);
  return wasWet ? "wet" : "dry";
}

async function upsertSession(
  raceId: number,
  sessionType: "fp1" | "fp2" | "fp3" | "q" | "r",
  openf1SessionKey: number,
  weather: "dry" | "wet",
): Promise<number> {
  const [row] = await db
    .insert(sessions)
    .values({ raceId, sessionType, weather, openf1SessionKey })
    .onConflictDoUpdate({
      target: [sessions.raceId, sessions.sessionType],
      set: { weather, openf1SessionKey },
    })
    .returning({ id: sessions.id });
  return row.id;
}

async function ingestLaps(
  dbSessionId: number,
  openf1SessionKey: number,
  driverNumberToId: Map<number, number>,
) {
  const lapData = await fetchJson<OpenF1Lap[]>(
    `${BASE_URL}/laps?session_key=${openf1SessionKey}`,
  );

  const rows = lapData
    .filter((lap) => driverNumberToId.has(lap.driver_number) && lap.lap_number != null)
    .map((lap) => ({
      sessionId: dbSessionId,
      driverId: driverNumberToId.get(lap.driver_number)!,
      lapNumber: lap.lap_number,
      lapDuration: lap.lap_duration,
      isPitInOut: lap.is_pit_out_lap,
    }));
  if (rows.length === 0) return;

  await db
    .insert(laps)
    .values(rows)
    .onConflictDoUpdate({
      target: [laps.sessionId, laps.driverId, laps.lapNumber],
      set: {
        lapDuration: sql`excluded.lap_duration`,
        isPitInOut: sql`excluded.is_pit_in_out`,
      },
    });
}

async function ingestStints(
  dbSessionId: number,
  openf1SessionKey: number,
  driverNumberToId: Map<number, number>,
) {
  const stintData = await fetchJson<OpenF1Stint[]>(
    `${BASE_URL}/stints?session_key=${openf1SessionKey}`,
  );

  const rows = stintData
    .filter((stint) => driverNumberToId.has(stint.driver_number))
    .map((stint) => ({
      sessionId: dbSessionId,
      driverId: driverNumberToId.get(stint.driver_number)!,
      stintNumber: stint.stint_number,
      compound: stint.compound,
      tyreAgeAtStart: stint.tyre_age_at_start,
      lapStart: stint.lap_start,
      lapEnd: stint.lap_end,
    }));
  if (rows.length === 0) return;

  await db
    .insert(stints)
    .values(rows)
    .onConflictDoUpdate({
      target: [stints.sessionId, stints.driverId, stints.stintNumber],
      set: {
        compound: sql`excluded.compound`,
        tyreAgeAtStart: sql`excluded.tyre_age_at_start`,
        lapStart: sql`excluded.lap_start`,
        lapEnd: sql`excluded.lap_end`,
      },
    });
}

/**
 * A session is considered fully ingested if it already has both laps and
 * stints stored. The most recent race weekend is never skipped even if
 * "complete," since it may have been ingested mid-session before all laps
 * were available upstream.
 */
async function isSessionFullyIngested(dbSessionId: number): Promise<boolean> {
  const [[{ lapCount }], [{ stintCount }]] = await Promise.all([
    db.select({ lapCount: sql<number>`count(*)` }).from(laps).where(eq(laps.sessionId, dbSessionId)),
    db.select({ stintCount: sql<number>`count(*)` }).from(stints).where(eq(stints.sessionId, dbSessionId)),
  ]);
  return Number(lapCount) > 0 && Number(stintCount) > 0;
}

export async function ingestSeasonSessions(season: number, onProgress?: ProgressReporter) {
  console.log(`[openf1] fetching sessions for ${season}...`);
  onProgress?.({ phase: "openf1", message: `Fetching ${season} session list` });
  const openf1Sessions = await fetchJson<OpenF1Session[]>(
    `${BASE_URL}/sessions?year=${season}`,
  );

  const dbRaces = await db
    .select({ id: races.id, round: races.round, date: races.date })
    .from(races)
    .where(eq(races.season, season));
  const allDrivers = await db.select({ id: drivers.id, name: drivers.name }).from(drivers);
  const latestRaceId = dbRaces.reduce(
    (latest, r) => (latest === null || r.round > latest.round ? r : latest),
    null as { id: number; round: number } | null,
  )?.id;

  const existingSessions = await db
    .select({ id: sessions.id, raceId: sessions.raceId, openf1SessionKey: sessions.openf1SessionKey })
    .from(sessions)
    .innerJoin(races, eq(sessions.raceId, races.id))
    .where(eq(races.season, season));
  const dbSessionByKey = new Map(existingSessions.map((s) => [s.openf1SessionKey, s]));

  const relevantSessions = openf1Sessions.filter((s) => SESSION_TYPE_MAP[s.session_name]);
  let skipped = 0;
  let processed = 0;
  for (const s of openf1Sessions) {
    const sessionType = SESSION_TYPE_MAP[s.session_name];
    if (!sessionType) continue; // skip sprint/testing sessions for now

    const sessionDate = s.date_start.slice(0, 10);
    const matchingRace = dbRaces.find((r) => {
      const raceDate = new Date(r.date).getTime();
      const thisDate = new Date(sessionDate).getTime();
      return Math.abs(raceDate - thisDate) <= 3 * 24 * 60 * 60 * 1000; // within race weekend
    });
    if (!matchingRace) {
      console.warn(`[openf1] no matching race for session ${s.session_key} (${s.circuit_short_name} ${sessionDate})`);
      continue;
    }

    const existing = dbSessionByKey.get(s.session_key);
    if (
      existing &&
      matchingRace.id !== latestRaceId &&
      (await isSessionFullyIngested(existing.id))
    ) {
      skipped++;
      processed++;
      onProgress?.({
        phase: "openf1",
        message: `${s.circuit_short_name} ${s.session_name} already up to date`,
        completed: processed,
        total: relevantSessions.length,
      });
      continue;
    }

    console.log(`[openf1] ${s.circuit_short_name} ${s.session_name} (session_key=${s.session_key})`);
    processed++;
    onProgress?.({
      phase: "openf1",
      message: `${s.circuit_short_name} ${s.session_name} — importing laps`,
      completed: processed,
      total: relevantSessions.length,
    });

    try {
      const weather = await ingestSessionWeather(s.session_key);
      const dbSessionId = await upsertSession(matchingRace.id, sessionType, s.session_key, weather);
      const driverNumberToId = await buildDriverNumberMap(s.session_key, allDrivers);

      await ingestLaps(dbSessionId, s.session_key, driverNumberToId);
      await ingestStints(dbSessionId, s.session_key, driverNumberToId);
    } catch (err) {
      console.error(`[openf1] failed to ingest session ${s.session_key} (${s.circuit_short_name} ${s.session_name}), skipping:`, err instanceof Error ? err.message : err);
    }
    await sleep(300); // OpenF1 rate limit is generous but not unlimited
  }

  console.log(`[openf1] season ${season} done (${skipped} sessions already up to date)`);
}
