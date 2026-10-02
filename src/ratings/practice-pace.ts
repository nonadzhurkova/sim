import { db } from "@/db";
import { sessions, laps, stints } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const FP_BASE_WEIGHTS: Record<"fp1" | "fp2" | "fp3", number> = {
  fp1: 0.15,
  fp2: 0.35,
  fp3: 0.5,
};

const OUT_LAP_THRESHOLD = 1.07; // F1's 107% rule, applied per-driver-per-session-per-compound
/**
 * Second 107%-style gate, applied against the *field's* median on a compound
 * rather than the driver's own best. OUT_LAP_THRESHOLD alone can't catch a
 * driver whose every lap on a compound was slow — an aborted run, or a
 * garage-to-garage in/out pair the pit flag missed — because such a driver's
 * "best" is itself the outlier, so everything sits within 107% of it. Those
 * laps then get differenced against the field median and produce absurd
 * gaps (observed in real ingested data: up to +182s). A driver more than
 * this far off the field's median on a compound is not showing pace, so the
 * compound is dropped for them rather than allowed to poison the average.
 */
const FIELD_OUTLIER_THRESHOLD = 1.07;
/**
 * Lower bound of the same gate. A lap materially *faster* than the whole
 * field's median is not a great lap, it's a bad timing record — an aborted
 * or partial lap where the timing loop caught only part of the circuit
 * (observed in real ingested data: a 60.4s "lap" at a ~90s circuit, which
 * became that driver's best and produced a -14.9s field-relative pace).
 * No car is 10% faster than the field median over a single lap.
 */
const FIELD_TOO_FAST_THRESHOLD = 0.9;
/**
 * Long-run ("race simulation") detection thresholds.
 *
 * These are strict on purpose, and were confirmed empirically: loosening
 * them (run=3, tolerance=2%, slowdown=2%) detects long runs in far more
 * stints, but made predictions much *worse* — backtest top-1 accuracy fell
 * from 64% to 21% and log loss rose from 1.44 to 4.50 across the 2026
 * season. The reason is that these thresholds gate what counts as a lap to
 * *discard* from qualifying pace: loosening them starts swallowing genuine
 * push laps, so a driver's "best clean lap" becomes some slower leftover and
 * the whole qualifying-pace signal degrades. Detecting fewer long runs is
 * the safer failure mode, so a tight tolerance stays.
 */
const RACE_SIM_RUN_LENGTH = 4; // consecutive similar-pace laps treated as a long run, not one-lap pace
const RACE_SIM_TOLERANCE = 0.015; // 1.5% lap-to-lap variance counts as "similar pace"
const RACE_SIM_MIN_SLOWDOWN = 1.03; // a cluster must be >=3% slower than the driver's best lap to count as a "run"
/**
 * Long-run detection for race-pace projection only (computeRacePaceProjection /
 * computeSessionRaceSimRelativePace) -- separate from RACE_SIM_* above, which
 * stay untouched because they gate what counts as a lap to *discard* from the
 * already-validated qualifying-pace signal.
 *
 * RACE_SIM_TOLERANCE/MIN_SLOWDOWN anchor to the laps *within the stint being
 * tested*: a flat, low-degradation long run never drifts 3% from its own
 * stint-best, so it was never detected as a "run" at all, and a genuinely
 * degrading run only has its slowest tail caught by the 1.5% window. Checked
 * against real FP1-3 data from 8 recent races (2026 rounds 6-15): the
 * current detector fired on 1.9% of stints with >=4 laps; top-3 finishers at
 * the most recent race had zero long runs found anywhere across FP1-3.
 *
 * This detector anchors to the driver's best lap across their *whole
 * session* (all stints/compounds) instead -- a genuine long run sits a few
 * seconds off a driver's one-lap pace, not off its own stint's internal
 * best, and that gap varies a lot by circuit (seen live: 1:37 vs 1:44.7, a
 * 7.7s gap, on top of the dataset above). RACE_SIM_LONG_RUN_MIN_GAP is
 * therefore a floor, not a band -- no upper cap, since a fixed ceiling would
 * just reintroduce the same circuit-blindness. Internal spread is capped
 * instead, so a handful of randomly slow traffic laps don't get swept in
 * with a real run: real degradation is a smooth drift, not noise.
 *
 * Recovered long runs in 27.4% of the same 8-race stint sample (vs 1.9%),
 * and the recovered examples passed an eyeball check against raw lap times.
 * Backtested via weightOverrides on racePaceProjection (see PACE_WEIGHTS):
 * now that this signal actually fires, 2024/2025 log loss get monotonically
 * worse as its weight rises while 2026 gets monotonically better -- the same
 * opposite-direction-curves shape as the rejected Bayesian ensemble blend.
 * Weight intentionally left at its prior value pending further investigation
 * rather than resolved by this change; the detector fix stands on its own
 * (correct long-run detection, better getDriverStintBreakdown data) even
 * though the weight question is still open.
 */
