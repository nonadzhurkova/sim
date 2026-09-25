import { db } from "@/db";
import { sessions, races } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

/**
 * On-the-fly telemetry analysis for one team at one race weekend.
 *
 * Deliberately fetches from OpenF1 at request time rather than storing any of
 * this: the per-lap sector/speed fields are ~180 KB per session, but the
 * full-rate car telemetry behind them is ~3 MB *per driver per session*
 * (~7 GB a season), and it is only interesting for the current weekend. So
 * none of it is persisted — the analysis is computed when the page is opened
 * and thrown away.
 *
 * The questions this is built to answer: where in the lap is the team losing
 * time, and is the loss on the straights (engine and drag) or in the corners
 * (downforce, traction, balance)?
 */

import { openF1Fetch } from "@/lib/openf1-client";

/** OpenF1 spells some constructors differently from our `teams` table. */
const TEAM_NAME_ALIASES: Record<string, string[]> = {
  Ferrari: ["Ferrari"],
  Mercedes: ["Mercedes"],
  McLaren: ["McLaren"],
  "Red Bull": ["Red Bull Racing"],
  "RB F1 Team": ["Racing Bulls", "RB"],
  "Aston Martin": ["Aston Martin"],
  Alpine: ["Alpine"],
  "Alpine F1 Team": ["Alpine"],
  Williams: ["Williams"],
  Sauber: ["Sauber", "Kick Sauber"],
  "Haas F1 Team": ["Haas F1 Team"],
  Audi: ["Audi"],
  "Cadillac F1 Team": ["Cadillac"],
};

function matchesTeam(openF1TeamName: string, ourTeamName: string): boolean {
  const aliases = TEAM_NAME_ALIASES[ourTeamName] ?? [ourTeamName];
  return aliases.some((a) => a.toLowerCase() === openF1TeamName.toLowerCase());
}

type OpenF1Driver = {
  driver_number: number;
  name_acronym: string;
  full_name: string;
  team_name: string | null;
};

type OpenF1Lap = {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  i1_speed: number | null;
  i2_speed: number | null;
  st_speed: number | null;
  is_pit_out_lap: boolean;
};

export type DriverTelemetrySummary = {
  driverNumber: number;
  acronym: string;
  fullName: string;
  teamName: string | null;
  isTargetTeam: boolean;
  bestLap: number;
  /** Best time in each sector across the session — not necessarily one lap. */
  bestSectors: [number | null, number | null, number | null];
  /** Best of all sectors added up: the lap the car was capable of. */
  theoreticalBest: number | null;
  /** Top speed through the trap — the clearest engine + drag indicator. */
  speedTrap: number | null;
  /** Speeds at the two intermediate points — corner exit and mid-lap. */
  i1Speed: number | null;
  i2Speed: number | null;
  rank: number;
};

export type SectorComparison = {
  sector: 1 | 2 | 3;
  targetTime: number;
  rivalTime: number;
  /** Positive = target team is slower here. */
  delta: number;
};

export type RivalComparison = {
  rival: DriverTelemetrySummary;
  lapDelta: number;
  sectors: SectorComparison[];
  speedTrapDelta: number | null;
  i1Delta: number | null;
  i2Delta: number | null;
  /** Which sector costs the most time against this rival. */
  worstSector: 1 | 2 | 3 | null;
  /**
   * Plain-language read of whether the loss is engine/drag or cornering,
   * derived from whether the speed-trap gap is meaningful relative to the
   * lap-time gap.
   */
  diagnosis: "engine" | "cornering" | "mixed" | "ahead";
};

export type SessionTelemetryAnalysis = {
  sessionType: "fp1" | "fp2" | "fp3" | "q" | "r";
  /** Every driver in the session, ranked by best lap. */
  drivers: DriverTelemetrySummary[];
  /** The target team's own drivers. */
  teamDrivers: DriverTelemetrySummary[];
  /** The team's quicker driver this session, used as the comparison anchor. */
  leadDriver: DriverTelemetrySummary | null;
  /** Comparisons against every driver who out-qualified/out-paced them. */
  rivalsAhead: RivalComparison[];
};

