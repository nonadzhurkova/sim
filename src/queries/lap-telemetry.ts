/**
 * Fastest-lap telemetry traces, fetched on the fly for a single comparison.
 *
 * Nothing here is stored. Full-rate car telemetry is ~3 MB per driver per
 * session, so it is pulled only for the two laps actually being compared, and
 * only when the analysis page asks for it.
 *
 * OpenF1 does not label sectors as "straight" or "corner" — it only gives
 * three timed sectors with no character. So the character is *derived* from
 * the telemetry itself: full throttle with no brake is a straight, anything
 * with braking or lifted throttle is a corner phase. That is measured rather
 * than assumed, and it is what makes "you lose in the corners, not on the
 * straights" a defensible statement instead of a guess.
 */

import { openF1Fetch } from "@/lib/openf1-client";

export type TelemetryPoint = {
  /** Seconds since the lap started. */
  t: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  /** Derived: what the car is doing here. */
  phase: "straight" | "braking" | "cornering" | "accelerating";
};

export type LapTrace = {
  driverNumber: number;
  acronym: string;
  teamName: string | null;
  lapNumber: number;
  lapDuration: number;
  sectors: [number | null, number | null, number | null];
  points: TelemetryPoint[];
  /** Share of the lap spent at full throttle. */
  fullThrottlePct: number;
  topSpeed: number;
  minSpeed: number;
};

export type PhaseDelta = {
  phase: "straight" | "braking" | "cornering" | "accelerating";
  /** Seconds the target loses (positive) or gains (negative) in this phase. */
  delta: number;
  /** Share of the lap this phase accounts for. */
  lapSharePct: number;
};

export type LapComparison = {
  target: LapTrace;
  rival: LapTrace;
  /** Cumulative time delta sampled through the lap, for the delta chart. */
  deltaTrace: { distancePct: number; delta: number }[];
  /** Where the time actually goes, grouped by what the car is doing. */
  phaseDeltas: PhaseDelta[];
  totalDelta: number;
};

type CarDataPoint = {
  date: string;
  speed: number;
  throttle: number;
  brake: number;
  n_gear: number;
  rpm: number;
};

type OpenF1Lap = {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  date_start: string | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  is_pit_out_lap: boolean;
};

type OpenF1Driver = {
  driver_number: number;
  name_acronym: string;
  team_name: string | null;
};

async function fetchJson<T>(path: string): Promise<T[] | null> {
  const res = await openF1Fetch<T>(path);
  return res.ok ? res.data : null;
}

/** Full throttle and no brake is a straight; everything else is a corner phase. */
function classify(p: CarDataPoint, previousSpeed: number | null): TelemetryPoint["phase"] {
  if (p.brake > 0) return "braking";
  if (p.throttle >= 98) {
    // Full throttle while still slow means accelerating out of a corner, not
    // travelling down a straight — the distinction matters because traction
    // and power are different weaknesses.
    if (previousSpeed != null && p.speed < 200) return "accelerating";
    return "straight";
  }
  return "cornering";
}

async function buildTrace(
  sessionKey: number,
  driver: OpenF1Driver,
  lap: OpenF1Lap,
): Promise<LapTrace | null> {
  if (!lap.date_start || lap.lap_duration == null) return null;

  const start = new Date(lap.date_start);
  const end = new Date(start.getTime() + lap.lap_duration * 1000);
  // OpenF1 uses bare `>` / `<` in query keys for range filters, which is not
  // standard query syntax — hence the hand-built string rather than
  // URLSearchParams, which would escape the operators and break the filter.
  const data = await fetchJson<CarDataPoint>(
    `/car_data?session_key=${sessionKey}` +
      `&driver_number=${driver.driver_number}` +
      `&date%3E${encodeURIComponent(start.toISOString())}` +
      `&date%3C${encodeURIComponent(end.toISOString())}`,
  );
  if (!data || data.length === 0) return null;

  const t0 = new Date(data[0].date).getTime();
  let previousSpeed: number | null = null;
  const points: TelemetryPoint[] = data.map((p) => {
    const point: TelemetryPoint = {
      t: (new Date(p.date).getTime() - t0) / 1000,
      speed: p.speed,
      throttle: p.throttle,
      brake: p.brake,
      gear: p.n_gear,
      rpm: p.rpm,
      phase: classify(p, previousSpeed),
    };
    previousSpeed = p.speed;
    return point;
  });

  const fullThrottle = points.filter((p) => p.throttle >= 98).length;

  return {
    driverNumber: driver.driver_number,
    acronym: driver.name_acronym,
    teamName: driver.team_name,
    lapNumber: lap.lap_number,
    lapDuration: lap.lap_duration,
    sectors: [lap.duration_sector_1, lap.duration_sector_2, lap.duration_sector_3],
    points,
    fullThrottlePct: points.length > 0 ? (fullThrottle / points.length) * 100 : 0,
    topSpeed: Math.max(...points.map((p) => p.speed)),
    minSpeed: Math.min(...points.map((p) => p.speed)),
  };
}

const DELTA_SAMPLES = 100;