const RACE_SIM_LONG_RUN_MIN_GAP = 1.5; // seconds a lap must be off the driver's session-best to count toward a long run
const RACE_SIM_LONG_RUN_MAX_SPREAD = 3.5; // seconds; max-min within a candidate window, so traffic/noise isn't mistaken for a smooth degradation run

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
 * Within one driver's stint (laps in lap order), detects laps belonging to
 * a "race simulation" run: a window of RACE_SIM_RUN_LENGTH+ consecutive
 * laps where most laps cluster within RACE_SIM_TOLERANCE of the window's
 * median. Using "most laps in a window" rather than an unbroken chain means
 * a single anomalous lap — traffic, a yellow flag — doesn't prevent
 * detecting the long run it sits inside.
 *
 * Critically, a cluster only counts as a race-sim run if it's at least
 * RACE_SIM_MIN_SLOWDOWN slower than the driver's best lap across all their
 * laps passed in: a tight cluster of *fast* laps (a driver finding a good
 * rhythm on a push run) looks identical to a slow fuel-heavy run under pure
 * variance-clustering, and would otherwise get wrongly discarded as noise —
 * leaving only slower, unrepresentative laps as the driver's "clean" pace.
 */
function findRaceSimLapFlags(sortedLapDurations: number[]): boolean[] {
  const n = sortedLapDurations.length;
  const isSimLap = new Array(n).fill(false);
  const overallBest = Math.min(...sortedLapDurations);

  for (let start = 0; start <= n - RACE_SIM_RUN_LENGTH; start++) {
    for (let end = start + RACE_SIM_RUN_LENGTH; end <= n; end++) {
      const window = sortedLapDurations.slice(start, end);
      const windowMedian = median(window);
      if (windowMedian < overallBest * RACE_SIM_MIN_SLOWDOWN) continue; // too fast to be a "long run"
      const inTolerance = window.filter(
        (lap) => Math.abs(lap - windowMedian) / windowMedian <= RACE_SIM_TOLERANCE,
      ).length;
      // require all but at most one lap in the window to cluster tightly
      if (inTolerance >= window.length - 1) {
        for (let j = start; j < end; j++) isSimLap[j] = true;
      }
    }
  }
  return isSimLap;
}

function excludeRaceSimLaps(sortedLapDurations: number[]): number[] {
  const isSimLap = findRaceSimLapFlags(sortedLapDurations);
  return sortedLapDurations.filter((_, i) => !isSimLap[i]);
}

/** The race-sim (long-run) laps only — the inverse of excludeRaceSimLaps. */
function extractRaceSimLaps(sortedLapDurations: number[]): number[] {
  const isSimLap = findRaceSimLapFlags(sortedLapDurations);
  return sortedLapDurations.filter((_, i) => isSimLap[i]);
}