export type TeamTelemetryReport = {
  teamName: string;
  raceId: number;
  season: number;
  round: number;
  sessions: SessionTelemetryAnalysis[];
  /** Set when OpenF1 could not be reached or is locked by a live session. */
  unavailableReason: string | null;
};

/** A speed-trap gap under this is noise, not an engine deficit. */
const SPEED_TRAP_SIGNIFICANT_KMH = 3;

async function fetchJson<T>(path: string): Promise<T[] | null> {
  const res = await openF1Fetch<T>(path);
  return res.ok ? res.data : null;
}

function summarise(
  driver: OpenF1Driver,
  laps: OpenF1Lap[],
  targetTeam: string,
): DriverTelemetrySummary | null {
  const clean = laps.filter((l) => l.lap_duration != null && !l.is_pit_out_lap);
  if (clean.length === 0) return null;

  const best = Math.min(...clean.map((l) => l.lap_duration as number));
  const sectorBest = (pick: (l: OpenF1Lap) => number | null): number | null => {
    const values = clean.map(pick).filter((v): v is number => v != null && v > 0);
    return values.length > 0 ? Math.min(...values) : null;
  };
  const speedMax = (pick: (l: OpenF1Lap) => number | null): number | null => {
    const values = clean.map(pick).filter((v): v is number => v != null && v > 0);
    return values.length > 0 ? Math.max(...values) : null;
  };

  const bestSectors: [number | null, number | null, number | null] = [
    sectorBest((l) => l.duration_sector_1),
    sectorBest((l) => l.duration_sector_2),
    sectorBest((l) => l.duration_sector_3),
  ];
  const theoreticalBest = bestSectors.every((s) => s != null)
    ? (bestSectors[0] as number) + (bestSectors[1] as number) + (bestSectors[2] as number)
    : null;

  return {
    driverNumber: driver.driver_number,
    acronym: driver.name_acronym,
    fullName: driver.full_name,
    teamName: driver.team_name,
    isTargetTeam: driver.team_name != null && matchesTeam(driver.team_name, targetTeam),
    bestLap: best,
    bestSectors,
    theoreticalBest,
    speedTrap: speedMax((l) => l.st_speed),
    i1Speed: speedMax((l) => l.i1_speed),
    i2Speed: speedMax((l) => l.i2_speed),
    rank: 0,
  };
}

function compare(
  target: DriverTelemetrySummary,
  rival: DriverTelemetrySummary,
): RivalComparison {
  const sectors: SectorComparison[] = [];
  for (let i = 0; i < 3; i++) {
    const t = target.bestSectors[i];
    const r = rival.bestSectors[i];
    if (t == null || r == null) continue;
    sectors.push({ sector: (i + 1) as 1 | 2 | 3, targetTime: t, rivalTime: r, delta: t - r });
  }

  const worst = sectors.reduce<SectorComparison | null>(
    (acc, s) => (acc == null || s.delta > acc.delta ? s : acc),
    null,
  );

  const speedTrapDelta =
    target.speedTrap != null && rival.speedTrap != null
      ? target.speedTrap - rival.speedTrap
      : null;

  const lapDelta = target.bestLap - rival.bestLap;

  // Engine vs cornering: a car genuinely down on power shows it at the speed
  // trap. If the trap speed is level but the lap time isn't, the time is going
  // somewhere the engine isn't responsible for.
  let diagnosis: RivalComparison["diagnosis"];
  if (lapDelta <= 0) {
    diagnosis = "ahead";
  } else if (speedTrapDelta == null) {
    diagnosis = "mixed";
  } else if (speedTrapDelta <= -SPEED_TRAP_SIGNIFICANT_KMH) {
    // Meaningfully slower down the straight — but if the corners are also bad
    // it is not purely an engine story.
    const corneringLoss = sectors.filter((s) => s.delta > 0.1).length;
    diagnosis = corneringLoss >= 2 ? "mixed" : "engine";
  } else {
    diagnosis = "cornering";
  }

  return {
    rival,
    lapDelta,
    sectors,
    speedTrapDelta,
    i1Delta:
      target.i1Speed != null && rival.i1Speed != null ? target.i1Speed - rival.i1Speed : null,
    i2Delta:
      target.i2Speed != null && rival.i2Speed != null ? target.i2Speed - rival.i2Speed : null,
    worstSector: worst?.sector ?? null,
    diagnosis,
  };
}

