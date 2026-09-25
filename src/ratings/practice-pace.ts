import { db } from "@/db";
import { sessions, laps, stints } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const FP_BASE_WEIGHTS: Record<"fp1" | "fp2" | "fp3", number> = {
  fp1: 0.15,
  fp2: 0.35,
  fp3: 0.5,
};

const OUT_LAP_THRESHOLD = 1.07; // F1's 107% rule, applied per-driver-per-session-per-compound
const RACE_SIM_RUN_LENGTH = 4; // consecutive similar-pace laps treated as a long run, not one-lap pace
const RACE_SIM_TOLERANCE = 0.015; // 1.5% lap-to-lap variance counts as "similar pace"

/**
 * Practice pace per driver for one race weekend, using FP1-3 sessions that
 * have happened so far (works mid-weekend with only some sessions run).
 * Dry sessions only — wet-session laps are excluded entirely rather than
 * blended in, since they aren't representative of dry-race pace.
 *
 * For each dry FP session: laps are grouped by compound (via stints) after
 * excluding long fuel-heavy "race simulation" runs (see
 * excludeRaceSimLaps), each driver's best remaining lap on a compound is
 * compared to the field's median best on that same compound, weighted by
 * how many drivers ran it, then averaged across compounds. Session paces
 * combine with FP1/FP2/FP3 weights renormalized to whichever sessions are
 * actually available.
 */
export async function computePracticePace(raceId: number): Promise<Map<number, number>> {
  const fpSessions = await db
    .select({ id: sessions.id, sessionType: sessions.sessionType, weather: sessions.weather })
    .from(sessions)
    .where(
      and(
        eq(sessions.raceId, raceId),
        inArray(sessions.sessionType, ["fp1", "fp2", "fp3"]),
      ),
    );

  const dryFpSessions = fpSessions.filter((s) => s.weather !== "wet") as {
    id: number;
    sessionType: "fp1" | "fp2" | "fp3";
    weather: string | null;
  }[];
  if (dryFpSessions.length === 0) return new Map();

  const sessionPaceByType = new Map<"fp1" | "fp2" | "fp3", Map<number, number>>();
  for (const session of dryFpSessions) {
    const pace = await computeSessionCompoundRelativePace(session.id);
    sessionPaceByType.set(session.sessionType, pace);
  }

  const availableTypes = [...sessionPaceByType.keys()];
  const totalWeight = availableTypes.reduce((sum, t) => sum + FP_BASE_WEIGHTS[t], 0);

  const allDriverIds = new Set<number>();
  for (const paceMap of sessionPaceByType.values()) {
    for (const driverId of paceMap.keys()) allDriverIds.add(driverId);
  }

  const result = new Map<number, number>();
  for (const driverId of allDriverIds) {
    let weightedSum = 0;
    let weightUsed = 0;
    for (const type of availableTypes) {
      const pace = sessionPaceByType.get(type)?.get(driverId);
      if (pace == null) continue;
      const w = FP_BASE_WEIGHTS[type] / totalWeight;
      weightedSum += pace * w;
      weightUsed += w;
    }
    if (weightUsed > 0) {
      result.set(driverId, weightedSum / weightUsed);
    }
  }
  return result;
}

type StintInfo = { id: number; driverId: number; compound: string | null; lapStart: number | null; lapEnd: number | null };
type LapInfo = { driverId: number; lapNumber: number; lapDuration: number | null };

/**
 * Within one driver's stint (laps in lap order), detects and drops laps
 * belonging to a "race simulation" run: a window of RACE_SIM_RUN_LENGTH+
 * consecutive laps where most laps cluster within RACE_SIM_TOLERANCE of the
 * window's median. Using "most laps in a window" rather than an unbroken
 * chain means a single anomalous lap — traffic, a yellow flag — doesn't
 * prevent detecting the long run it sits inside. These runs are fuel-heavy
 * long-run laps, not representative of one-lap pace, and would otherwise
 * dominate a median (a driver who does one 12-lap sim and two quick laps
 * looks "slow" if all 14 laps are pooled together). Isolated quick/slow
 * laps are kept as-is.
 */
function excludeRaceSimLaps(sortedLapDurations: number[]): number[] {
  const n = sortedLapDurations.length;
  const isSimLap = new Array(n).fill(false);

  for (let start = 0; start <= n - RACE_SIM_RUN_LENGTH; start++) {
    for (let end = start + RACE_SIM_RUN_LENGTH; end <= n; end++) {
      const window = sortedLapDurations.slice(start, end);
      const windowMedian = median(window);
      const inTolerance = window.filter(
        (lap) => Math.abs(lap - windowMedian) / windowMedian <= RACE_SIM_TOLERANCE,
      ).length;
      // require all but at most one lap in the window to cluster tightly
      if (inTolerance >= window.length - 1) {
        for (let j = start; j < end; j++) isSimLap[j] = true;
      }
    }
  }

  return sortedLapDurations.filter((_, i) => !isSimLap[i]);
}