/**
 * Long-run laps within one stint (laps in lap order), using sessionBest —
 * the driver's fastest lap across their whole session, not just this stint
 * — as the anchor. See RACE_SIM_LONG_RUN_MIN_GAP for why: unlike
 * findRaceSimLapFlags, which compares a window to its own stint's best, a
 * flat/low-degradation long run usually never drifts far from its own
 * stint-best, so that comparison misses it. Comparing to the session-best
 * (typically a push lap on a different, fresher-tyre stint) instead reflects
 * how a long run is actually recognized: a sustained run meaningfully slower
 * than the driver's one-lap pace that weekend.
 */
function findLongRunLapFlags(stintLapDurationsInOrder: number[], sessionBest: number): boolean[] {
  const n = stintLapDurationsInOrder.length;
  const isLongRunLap = new Array(n).fill(false);

  for (let start = 0; start <= n - RACE_SIM_RUN_LENGTH; start++) {
    for (let end = start + RACE_SIM_RUN_LENGTH; end <= n; end++) {
      const window = stintLapDurationsInOrder.slice(start, end);
      const inBand = window.filter((lap) => lap - sessionBest >= RACE_SIM_LONG_RUN_MIN_GAP).length;
      const spread = Math.max(...window) - Math.min(...window);
      // require all but at most one lap off the pace, and a tight enough
      // spread that this reads as sustained degradation rather than a mix
      // of push laps and traffic-slowed laps landing in the same window
      if (inBand >= window.length - 1 && spread <= RACE_SIM_LONG_RUN_MAX_SPREAD) {
        for (let j = start; j < end; j++) isLongRunLap[j] = true;
      }
    }
  }
  return isLongRunLap;
}

/**
 * Field-relative pace for one session, normalized by tyre compound: each
 * driver's best clean lap on a compound vs. the field's median best on that
 * same compound, weighted by sample size, averaged across compounds used.
 * Not FP-specific despite living alongside computePracticePace — reused
 * as-is for sprint qualifying (quali-form.ts), which has no stored
 * position/gap-to-pole table like main qualifying does, only raw laps.
 */