/**
 * Builds the full report for one team at one race weekend, across every
 * session OpenF1 has data for.
 */
export async function getTeamTelemetryReport(
  raceId: number,
  teamName: string,
): Promise<TeamTelemetryReport | null> {
  const [race] = await db
    .select({ id: races.id, season: races.season, round: races.round })
    .from(races)
    .where(eq(races.id, raceId));
  if (!race) return null;

  const storedSessions = await db
    .select({ sessionType: sessions.sessionType, key: sessions.openf1SessionKey })
    .from(sessions)
    .where(
      and(
        eq(sessions.raceId, raceId),
        inArray(sessions.sessionType, ["fp1", "fp2", "fp3", "q", "r"]),
      ),
    );

  const withKeys = storedSessions.filter(
    (s): s is { sessionType: "fp1" | "fp2" | "fp3" | "q" | "r"; key: number } => s.key != null,
  );

  const base: TeamTelemetryReport = {
    teamName,
    raceId,
    season: race.season,
    round: race.round,
    sessions: [],
    unavailableReason: null,
  };

  if (withKeys.length === 0) {
    base.unavailableReason = "No OpenF1 sessions recorded for this weekend yet.";
    return base;
  }

  // Most recent session first — that's the one being asked about.
  const order: Record<string, number> = { r: 0, q: 1, fp3: 2, fp2: 3, fp1: 4 };
  withKeys.sort((a, b) => (order[a.sessionType] ?? 9) - (order[b.sessionType] ?? 9));

  let anyFetched = false;
  for (const session of withKeys) {
    const [drivers, laps] = await Promise.all([
      fetchJson<OpenF1Driver>(`/drivers?session_key=${session.key}`),
      fetchJson<OpenF1Lap>(`/laps?session_key=${session.key}`),
    ]);
    if (!drivers || !laps || drivers.length === 0 || laps.length === 0) continue;
    anyFetched = true;

    const lapsByDriver = new Map<number, OpenF1Lap[]>();
    for (const lap of laps) {
      if (!lapsByDriver.has(lap.driver_number)) lapsByDriver.set(lap.driver_number, []);
      lapsByDriver.get(lap.driver_number)!.push(lap);
    }

    const summaries = drivers
      .map((d) => summarise(d, lapsByDriver.get(d.driver_number) ?? [], teamName))
      .filter((s): s is DriverTelemetrySummary => s != null)
      .sort((a, b) => a.bestLap - b.bestLap)
      .map((s, i) => ({ ...s, rank: i + 1 }));

    const teamDrivers = summaries.filter((s) => s.isTargetTeam);
    const leadDriver = teamDrivers[0] ?? null;
    const rivalsAhead = leadDriver
      ? summaries
          .filter((s) => !s.isTargetTeam && s.bestLap < leadDriver.bestLap)
          .map((rival) => compare(leadDriver, rival))
      : [];

    base.sessions.push({
      sessionType: session.sessionType,
      drivers: summaries,
      teamDrivers,
      leadDriver,
      rivalsAhead,
    });
  }

  if (!anyFetched) {
    base.unavailableReason =
      "OpenF1 returned no data — it blocks all access, including past sessions, while an F1 session is live. Try again once the session ends.";
  }

  return base;
}
