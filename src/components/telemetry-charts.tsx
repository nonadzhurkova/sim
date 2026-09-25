"use client";

import { getTeamColor } from "@/lib/team-colors";

/**
 * Charts for the team telemetry analysis, drawn as inline SVG.
 *
 * No chart library: these are all simple polylines and bars over a fixed
 * viewBox, and hand-drawing them keeps the HUD styling consistent with the
 * rest of the app rather than fighting a library's defaults.
 */

export type PhaseDelta = {
  phase: "straight" | "braking" | "cornering" | "accelerating";
  delta: number;
  lapSharePct: number;
};

const PHASE_LABELS: Record<PhaseDelta["phase"], string> = {
  straight: "Straights",
  braking: "Braking zones",
  cornering: "Mid-corner",
  accelerating: "Corner exit",
};

/** What each phase implies about the car, shown so a number has a meaning. */
const PHASE_MEANING: Record<PhaseDelta["phase"], string> = {
  straight: "engine power & drag",
  braking: "brake stability & confidence",
  cornering: "downforce & balance",
  accelerating: "traction & power delivery",
};

/**
 * Gain/loss per driving phase — the headline chart.
 *
 * Bars run both ways from a centre line so a gain reads as obviously
 * different from a loss, rather than both being "a bar of some length".
 */