export async function computeSessionCompoundRelativePace(sessionId: number): Promise<Map<number, number>> {
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
    // See FIELD_OUTLIER_THRESHOLD: drop drivers whose best on this compound
    // is nowhere near the field's, rather than recording a nonsense gap.
    const credible = [...driverBests].filter(
      ([, best]) =>
        best <= fieldMedian * FIELD_OUTLIER_THRESHOLD &&
        best >= fieldMedian * FIELD_TOO_FAST_THRESHOLD,
    );
    if (credible.length === 0) continue;
    const sampleWeight = credible.length;
    for (const [driverId, best] of credible) {
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

/**
 * Field-relative projected race pace per driver for one race weekend, using
 * the long-run "race simulation" laps that computePracticePace deliberately
 * discards (see excludeRaceSimLaps). For each dry FP session, per compound:
 * each driver's average lap time across their race-sim run(s) is compared
 * to the field's average on that same compound, weighted by sample size —
 * same method as qualifying pace, but using run averages instead of best
 * laps, since race pace is about sustained pace, not one-lap performance.
 * Does not yet model degradation-within-a-run (see project notes).
 */
export type RacePaceProjection = {
  pace: number;
  /** Largest compound-field sample size backing this driver's number, across sessions. Low (e.g. 1) means the driver was the sole car on that compound — the "gap" is not meaningful. */
  sampleSize: number;
};

export async function computeRacePaceProjection(raceId: number): Promise<Map<number, RacePaceProjection>> {
  const fpSessions = await db
    .select({ id: sessions.id, sessionType: sessions.sessionType, weather: sessions.weather })
    .from(sessions)
    .where(and(eq(sessions.raceId, raceId), inArray(sessions.sessionType, ["fp1", "fp2", "fp3"])));

  const dryFpSessions = fpSessions.filter((s) => s.weather !== "wet") as {
    id: number;
    sessionType: "fp1" | "fp2" | "fp3";
  }[];
  if (dryFpSessions.length === 0) return new Map();

  const sessionPaceByType = new Map<"fp1" | "fp2" | "fp3", Map<number, { pace: number; sampleSize: number }>>();
  for (const session of dryFpSessions) {
    const pace = await computeSessionRaceSimRelativePace(session.id);
    sessionPaceByType.set(session.sessionType, pace);
  }

  const availableTypes = [...sessionPaceByType.keys()];
  const totalWeight = availableTypes.reduce((sum, t) => sum + FP_BASE_WEIGHTS[t], 0);

  const allDriverIds = new Set<number>();
  for (const paceMap of sessionPaceByType.values()) {
    for (const driverId of paceMap.keys()) allDriverIds.add(driverId);
  }

  const result = new Map<number, RacePaceProjection>();
  for (const driverId of allDriverIds) {
    let weightedSum = 0;
    let weightUsed = 0;
    let maxSampleSize = 0;
    for (const type of availableTypes) {
      const entry = sessionPaceByType.get(type)?.get(driverId);
      if (entry == null) continue;
      const w = FP_BASE_WEIGHTS[type] / totalWeight;
      weightedSum += entry.pace * w;
      weightUsed += w;
      maxSampleSize = Math.max(maxSampleSize, entry.sampleSize);
    }
    if (weightUsed > 0) {
      result.set(driverId, { pace: weightedSum / weightUsed, sampleSize: maxSampleSize });
    }
  }
  return result;
}

async function computeSessionRaceSimRelativePace(
  sessionId: number,
): Promise<Map<number, { pace: number; sampleSize: number }>> {
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

  const lapsByStint = new Map<number, number[]>();
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

  // driver's fastest lap across the whole session (any stint/compound) --
  // the anchor findLongRunLapFlags compares against. See
  // RACE_SIM_LONG_RUN_MIN_GAP for why this has to be session-wide rather
  // than per-stint.
  const sessionBestByDriver = new Map<number, number>();
  for (const lap of sessionLaps) {
    if (lap.lapDuration == null) continue;
    const current = sessionBestByDriver.get(lap.driverId);
    if (current == null || lap.lapDuration < current) {
      sessionBestByDriver.set(lap.driverId, lap.lapDuration);
    }
  }

  // driverId+compound -> race-sim (long-run) lap durations only
  const simLapsByDriverCompound = new Map<string, number[]>();
  for (const stint of sessionStints) {
    if (!stint.compound || stint.compound === "UNKNOWN" || stint.compound === "TEST_UNKNOWN") continue;
    const stintLaps = lapsByStint.get(stint.id);
    if (!stintLaps || stintLaps.length === 0) continue;
    const sessionBest = sessionBestByDriver.get(stint.driverId);
    if (sessionBest == null) continue;

    const flags = findLongRunLapFlags(stintLaps, sessionBest);
    const simRuns = stintLaps.filter((_, i) => flags[i]);
    if (simRuns.length === 0) continue;

    const key = `${stint.driverId}:${stint.compound}`;
    if (!simLapsByDriverCompound.has(key)) simLapsByDriverCompound.set(key, []);
    simLapsByDriverCompound.get(key)!.push(...simRuns);
  }

  // average race-sim pace per driver per compound
  const avgByCompound = new Map<string, Map<number, number>>();
  for (const [key, durations] of simLapsByDriverCompound) {
    const [driverIdStr, compound] = key.split(":");
    const driverId = parseInt(driverIdStr, 10);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    if (!avgByCompound.has(compound)) avgByCompound.set(compound, new Map());
    avgByCompound.get(compound)!.set(driverId, avg);
  }

  const compoundRelativePaces = new Map<number, { pace: number; weight: number }[]>();
  for (const [, driverAvgs] of avgByCompound) {
    if (driverAvgs.size === 0) continue;
    const fieldMedian = median([...driverAvgs.values()]);
    // Same field-relative sanity gate as the qualifying-pace path.
    const credible = [...driverAvgs].filter(
      ([, avg]) =>
        avg <= fieldMedian * FIELD_OUTLIER_THRESHOLD &&
        avg >= fieldMedian * FIELD_TOO_FAST_THRESHOLD,
    );
    if (credible.length === 0) continue;
    const sampleWeight = credible.length;
    for (const [driverId, avg] of credible) {
      if (!compoundRelativePaces.has(driverId)) compoundRelativePaces.set(driverId, []);
      compoundRelativePaces.get(driverId)!.push({ pace: avg - fieldMedian, weight: sampleWeight });
    }
  }

  const result = new Map<number, { pace: number; sampleSize: number }>();
  for (const [driverId, entries] of compoundRelativePaces) {
    const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
    const weightedPace = entries.reduce((sum, e) => sum + e.pace * e.weight, 0) / totalWeight;
    const maxSampleSize = Math.max(...entries.map((e) => e.weight));
    result.set(driverId, { pace: weightedPace, sampleSize: maxSampleSize });
  }
  return result;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export type StintPaceBreakdown = {
  sessionType: "fp1" | "fp2" | "fp3";
  stintNumber: number;
  compound: string;
  lapCount: number;
  avgLapTime: number;
  bestLapTime: number;
};

/**
 * Per-stint pace detail for one driver across this weekend's dry FP
 * sessions: compound, lap count, and average/best clean lap time (same
 * race-sim exclusion and outlier filtering as computePracticePace, but
 * returned per-stint rather than collapsed into one relative-pace number).
 * Used to show the "why" behind a driver's projected race pace.
 */
export async function getDriverStintBreakdown(
  raceId: number,
  driverId: number,
): Promise<StintPaceBreakdown[]> {
  const fpSessions = await db
    .select({ id: sessions.id, sessionType: sessions.sessionType, weather: sessions.weather })
    .from(sessions)
    .where(and(eq(sessions.raceId, raceId), inArray(sessions.sessionType, ["fp1", "fp2", "fp3"])));
  const dryFpSessions = fpSessions.filter((s) => s.weather !== "wet") as {
    id: number;
    sessionType: "fp1" | "fp2" | "fp3";
  }[];

  const breakdown: StintPaceBreakdown[] = [];
  for (const session of dryFpSessions) {
    const driverStints = await db
      .select({
        stintNumber: stints.stintNumber,
        compound: stints.compound,
        lapStart: stints.lapStart,
        lapEnd: stints.lapEnd,
      })
      .from(stints)
      .where(and(eq(stints.sessionId, session.id), eq(stints.driverId, driverId)));

    for (const stint of driverStints) {
      if (!stint.compound || stint.compound === "UNKNOWN" || stint.compound === "TEST_UNKNOWN") continue;
      if (stint.lapStart == null || stint.lapEnd == null) continue;

      const stintLaps = await db
        .select({ lapNumber: laps.lapNumber, lapDuration: laps.lapDuration })
        .from(laps)
        .where(
          and(
            eq(laps.sessionId, session.id),
            eq(laps.driverId, driverId),
            eq(laps.isPitInOut, false),
          ),
        );
      const durations = stintLaps
        .filter((l) => l.lapNumber >= stint.lapStart! && l.lapNumber <= stint.lapEnd! && l.lapDuration != null)
        .sort((a, b) => a.lapNumber - b.lapNumber)
        .map((l) => l.lapDuration!);

      const clean = excludeRaceSimLaps(durations);
      if (clean.length === 0) continue;

      const best = Math.min(...clean);
      const filtered = clean.filter((d) => d <= best * OUT_LAP_THRESHOLD);
      if (filtered.length === 0) continue;

      breakdown.push({
        sessionType: session.sessionType,
        stintNumber: stint.stintNumber,
        compound: stint.compound,
        lapCount: filtered.length,
        avgLapTime: filtered.reduce((a, b) => a + b, 0) / filtered.length,
        bestLapTime: Math.min(...filtered),
      });
    }
  }
  return breakdown;
}
