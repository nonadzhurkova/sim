import { db } from "@/db";
import type { ProgressReporter } from "./progress";
import { circuits, drivers, teams, races, raceResults, qualifyingResults, sprintResults } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const BASE_URL = "https://api.jolpi.ca/ergast/f1";

type ErgastDriver = {
  driverId: string;
  code?: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  nationality: string;
};

type ErgastConstructor = {
  constructorId: string;
  name: string;
  nationality: string;
};

type ErgastCircuit = {
  circuitId: string;
  circuitName: string;
  Location: { country: string };
};

type ErgastRaceResult = {
  position: string;
  grid: string;
  status: string;
  Driver: ErgastDriver;
  Constructor: ErgastConstructor;
};

type ErgastQualifyingResult = {
  position: string;
  Driver: ErgastDriver;
  Constructor: ErgastConstructor;
  Q1?: string;
  Q2?: string;
  Q3?: string;
};

type ErgastRace = {
  season: string;
  round: string;
  date: string;
  /** UTC time-of-day, e.g. "04:00:00Z" -- present on every race Jolpica has scheduling data for, absent on some very old/incomplete entries. */
  time?: string;
  Circuit: ErgastCircuit;
  Results?: ErgastRaceResult[];
  QualifyingResults?: ErgastQualifyingResult[];
  SprintResults?: ErgastRaceResult[];
  /** Present (with its own scheduled date/time) only on sprint weekends, in the calendar endpoint's response -- known ahead of the weekend, unlike SprintResults. */
  Sprint?: unknown;
};

/** Combines Jolpica's separate date + time-of-day fields into one instant, or null if either is missing/malformed. */
function raceStartsAt(date: string, time?: string): Date | null {
  if (!time) return null;
  const iso = `${date}T${time}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adding the sprint.json fetch alongside results.json and qualifying.json
 * tripled the request rate per round with no throttling, which started
 * tripping Jolpica's rate limit mid-ingest and aborting the whole run.
 * Retries with backoff on 429, same pattern as the OpenF1 client.
 */
async function fetchJson<T>(url: string, retries = 5): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      const backoffMs = 1000 * 2 ** attempt;
      console.warn(`[jolpica] rate limited, retrying in ${backoffMs}ms: ${url}`);
      await sleep(backoffMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Jolpica request failed (${res.status}): ${url}`);
    }
    return res.json() as Promise<T>;
  }
  throw new Error(`Jolpica request failed after ${retries} retries (429): ${url}`);
}

