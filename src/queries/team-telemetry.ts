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

/** Where the team stands on one measurable axis against the whole field. */
export type FieldRanking = {
  metric: "speedTrap" | "sector1" | "sector2" | "sector3" | "i1Speed" | "i2Speed";
  label: string;
  /** Whether a bigger number is better (speeds) or worse (sector times). */
  higherIsBetter: boolean;
  /** The team's best value on this metric. */
  teamValue: number | null;
  /** Best in the field, and who set it. */
  fieldBest: number;
  fieldBestDriver: string;
  fieldMedian: number;
  /** Where the team ranks, 1 = best in the field. */
  teamRank: number | null;
  fieldSize: number;
  /** Gap from the team to the field's best, in the metric's own units. */
  gapToBest: number | null;
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
  /**
   * Comparisons against the nearest cars behind too. A team that qualifies
   * near the front has almost nobody ahead, so "cars ahead" alone says very
   * little — the margin over the car behind is just as informative about
   * where the car is strong.
   */
  rivalsBehind: RivalComparison[];
  /** How the team ranks on each measurable axis across the whole field. */
  fieldRankings: FieldRanking[];
  /** Best sector times anywhere in the field, and who set them. */
  idealLap: { sector: 1 | 2 | 3; time: number; driver: string; teamGap: number | null }[];
  /** The two team-mates compared against each other. */
  teammateComparison: RivalComparison | null;
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
 * Ranks the team against the entire field on each measurable axis.
 *
 * This is what makes the analysis useful for a team that qualified near the
 * front: "P2, only one car ahead" says almost nothing, whereas "3rd fastest
 * through the speed trap but 8th best in sector 2" localises the weakness
 * regardless of where they finished.
 */
function buildFieldRankings(
  all: DriverTelemetrySummary[],
  teamDrivers: DriverTelemetrySummary[],
): FieldRanking[] {
  if (teamDrivers.length === 0) return [];

  const specs: {
    metric: FieldRanking["metric"];
    label: string;
    higherIsBetter: boolean;
    pick: (d: DriverTelemetrySummary) => number | null;
  }[] = [
    { metric: "sector1", label: "Sector 1", higherIsBetter: false, pick: (d) => d.bestSectors[0] },
    { metric: "sector2", label: "Sector 2", higherIsBetter: false, pick: (d) => d.bestSectors[1] },
    { metric: "sector3", label: "Sector 3", higherIsBetter: false, pick: (d) => d.bestSectors[2] },
    { metric: "speedTrap", label: "Speed trap", higherIsBetter: true, pick: (d) => d.speedTrap },
    { metric: "i1Speed", label: "Intermediate 1", higherIsBetter: true, pick: (d) => d.i1Speed },
    { metric: "i2Speed", label: "Intermediate 2", higherIsBetter: true, pick: (d) => d.i2Speed },
  ];

  const out: FieldRanking[] = [];
  for (const spec of specs) {
    const values = all
      .map((d) => ({ driver: d, value: spec.pick(d) }))
      .filter((v): v is { driver: DriverTelemetrySummary; value: number } => v.value != null);
    if (values.length === 0) continue;

    values.sort((a, b) =>
      spec.higherIsBetter ? b.value - a.value : a.value - b.value,
    );

    const teamValues = teamDrivers
      .map(spec.pick)
      .filter((v): v is number => v != null);
    const teamValue =
      teamValues.length === 0
        ? null
        : spec.higherIsBetter
          ? Math.max(...teamValues)
          : Math.min(...teamValues);

    const teamRank =
      teamValue == null ? null : values.findIndex((v) => v.value === teamValue) + 1 || null;

    const sortedForMedian = values.map((v) => v.value).sort((a, b) => a - b);
    const fieldMedian = sortedForMedian[Math.floor(sortedForMedian.length / 2)];

    out.push({
      metric: spec.metric,
      label: spec.label,
      higherIsBetter: spec.higherIsBetter,
      teamValue,
      fieldBest: values[0].value,
      fieldBestDriver: values[0].driver.acronym,
      fieldMedian,
      teamRank,
      fieldSize: values.length,
      gapToBest: teamValue == null ? null : Math.abs(teamValue - values[0].value),
    });
  }
  return out;
}

/**
 * The field's best time in each sector, and how far the team is off it —
 * the theoretical lap nobody actually drove.
 */
function buildIdealLap(
  all: DriverTelemetrySummary[],
  teamDrivers: DriverTelemetrySummary[],
): SessionTelemetryAnalysis["idealLap"] {
  const out: SessionTelemetryAnalysis["idealLap"] = [];
  for (let i = 0; i < 3; i++) {
    const values = all
      .map((d) => ({ driver: d, value: d.bestSectors[i] }))
      .filter((v): v is { driver: DriverTelemetrySummary; value: number } => v.value != null);
    if (values.length === 0) continue;
    values.sort((a, b) => a.value - b.value);
    const teamBest = teamDrivers
      .map((d) => d.bestSectors[i])
      .filter((v): v is number => v != null);
    out.push({
      sector: (i + 1) as 1 | 2 | 3,
      time: values[0].value,
      driver: values[0].driver.acronym,
      teamGap: teamBest.length > 0 ? Math.min(...teamBest) - values[0].value : null,
    });
  }
  return out;
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
    // The three closest cars behind, so a front-running team still has
    // something to compare against.
    const rivalsBehind = leadDriver
      ? summaries
          .filter((s) => !s.isTargetTeam && s.bestLap > leadDriver.bestLap)
          .slice(0, 3)
          .map((rival) => compare(leadDriver, rival))
      : [];

    base.sessions.push({
      sessionType: session.sessionType,
      drivers: summaries,
      teamDrivers,
      leadDriver,
      rivalsAhead,
      rivalsBehind,
      fieldRankings: leadDriver ? buildFieldRankings(summaries, teamDrivers) : [],
      idealLap: buildIdealLap(summaries, teamDrivers),
      teammateComparison:
        teamDrivers.length >= 2 ? compare(teamDrivers[0], teamDrivers[1]) : null,
    });
  }

  if (!anyFetched) {
    base.unavailableReason =
      "OpenF1 returned no data — it blocks all access, including past sessions, while an F1 session is live. Try again once the session ends.";
  }

  return base;
}
