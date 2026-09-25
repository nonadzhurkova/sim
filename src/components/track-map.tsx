"use client";

import { useState } from "react";

export type TrackPoint = {
  x: number;
  y: number;
  progress: number;
  speed: number;
  delta: number;
  segmentDelta: number;
  phase: "straight" | "braking" | "cornering" | "accelerating";
};

/**
 * Track map drawn from the car's own GPS trace, coloured by where time is
 * won and lost against the rival.
 *
 * This is the clearest answer to "where on the circuit are we losing?" — a
 * sector number is an abstraction, whereas a red patch on the map is the
 * actual corner. The outline is the racing line itself, so it needs no stored
 * circuit geometry: the car draws the track by driving round it.
 */
export function TrackMap({
  points,
  targetLabel,
  rivalLabel,
  mode = "delta",
}: {
  points: TrackPoint[];
  targetLabel: string;
  rivalLabel: string;
  mode?: "delta" | "speed";
}) {
  const [hover, setHover] = useState<TrackPoint | null>(null);
  const [view, setView] = useState<"delta" | "speed">(mode);

  if (points.length < 10) return null;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const PAD = 30;
  const W = 900;
  // Preserve the circuit's real aspect ratio — a squashed Baku is not Baku.
  const H = Math.round(((W - PAD * 2) * spanY) / spanX) + PAD * 2;
  const sx = (x: number) => PAD + ((x - minX) / spanX) * (W - PAD * 2);
  // SVG y grows downward; track coordinates grow upward.
  const sy = (y: number) => H - PAD - ((y - minY) / spanY) * (H - PAD * 2);

  // Colour scale. For delta, the strongest segment loss sets the scale so
  // the worst corner is unmistakable rather than washed out.
  const maxSeg = Math.max(...points.map((p) => Math.abs(p.segmentDelta)), 0.001);
  const speeds = points.map((p) => p.speed);
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);

  const colorFor = (p: TrackPoint): string => {
    if (view === "speed") {
      const f = (p.speed - minSpeed) / Math.max(1, maxSpeed - minSpeed);
      // slow = deep blue, fast = cyan/white
      const r = Math.round(30 + f * 120);
      const g = Math.round(80 + f * 160);
      const b = Math.round(160 + f * 95);
      return `rgb(${r},${g},${b})`;
    }
    const f = Math.min(1, Math.abs(p.segmentDelta) / maxSeg);
    if (p.segmentDelta > 0) {
      // losing time: red, intensity by magnitude
      return `rgb(${Math.round(120 + f * 135)},${Math.round(60 - f * 40)},${Math.round(60 - f * 40)})`;
    }
    return `rgb(${Math.round(40 - f * 20)},${Math.round(120 + f * 100)},${Math.round(70 - f * 20)})`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="hud-mono text-[10px] uppercase tracking-widest text-slate-500">
          Track map · {view === "delta" ? "where time is won and lost" : "speed"}
        </p>
        <div className="flex gap-2">
          {(["delta", "speed"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setView(m)}
              className={`hud-mono border px-2 py-0.5 text-[9px] uppercase tracking-wider transition-colors ${
                view === m
                  ? "border-cyan-500 bg-cyan-950/60 text-cyan-300"
                  : "border-slate-800 text-slate-500 hover:border-slate-700"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
        {/* faint full outline underneath, so the shape reads even where the
            colour is pale */}
        <polyline
          points={points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
          fill="none"
          stroke="#1e293b"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* coloured segments */}
        {points.slice(1).map((p, i) => {
          const prev = points[i];
          return (
            <line
              key={i}
              x1={sx(prev.x)}
              y1={sy(prev.y)}
              x2={sx(p.x)}
              y2={sy(p.y)}
              stroke={colorFor(p)}
              strokeWidth="9"
              strokeLinecap="round"
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "crosshair" }}
            />
          );
        })}
        {/* start/finish marker */}
        <circle cx={sx(points[0].x)} cy={sy(points[0].y)} r="7" fill="#e2e8f0" />
        <text
          x={sx(points[0].x) + 12}
          y={sy(points[0].y) + 4}
          fill="#94a3b8"
          className="hud-mono"
          fontSize="12"
        >
          S/F
        </text>
        {hover && (
          <circle cx={sx(hover.x)} cy={sy(hover.y)} r="9" fill="none" stroke="#22d3ee" strokeWidth="2" />
        )}
      </svg>

      <div className="hud-mono flex flex-wrap items-center justify-between gap-3 text-[10px]">
        {view === "delta" ? (
          <span className="text-slate-600">
            <span className="text-red-400">■ {targetLabel} losing</span>
            {"   "}
            <span className="text-green-400">■ gaining on {rivalLabel}</span>
          </span>
        ) : (
          <span className="text-slate-600">
            ■ {minSpeed} km/h → ■ {maxSpeed} km/h
          </span>
        )}
        {hover && (
          <span className="text-cyan-300">
            {(hover.progress * 100).toFixed(0)}% · {hover.speed} km/h ·{" "}
            {hover.delta >= 0 ? "+" : ""}
            {hover.delta.toFixed(3)}s · {hover.phase}
          </span>
        )}
      </div>
    </div>
  );
}