function qualifyingTimeToSeconds(time?: string): number | null {
  if (!time) return null;
  const match = time.match(/^(\d+):(\d+\.\d+)$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseFloat(match[2]);
}

async function upsertCircuit(c: ErgastCircuit): Promise<number> {
  const existing = await db
    .select({ id: circuits.id })
    .from(circuits)
    .where(eq(circuits.externalRef, c.circuitId));
  if (existing.length > 0) return existing[0].id;

  const [row] = await db
    .insert(circuits)
    .values({
      externalRef: c.circuitId,
      name: c.circuitName,
      country: c.Location.country,
    })
    .onConflictDoUpdate({
      target: circuits.externalRef,
      set: { name: c.circuitName, country: c.Location.country },
    })
    .returning({ id: circuits.id });
  return row.id;
}

async function upsertDriver(d: ErgastDriver): Promise<number> {
  const [row] = await db
    .insert(drivers)
    .values({
      externalRef: d.driverId,
      name: `${d.givenName} ${d.familyName}`,
      nationality: d.nationality,
      dateOfBirth: d.dateOfBirth,
    })
    .onConflictDoUpdate({
      target: drivers.externalRef,
      set: {
        name: `${d.givenName} ${d.familyName}`,
        nationality: d.nationality,
        dateOfBirth: d.dateOfBirth,
      },
    })
    .returning({ id: drivers.id });
  return row.id;
}

async function upsertTeam(c: ErgastConstructor): Promise<number> {
  const [row] = await db
    .insert(teams)
    .values({ externalRef: c.constructorId, name: c.name })
    .onConflictDoUpdate({
      target: teams.externalRef,
      set: { name: c.name },
    })
    .returning({ id: teams.id });
  return row.id;
}

async function upsertRace(r: ErgastRace, circuitId: number): Promise<number> {
  const season = parseInt(r.season, 10);
  const round = parseInt(r.round, 10);
  const isSprintWeekend = r.Sprint != null;
  const startsAt = raceStartsAt(r.date, r.time);
  const [row] = await db
    .insert(races)
    .values({ season, round, circuitId, date: r.date, startsAt, isSprintWeekend })
    .onConflictDoUpdate({
      target: [races.season, races.round],
      set: { circuitId, date: r.date, startsAt, isSprintWeekend },
    })
    .returning({ id: races.id });
  return row.id;
}

/**
 * Ergast/Jolpica status strings observed: "Finished", "Lapped" (classified
 * finisher, one or more laps down — NOT a retirement), "+N Lap(s)" (older
 * API shape, same meaning as "Lapped"), "Retired", "Disqualified", "Did not
 * start". Only "Retired" is a true DNF; the API gives no specific cause
 * (engine vs accident) so dnf_cause is left null rather than guessed.
 */
async function ingestRaceResults(raceId: number, results: ErgastRaceResult[]) {
  for (const result of results) {
    const driverId = await upsertDriver(result.Driver);
    const teamId = await upsertTeam(result.Constructor);
    const finished =
      result.status === "Finished" || result.status === "Lapped" || result.status.startsWith("+");
    const status = finished ? "finished" : result.status === "Disqualified" ? "dsq" : "dnf";

    await db
      .insert(raceResults)
      .values({
        raceId,
        driverId,
        teamId,
        gridPosition: parseInt(result.grid, 10) || null,
        finishPosition: parseInt(result.position, 10) || null,
        status,
        dnfCause: null,
      })
      .onConflictDoUpdate({
        target: [raceResults.raceId, raceResults.driverId],
        set: {
          teamId,
          gridPosition: parseInt(result.grid, 10) || null,
          finishPosition: parseInt(result.position, 10) || null,
          status,
          dnfCause: null,
        },
      });
  }
}

/** Same status mapping as ingestRaceResults -- see its comment. */
async function ingestSprintResults(raceId: number, results: ErgastRaceResult[]) {
  for (const result of results) {
    const driverId = await upsertDriver(result.Driver);
    const teamId = await upsertTeam(result.Constructor);
    const finished =
      result.status === "Finished" || result.status === "Lapped" || result.status.startsWith("+");
    const status = finished ? "finished" : result.status === "Disqualified" ? "dsq" : "dnf";

    await db
      .insert(sprintResults)
      .values({
        raceId,
        driverId,
        teamId,
        gridPosition: parseInt(result.grid, 10) || null,
        finishPosition: parseInt(result.position, 10) || null,
        status,
      })
      .onConflictDoUpdate({
        target: [sprintResults.raceId, sprintResults.driverId],
        set: {
          teamId,
          gridPosition: parseInt(result.grid, 10) || null,
          finishPosition: parseInt(result.position, 10) || null,
          status,
        },
      });
  }
}

async function ingestQualifying(raceId: number, results: ErgastQualifyingResult[]) {
  // gap_to_pole computed from best lap across Q1/Q2/Q3, relative to pole's best lap
  const bestLaps = results.map((r) => {
    const times = [
      qualifyingTimeToSeconds(r.Q3),
      qualifyingTimeToSeconds(r.Q2),
      qualifyingTimeToSeconds(r.Q1),
    ].filter((t): t is number => t !== null);
    return { result: r, bestTime: times.length > 0 ? Math.min(...times) : null };
  });
  const poleTime = bestLaps.find((b) => b.result.position === "1")?.bestTime ?? null;

  for (const { result, bestTime } of bestLaps) {
    const driverId = await upsertDriver(result.Driver);
    const teamId = await upsertTeam(result.Constructor);
    const gapToPole = poleTime !== null && bestTime !== null ? bestTime - poleTime : null;

    await db
      .insert(qualifyingResults)
      .values({
        raceId,
        driverId,
        teamId,
        position: parseInt(result.position, 10) || null,
        gapToPole,
      })
      .onConflictDoUpdate({
        target: [qualifyingResults.raceId, qualifyingResults.driverId],
        set: {
          teamId,
          position: parseInt(result.position, 10) || null,
          gapToPole,
        },
      });
  }
}

/**
 * A race is considered fully ingested if it already has both results and
 * qualifying stored. The latest round in the season is never skipped even
 * if "complete," since it may have been ingested mid-weekend before final
 * results were available upstream.
 */
async function isRaceFullyIngested(raceId: number, isSprintWeekend: boolean): Promise<boolean> {
  const [[{ resultCount }], [{ qualCount }], [{ sprintCount }]] = await Promise.all([
    db.select({ resultCount: sql<number>`count(*)` }).from(raceResults).where(eq(raceResults.raceId, raceId)),
    db.select({ qualCount: sql<number>`count(*)` }).from(qualifyingResults).where(eq(qualifyingResults.raceId, raceId)),
    db.select({ sprintCount: sql<number>`count(*)` }).from(sprintResults).where(eq(sprintResults.raceId, raceId)),
  ]);
  if (Number(resultCount) === 0 || Number(qualCount) === 0) return false;
  // A sprint weekend isn't "fully ingested" until its sprint results exist
  // too -- otherwise a round already imported before sprint support existed
  // would be skipped forever, never picking up its sprint points.
  return !isSprintWeekend || Number(sprintCount) > 0;
}

export async function ingestSeason(season: number, onProgress?: ProgressReporter) {
  console.log(`[jolpica] fetching season ${season}...`);
  onProgress?.({ phase: "jolpica", message: `Fetching ${season} calendar` });
  const raceTable = await fetchJson<{
    MRData: { RaceTable: { Races: ErgastRace[] } };
  }>(`${BASE_URL}/${season}.json?limit=100`);
  const raceList = raceTable.MRData.RaceTable.Races;
  const latestRound = Math.max(...raceList.map((r) => parseInt(r.round, 10)));

  let skipped = 0;
  let processed = 0;
  for (const raceMeta of raceList) {
    const round = raceMeta.round;

    const circuitId = await upsertCircuit(raceMeta.Circuit);
    const raceId = await upsertRace(raceMeta, circuitId);
    const isSprintWeekend = raceMeta.Sprint != null;

    if (parseInt(round, 10) !== latestRound && (await isRaceFullyIngested(raceId, isSprintWeekend))) {
      skipped++;
      processed++;
      onProgress?.({
        phase: "jolpica",
        message: `Round ${round} already up to date`,
        completed: processed,
        total: raceList.length,
      });
      continue;
    }

    console.log(`[jolpica] season ${season} round ${round}: ${raceMeta.Circuit.circuitName}`);
    processed++;
    onProgress?.({
      phase: "jolpica",
      message: `Round ${round} — ${raceMeta.Circuit.circuitName}`,
      completed: processed,
      total: raceList.length,
    });

    const resultsData = await fetchJson<{
      MRData: { RaceTable: { Races: ErgastRace[] } };
    }>(`${BASE_URL}/${season}/${round}/results.json?limit=30`);
    const results = resultsData.MRData.RaceTable.Races[0]?.Results ?? [];
    if (results.length > 0) {
      await ingestRaceResults(raceId, results);
    }

    const qualData = await fetchJson<{
      MRData: { RaceTable: { Races: ErgastRace[] } };
    }>(`${BASE_URL}/${season}/${round}/qualifying.json?limit=30`);
    const qualResults = qualData.MRData.RaceTable.Races[0]?.QualifyingResults ?? [];
    if (qualResults.length > 0) {
      await ingestQualifying(raceId, qualResults);
    }

    // The calendar entry's own "Sprint" field already says whether this
    // round has one -- skip the extra request for the (large majority of)
    // rounds that don't, rather than firing it every round and relying on
    // rate-limit backoff to absorb the extra traffic.
    if (isSprintWeekend) {
      const sprintData = await fetchJson<{
        MRData: { RaceTable: { Races: ErgastRace[] } };
      }>(`${BASE_URL}/${season}/${round}/sprint.json?limit=30`);
      const sprintResultsData = sprintData.MRData.RaceTable.Races[0]?.SprintResults ?? [];
      if (sprintResultsData.length > 0) {
        await ingestSprintResults(raceId, sprintResultsData);
      }
    }
  }

  console.log(`[jolpica] season ${season} done (${raceList.length} races, ${skipped} already up to date)`);
}