/**
 * Field-relative pace for one practice session, normalized by tyre compound.
 * See computePracticePace for the method.
 */
async function computeSessionCompoundRelativePace(sessionId: number): Promise<Map<number, number>> {
  const sessionStints: StintInfo[] = await db
    .select({
      id: stints.id,
      driverId: stints.driverId,
      compound: stints.compound,
      lapStart: stints.lapStart,
      lapEnd: stints.lapEnd,
    })
    .from(stints)
    .where(eq(stints.sessionId, sessionId));

  const sessionLaps: LapInfo[] = await db
    .select({ driverId: laps.driverId, lapNumber: laps.lapNumber, lapDuration: laps.lapDuration })
    .from(laps)
    .where(and(eq(laps.sessionId, sessionId), eq(laps.isPitInOut, false)));

  // group laps by stint (driver + lap range), in lap order, so consecutive
  // runs can be detected before laps get pooled by compound across stints
  const lapsByStint = new Map<number, number[]>(); // stintId -> lap durations, in lap order
  for (const stint of sessionStints) {
    if (!stint.compound || stint.lapStart == null || stint.lapEnd == null) continue;
    if (stint.compound === "UNKNOWN" || stint.compound === "TEST_UNKNOWN") continue;
    const stintLaps = sessionLaps
      .filter(
        (l) =>
          l.driverId === stint.driverId &&
          l.lapNumber >= stint.lapStart! &&
          l.lapNumber <= stint.lapEnd! &&
          l.lapDuration != null,
      )
      .sort((a, b) => a.lapNumber - b.lapNumber)
      .map((l) => l.lapDuration!);
    lapsByStint.set(stint.id, stintLaps);
  }

  // driverId+compound -> clean (non-race-sim, non-outlier) lap durations
  const cleanLapsByDriverCompound = new Map<string, number[]>();
  for (const stint of sessionStints) {
    if (!stint.compound || stint.compound === "UNKNOWN" || stint.compound === "TEST_UNKNOWN") continue;
    const stintLaps = lapsByStint.get(stint.id);
    if (!stintLaps || stintLaps.length === 0) continue;

    const withoutSimRuns = excludeRaceSimLaps(stintLaps);
    if (withoutSimRuns.length === 0) continue;

    const key = `${stint.driverId}:${stint.compound}`;
    if (!cleanLapsByDriverCompound.has(key)) cleanLapsByDriverCompound.set(key, []);
    cleanLapsByDriverCompound.get(key)!.push(...withoutSimRuns);
  }

  // best clean lap per driver per compound (one-lap pace, not run-average)
  const bestByCompound = new Map<string, Map<number, number>>(); // compound -> driverId -> best lap
  for (const [key, durations] of cleanLapsByDriverCompound) {
    const [driverIdStr, compound] = key.split(":");
    const driverId = parseInt(driverIdStr, 10);
    const best = Math.min(...durations);
    // drop this driver's outliers relative to their own best on this compound
    const clean = durations.filter((d) => d <= best * OUT_LAP_THRESHOLD);
    if (clean.length === 0) continue;
    if (!bestByCompound.has(compound)) bestByCompound.set(compound, new Map());
    bestByCompound.get(compound)!.set(driverId, Math.min(...clean));
  }

  // driverId -> list of {pace, weight}; weight = number of drivers sharing
  // that compound's field baseline, so a 2-car compound sample barely moves
  // the average while a full-field compound dominates it.
  const compoundRelativePaces = new Map<number, { pace: number; weight: number }[]>();
  for (const [, driverBests] of bestByCompound) {
    if (driverBests.size === 0) continue;
    const fieldMedian = median([...driverBests.values()]);
    const sampleWeight = driverBests.size;
    for (const [driverId, best] of driverBests) {
      if (!compoundRelativePaces.has(driverId)) compoundRelativePaces.set(driverId, []);
      compoundRelativePaces.get(driverId)!.push({ pace: best - fieldMedian, weight: sampleWeight });
    }
  }

  const result = new Map<number, number>();
  for (const [driverId, entries] of compoundRelativePaces) {
    const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
    const weightedPace = entries.reduce((sum, e) => sum + e.pace * e.weight, 0) / totalWeight;
    result.set(driverId, weightedPace);
  }
  return result;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
