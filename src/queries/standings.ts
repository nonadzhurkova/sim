import { db } from "@/db";
import { races, raceResults, drivers, teams } from "@/db/schema";
import { eq, and, lte, asc } from "drizzle-orm";

/**
 * Championship standings, computed from stored race results.
 *
 * Ergast/Jolpica does expose standings endpoints, but deriving them from the
 * results we already have avoids another ingestion path and another thing to
 * keep in sync — and it means a standings table exists for any race we have
 * results for, including partial seasons.
 *
 * Caveat worth knowing: this counts race-classification points only. Sprint
 * races and the fastest-lap bonus (where a season used one) are not modelled,
 * so totals can differ slightly from the official table in those seasons.
 */

/** Current F1 scoring for positions 1-10. */
const POINTS_BY_POSITION = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export function pointsForPosition(position: number | null): number {
  if (position == null || position < 1 || position > POINTS_BY_POSITION.length) return 0;
  return POINTS_BY_POSITION[position - 1];
}

export type DriverStanding = {
  position: number;
  driverId: number;
  driverName: string;
  driverNumber: number | null;
  headshotUrl: string | null;
  teamName: string | null;
  points: number;
  wins: number;
  podiums: number;
  /** Points scored in each round, oldest first — for the progression chart. */
  pointsByRound: { round: number; points: number; cumulative: number }[];
  /** Change in championship position since the previous round. */
  positionChange: number | null;
};

export type TeamStanding = {
  position: number;
  teamId: number;
  teamName: string;
  points: number;
  wins: number;
  podiums: number;
  driverNames: string[];
  pointsByRound: { round: number; points: number; cumulative: number }[];
  positionChange: number | null;
};

export type Standings = {
  season: number;
  /** Rounds actually scored, so the UI can say "after round N". */
  roundsScored: number;
  drivers: DriverStanding[];
  teams: TeamStanding[];
};

type ResultRow = {
  round: number;
  driverId: number;
  driverName: string;
  driverNumber: number | null;
  headshotUrl: string | null;
  teamId: number;
  teamName: string;
  finishPosition: number | null;
  status: "finished" | "dnf" | "dsq" | null;
};

/**
 * Standings after `upToRound`, or for the whole season when omitted.
 * `upToRound` exists so the position-change arrows can be computed by running
 * the same calculation one round earlier.
 */
export async function getStandings(season: number, upToRound?: number): Promise<Standings> {
  const conditions = [eq(races.season, season)];
  if (upToRound != null) conditions.push(lte(races.round, upToRound));

  const rows: ResultRow[] = await db
    .select({
      round: races.round,
      driverId: raceResults.driverId,
      driverName: drivers.name,
      driverNumber: drivers.driverNumber,
      headshotUrl: drivers.headshotUrl,
      teamId: raceResults.teamId,
      teamName: teams.name,
      finishPosition: raceResults.finishPosition,
      status: raceResults.status,
    })
    .from(raceResults)
    .innerJoin(races, eq(raceResults.raceId, races.id))
    .innerJoin(drivers, eq(raceResults.driverId, drivers.id))
    .innerJoin(teams, eq(raceResults.teamId, teams.id))
    .where(and(...conditions))
    .orderBy(asc(races.round));

  const roundsScored = rows.length > 0 ? Math.max(...rows.map((r) => r.round)) : 0;

  // --- drivers ---
  type DriverAcc = {
    driverId: number;
    driverName: string;
    driverNumber: number | null;
    headshotUrl: string | null;
    teamName: string | null;
    points: number;
    wins: number;
    podiums: number;
    byRound: Map<number, number>;
  };
  const driverAcc = new Map<number, DriverAcc>();
  const teamAcc = new Map<
    number,
    { teamId: number; teamName: string; points: number; wins: number; podiums: number; drivers: Set<string>; byRound: Map<number, number> }
  >();

  for (const r of rows) {
    const scored = r.status === "finished" ? pointsForPosition(r.finishPosition) : 0;
    const isWin = r.status === "finished" && r.finishPosition === 1;
    const isPodium =
      r.status === "finished" && r.finishPosition != null && r.finishPosition <= 3;

    if (!driverAcc.has(r.driverId)) {
      driverAcc.set(r.driverId, {
        driverId: r.driverId,
        driverName: r.driverName,
        driverNumber: r.driverNumber,
        headshotUrl: r.headshotUrl,
        teamName: r.teamName,
        points: 0,
        wins: 0,
        podiums: 0,
        byRound: new Map(),
      });
    }
    const d = driverAcc.get(r.driverId)!;
    d.points += scored;
    if (isWin) d.wins++;
    if (isPodium) d.podiums++;
    d.byRound.set(r.round, (d.byRound.get(r.round) ?? 0) + scored);
    // Latest round wins, so a mid-season switch shows the current team.
    d.teamName = r.teamName;

    if (!teamAcc.has(r.teamId)) {
      teamAcc.set(r.teamId, {
        teamId: r.teamId,
        teamName: r.teamName,
        points: 0,
        wins: 0,
        podiums: 0,
        drivers: new Set(),
        byRound: new Map(),
      });
    }
    const t = teamAcc.get(r.teamId)!;
    t.points += scored;
    if (isWin) t.wins++;
    if (isPodium) t.podiums++;
    t.drivers.add(r.driverName);
    t.byRound.set(r.round, (t.byRound.get(r.round) ?? 0) + scored);
  }

  const allRounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b);
  const buildProgression = (byRound: Map<number, number>) => {
    let cumulative = 0;
    return allRounds.map((round) => {
      const points = byRound.get(round) ?? 0;
      cumulative += points;
      return { round, points, cumulative };
    });
  };

  // Ties broken by wins, then podiums — the usual countback.
  const sortStandings = <T extends { points: number; wins: number; podiums: number }>(a: T, b: T) =>
    b.points - a.points || b.wins - a.wins || b.podiums - a.podiums;

  const driverStandings: DriverStanding[] = [...driverAcc.values()]
    .sort(sortStandings)
    .map((d, i) => ({
      position: i + 1,
      driverId: d.driverId,
      driverName: d.driverName,
      driverNumber: d.driverNumber,
      headshotUrl: d.headshotUrl,
      teamName: d.teamName,
      points: d.points,
      wins: d.wins,
      podiums: d.podiums,
      pointsByRound: buildProgression(d.byRound),
      positionChange: null,
    }));

  const teamStandings: TeamStanding[] = [...teamAcc.values()]
    .sort(sortStandings)
    .map((t, i) => ({
      position: i + 1,
      teamId: t.teamId,
      teamName: t.teamName,
      points: t.points,
      wins: t.wins,
      podiums: t.podiums,
      driverNames: [...t.drivers],
      pointsByRound: buildProgression(t.byRound),
      positionChange: null,
    }));

  // Position change since the previous round, by re-running one round back.
  if (upToRound == null && roundsScored > 1) {
    const previous = await getStandings(season, roundsScored - 1);
    const prevDriver = new Map(previous.drivers.map((d) => [d.driverId, d.position]));
    const prevTeam = new Map(previous.teams.map((t) => [t.teamId, t.position]));
    for (const d of driverStandings) {
      const was = prevDriver.get(d.driverId);
      d.positionChange = was != null ? was - d.position : null;
    }
    for (const t of teamStandings) {
      const was = prevTeam.get(t.teamId);
      t.positionChange = was != null ? was - t.position : null;
    }
  }

  return { season, roundsScored, drivers: driverStandings, teams: teamStandings };
}