export function PhaseDeltaChart({
  phases,
  targetLabel,
  rivalLabel,
}: {
  phases: PhaseDelta[];
  targetLabel: string;
  rivalLabel: string;
}) {
  if (phases.length === 0) {
    return <p className="hud-mono text-xs text-slate-500">NO PHASE DATA</p>;
  }
  const maxAbs = Math.max(...phases.map((p) => Math.abs(p.delta)), 0.1);

  return (
    <div>
      <p className="hud-mono mb-3 text-[10px] uppercase tracking-widest text-slate-500">
        <span className="text-red-400">▶ right = {targetLabel} loses</span>
        {"  ·  "}
        <span className="text-green-400">◀ left = {targetLabel} gains on {rivalLabel}</span>
      </p>
      <div className="flex flex-col gap-2.5">
        {phases.map((p) => {
          const pct = (Math.abs(p.delta) / maxAbs) * 50;
          const isLoss = p.delta > 0;
          return (
            <div key={p.phase} className="flex items-center gap-3">
              <div className="w-28 shrink-0">
                <div className="text-xs font-semibold text-slate-200">
                  {PHASE_LABELS[p.phase]}
                </div>
                <div className="hud-mono text-[9px] uppercase tracking-wider text-slate-600">
                  {p.lapSharePct.toFixed(0)}% of lap
                </div>
              </div>
              <div className="relative h-7 flex-1 bg-slate-900/60">
                {/* centre line */}
                <div className="absolute left-1/2 top-0 h-full w-px bg-slate-700" />
                <div
                  className="hud-bar-fill absolute top-1 h-5"
                  style={{
                    left: isLoss ? "50%" : `${50 - pct}%`,
                    width: `${pct}%`,
                    backgroundColor: isLoss ? "#ef4444" : "#22c55e",
                    opacity: 0.85,
                  }}
                />
              </div>
              <div
                className={`hud-mono w-16 shrink-0 text-right text-xs font-semibold ${
                  isLoss ? "text-red-400" : "text-green-400"
                }`}
              >
                {isLoss ? "+" : ""}
                {p.delta.toFixed(3)}s
              </div>
              <div className="hidden w-36 shrink-0 text-[10px] text-slate-600 lg:block">
                {PHASE_MEANING[p.phase]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Cumulative time delta around the lap — the broadcast-style trace.
 * Above the zero line means the target car is behind at that point.
 */
export function DeltaTraceChart({
  trace,
  targetLabel,
  rivalLabel,
}: {
  trace: { distancePct: number; delta: number }[];
  targetLabel: string;
  rivalLabel: string;
}) {
  if (trace.length < 2) return null;

  const W = 800;
  const H = 180;
  const PAD = 4;
  const maxAbs = Math.max(...trace.map((t) => Math.abs(t.delta)), 0.2);
  const x = (pct: number) => (pct / 100) * W;
  const y = (d: number) => H / 2 - (d / maxAbs) * (H / 2 - PAD);

  const line = trace.map((t) => `${x(t.distancePct).toFixed(1)},${y(t.delta).toFixed(1)}`).join(" ");
  // Filled area between the trace and the zero line, so the sign is readable
  // at a glance rather than having to follow the line against the axis.
  const area = `${x(0)},${y(0)} ${line} ${x(100)},${y(0)}`;

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="hud-mono text-[10px] uppercase tracking-widest text-slate-500">
          Cumulative delta around the lap
        </p>
        <p className="hud-mono text-[10px] text-slate-600">
          <span className="text-red-400">above = {targetLabel} behind</span> ·{" "}
          <span className="text-green-400">below = ahead of {rivalLabel}</span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" preserveAspectRatio="none" height={H}>
        <defs>
          <linearGradient id="deltaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.35" />
            <stop offset="50%" stopColor="#ef4444" stopOpacity="0.05" />
            <stop offset="50%" stopColor="#22c55e" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {/* quarter gridlines */}
        {[0, 25, 50, 75, 100].map((p) => (
          <line
            key={p}
            x1={x(p)}
            y1={0}
            x2={x(p)}
            y2={H}
            stroke="#1e293b"
            strokeWidth="1"
          />
        ))}
        <polygon points={area} fill="url(#deltaFill)" />
        <line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="#475569" strokeWidth="1" />
        <polyline points={line} fill="none" stroke="#22d3ee" strokeWidth="2" />
      </svg>
      <div className="hud-mono flex justify-between text-[9px] text-slate-600">
        <span>LAP START</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>FINISH</span>
      </div>
    </div>
  );
}

/** Speed traces for both cars, overlaid. */
export function SpeedTraceChart({
  target,
  rival,
}: {
  target: { acronym: string; teamName: string | null; points: { speed: number }[] };
  rival: { acronym: string; teamName: string | null; points: { speed: number }[] };
}) {
  const W = 800;
  const H = 200;
  const all = [...target.points, ...rival.points].map((p) => p.speed);
  if (all.length === 0) return null;
  const maxSpeed = Math.max(...all);
  const minSpeed = Math.min(...all);
  const range = Math.max(1, maxSpeed - minSpeed);

  const toLine = (points: { speed: number }[]) =>
    points
      .map((p, i) => {
        const px = (i / Math.max(1, points.length - 1)) * W;
        const py = H - ((p.speed - minSpeed) / range) * (H - 8) - 4;
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" ");

  const targetColor = getTeamColor(target.teamName);
  const rivalColor = getTeamColor(rival.teamName);

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="hud-mono text-[10px] uppercase tracking-widest text-slate-500">
          Speed trace
        </p>
        <div className="hud-mono flex gap-3 text-[10px]">
          <span style={{ color: targetColor }}>━ {target.acronym}</span>
          <span style={{ color: rivalColor }}>━ {rival.acronym}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" preserveAspectRatio="none" height={H}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} y1={H * f} x2={W} y2={H * f} stroke="#1e293b" strokeWidth="1" />
        ))}
        <polyline points={toLine(rival.points)} fill="none" stroke={rivalColor} strokeWidth="1.5" opacity="0.75" />
        <polyline points={toLine(target.points)} fill="none" stroke={targetColor} strokeWidth="2" />
      </svg>
      <div className="hud-mono flex justify-between text-[9px] text-slate-600">
        <span>{minSpeed} km/h</span>
        <span>peak {maxSpeed} km/h</span>
      </div>
    </div>
  );
}

/** Sector-by-sector gain/loss bars. */
export function SectorBars({
  sectors,
}: {
  sectors: { sector: number; delta: number; targetTime: number; rivalTime: number }[];
}) {
  if (sectors.length === 0) return null;
  const maxAbs = Math.max(...sectors.map((s) => Math.abs(s.delta)), 0.05);

  return (
    <div className="grid grid-cols-3 gap-3">
      {sectors.map((s) => {
        const isLoss = s.delta > 0;
        const height = (Math.abs(s.delta) / maxAbs) * 100;
        return (
          <div key={s.sector} className="text-center">
            <div className="hud-mono text-[10px] uppercase tracking-widest text-slate-500">
              Sector {s.sector}
            </div>
            <div className="relative mt-2 flex h-20 items-center justify-center bg-slate-900/50">
              <div
                className="hud-bar-fill w-10"
                style={{
                  height: `${Math.max(height, 4)}%`,
                  backgroundColor: isLoss ? "#ef4444" : "#22c55e",
                  opacity: 0.85,
                }}
              />
            </div>
            <div
              className={`hud-mono mt-1 text-xs font-semibold ${isLoss ? "text-red-400" : "text-green-400"}`}
            >
              {isLoss ? "+" : ""}
              {s.delta.toFixed(3)}s
            </div>
            <div className="hud-mono text-[9px] text-slate-600">
              {s.targetTime.toFixed(3)} v {s.rivalTime.toFixed(3)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type TracePoint = { speed: number; throttle: number; brake: number; gear: number };

/**
 * Stacked throttle / brake / gear traces for both cars.
 *
 * Speed alone says where a car is slower; these say *why*. An earlier brake
 * application or a later throttle pickup is visible here and nowhere else,
 * and it distinguishes a driver-confidence problem from a car problem.
 */
export function InputTraces({
  target,
  rival,
}: {
  target: { acronym: string; teamName: string | null; points: TracePoint[] };
  rival: { acronym: string; teamName: string | null; points: TracePoint[] };
}) {
  const W = 800;
  const targetColor = getTeamColor(target.teamName);
  const rivalColor = getTeamColor(rival.teamName);

  const line = (points: TracePoint[], pick: (p: TracePoint) => number, max: number, h: number) =>
    points
      .map((p, i) => {
        const x = (i / Math.max(1, points.length - 1)) * W;
        const y = h - (pick(p) / max) * (h - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const rows: { label: string; pick: (p: TracePoint) => number; max: number; h: number }[] = [
    { label: "Throttle %", pick: (p) => p.throttle, max: 100, h: 70 },
    { label: "Brake", pick: (p) => (p.brake > 0 ? 100 : 0), max: 100, h: 44 },
    { label: "Gear", pick: (p) => p.gear, max: 8, h: 56 },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="hud-mono text-[10px] uppercase tracking-widest text-slate-500">
          Driver inputs
        </p>
        <div className="hud-mono flex gap-3 text-[10px]">
          <span style={{ color: targetColor }}>━ {target.acronym}</span>
          <span style={{ color: rivalColor }}>━ {rival.acronym}</span>
        </div>
      </div>
      {rows.map((row) => (
        <div key={row.label}>
          <div className="hud-mono text-[9px] uppercase tracking-wider text-slate-600">
            {row.label}
          </div>
          <svg
            viewBox={`0 0 ${W} ${row.h}`}
            className="w-full"
            preserveAspectRatio="none"
            height={row.h}
          >
            <rect x="0" y="0" width={W} height={row.h} fill="#0b1015" />
            <polyline
              points={line(rival.points, row.pick, row.max, row.h)}
              fill="none"
              stroke={rivalColor}
              strokeWidth="1.5"
              opacity="0.7"
            />
            <polyline
              points={line(target.points, row.pick, row.max, row.h)}
              fill="none"
              stroke={targetColor}
              strokeWidth="2"
            />
          </svg>
        </div>
      ))}
    </div>
  );
}
