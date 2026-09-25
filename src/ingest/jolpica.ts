import { db } from "@/db";
import { circuits, drivers, teams, races, raceResults, qualifyingResults } from "@/db/schema";
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
  Circuit: ErgastCircuit;
  Results?: ErgastRaceResult[];
  QualifyingResults?: ErgastQualifyingResult[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jolpica request failed (${res.status}): ${url}`);
  }
  return res.json() as Promise<T>;
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
  const [row] = await db
    .insert(races)
    .values({ season, round, circuitId, date: r.date })
    .onConflictDoUpdate({
      target: [races.season, races.round],
      set: { circuitId, date: r.date },
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
async function isRaceFullyIngested(raceId: number): Promise<boolean> {
  const [[{ resultCount }], [{ qualCount }]] = await Promise.all([
    db.select({ resultCount: sql<number>`count(*)` }).from(raceResults).where(eq(raceResults.raceId, raceId)),
    db.select({ qualCount: sql<number>`count(*)` }).from(qualifyingResults).where(eq(qualifyingResults.raceId, raceId)),
  ]);
  return Number(resultCount) > 0 && Number(qualCount) > 0;
}

export async function ingestSeason(season: number) {
  console.log(`[jolpica] fetching season ${season}...`);
  const raceTable = await fetchJson<{
    MRData: { RaceTable: { Races: ErgastRace[] } };
  }>(`${BASE_URL}/${season}.json?limit=100`);
  const raceList = raceTable.MRData.RaceTable.Races;
  const latestRound = Math.max(...raceList.map((r) => parseInt(r.round, 10)));

  let skipped = 0;
  for (const raceMeta of raceList) {
    const round = raceMeta.round;

    const circuitId = await upsertCircuit(raceMeta.Circuit);
    const raceId = await upsertRace(raceMeta, circuitId);

    if (parseInt(round, 10) !== latestRound && (await isRaceFullyIngested(raceId))) {
      skipped++;
      continue;
    }

    console.log(`[jolpica] season ${season} round ${round}: ${raceMeta.Circuit.circuitName}`);

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
  }

  console.log(`[jolpica] season ${season} done (${raceList.length} races, ${skipped} already up to date)`);
}