/**
 * Compares two laps point by point.
 *
 * The two cars are on track at different moments, so their telemetry can't be
 * lined up by timestamp. Instead each lap is resampled onto the same 0-100%
 * progress axis, which is what a broadcast delta trace does: at the same point
 * around the lap, who is ahead and by how much.
 */
function compareLaps(target: LapTrace, rival: LapTrace): LapComparison {
  const deltaTrace: LapComparison["deltaTrace"] = [];

  // Cumulative distance from speed, so progress is spatial rather than
  // temporal — otherwise the slower car's trace would be stretched.
  const cumulative = (trace: LapTrace) => {
    const out: { dist: number; t: number }[] = [];
    let d = 0;
    for (let i = 0; i < trace.points.length; i++) {
      const p = trace.points[i];
      const dt = i === 0 ? 0 : p.t - trace.points[i - 1].t;
      d += (p.speed / 3.6) * dt;
      out.push({ dist: d, t: p.t });
    }
    return out;
  };

  const tc = cumulative(target);
  const rc = cumulative(rival);
  const tTotal = tc[tc.length - 1]?.dist ?? 0;
  const rTotal = rc[rc.length - 1]?.dist ?? 0;
  if (tTotal === 0 || rTotal === 0) {
    return { target, rival, deltaTrace: [], phaseDeltas: [], totalDelta: target.lapDuration - rival.lapDuration };
  }

  const timeAt = (c: { dist: number; t: number }[], total: number, pct: number): number => {
    const want = total * pct;
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid].dist < want) lo = mid + 1;
      else hi = mid;
    }
    return c[lo]?.t ?? 0;
  };

  for (let i = 0; i <= DELTA_SAMPLES; i++) {
    const pct = i / DELTA_SAMPLES;
    deltaTrace.push({
      distancePct: pct * 100,
      delta: timeAt(tc, tTotal, pct) - timeAt(rc, rTotal, pct),
    });
  }

  // Attribute each slice of the lap to whatever the target car was doing
  // there, so the loss can be reported as "in the corners" or "on the
  // straights" rather than only as a sector number.
  const phaseTotals = new Map<TelemetryPoint["phase"], number>();
  const phaseCounts = new Map<TelemetryPoint["phase"], number>();
  for (let i = 1; i < deltaTrace.length; i++) {
    const sliceDelta = deltaTrace[i].delta - deltaTrace[i - 1].delta;
    const pct = deltaTrace[i].distancePct / 100;
    const idx = Math.min(target.points.length - 1, Math.floor(pct * target.points.length));
    const phase = target.points[idx]?.phase ?? "cornering";
    phaseTotals.set(phase, (phaseTotals.get(phase) ?? 0) + sliceDelta);
    phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
  }

  const phaseDeltas: PhaseDelta[] = (
    ["straight", "braking", "cornering", "accelerating"] as const
  )
    .filter((p) => phaseTotals.has(p))
    .map((p) => ({
      phase: p,
      delta: phaseTotals.get(p) ?? 0,
      lapSharePct: ((phaseCounts.get(p) ?? 0) / DELTA_SAMPLES) * 100,
    }))
    .sort((a, b) => b.delta - a.delta);

  return {
    target,
    rival,
    deltaTrace,
    phaseDeltas,
    totalDelta: target.lapDuration - rival.lapDuration,
  };
}

/**
 * Fetches and compares the fastest lap of two drivers in one session.
 * `sessionKey` is OpenF1's own key, taken from our stored sessions row.
 */
export async function compareFastestLaps(
  sessionKey: number,
  targetDriverNumber: number,
  rivalDriverNumber: number,
): Promise<LapComparison | null> {
  const [drivers, laps] = await Promise.all([
    fetchJson<OpenF1Driver>(`/drivers?session_key=${sessionKey}`),
    fetchJson<OpenF1Lap>(`/laps?session_key=${sessionKey}`),
  ]);
  if (!drivers || !laps) return null;

  const pickBest = (num: number) => {
    const own = laps.filter(
      (l) => l.driver_number === num && l.lap_duration != null && !l.is_pit_out_lap,
    );
    if (own.length === 0) return null;
    return own.reduce((a, b) => ((a.lap_duration as number) < (b.lap_duration as number) ? a : b));
  };

  const targetDriver = drivers.find((d) => d.driver_number === targetDriverNumber);
  const rivalDriver = drivers.find((d) => d.driver_number === rivalDriverNumber);
  const targetLap = pickBest(targetDriverNumber);
  const rivalLap = pickBest(rivalDriverNumber);
  if (!targetDriver || !rivalDriver || !targetLap || !rivalLap) return null;

  // Sequential, not Promise.all: OpenF1 rate-limits concurrent requests, and
  // car_data is the heaviest endpoint it has — firing both at once gets the
  // second one rejected.
  const targetTrace = await buildTrace(sessionKey, targetDriver, targetLap);
  const rivalTrace = await buildTrace(sessionKey, rivalDriver, rivalLap);
  if (!targetTrace || !rivalTrace) return null;

  return compareLaps(targetTrace, rivalTrace);
}
