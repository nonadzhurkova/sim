"use client";

import { useState } from "react";
import { getTeamColor } from "@/lib/team-colors";
import { HudPanel } from "./hud-panel";

type PracticePaceRow = {
  driverId: number;
  driverName: string;
  teamName: string | null;
  relativePace: number;
  rank: number;
};

export function PracticePacePanel({ raceId }: { raceId: number }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [rows, setRows] = useState<PracticePaceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/practice-pace?raceId=${raceId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }
      const data: { drivers: PracticePaceRow[] } = await res.json();
      setRows(data.drivers);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calculation failed");
      setState("error");
    }
  }

  // Bar length represents the gap to the fastest driver (rows are already
  // sorted fastest-first, so relativePace - fastest >= 0 for everyone).
  // Capped at the 90th-percentile gap so one outlier lap (e.g. a driver
  // with only a couple of laps in) doesn't crush the rest of the field's
  // bars down to invisible slivers; the true value still shows in the label.
  const fastest = rows[0]?.relativePace ?? 0;
  const gaps = rows.map((r) => r.relativePace - fastest).sort((a, b) => a - b);
  const p90Gap = gaps[Math.floor(gaps.length * 0.9)] ?? gaps[gaps.length - 1] ?? 1;
  const scaleMax = Math.max(0.5, p90Gap);

  return (
    <HudPanel title="Projected Race Pace (from practice so far)">
      <button
        onClick={handleClick}
        disabled={state === "loading"}
        className="hud-mono border border-cyan-500 bg-cyan-950/40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-cyan-300 shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] transition-colors hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "loading" ? "Calculating..." : "Calculate Race Pace"}
      </button>

      {state === "error" && <p className="hud-mono mt-2 text-[11px] text-red-400">{error}</p>}

      {state === "done" && rows.length === 0 && (
        <p className="hud-mono mt-2 text-xs text-slate-500">
          NO DRY PRACTICE LAPS AVAILABLE YET FOR THIS WEEKEND.
        </p>
      )}

      {state === "done" && rows.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5">
          {rows.map((r) => {
            const color = getTeamColor(r.teamName);
            const gap = r.relativePace - fastest;
            const widthPct = Math.max(3, Math.min(100, (gap / scaleMax) * 100));
            const isFastest = r.rank === 1;
            return (
              <div key={r.driverId} className="flex items-center gap-3">
                <div className="hud-mono w-6 shrink-0 text-right text-xs text-slate-500">{r.rank}</div>
                <div className="w-28 shrink-0 truncate text-sm text-slate-200">{r.driverName}</div>
                <div className="relative h-5 flex-1 overflow-hidden bg-slate-900/60">
                  <div
                    className="hud-bar-fill h-full opacity-90"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: color,
                      boxShadow: isFastest ? `0 0 10px 1px ${color}` : undefined,
                      animationDelay: `${r.rank * 40}ms`,
                    }}
                  />
                </div>
                <div
                  className={`hud-mono w-16 shrink-0 text-right text-xs ${isFastest ? "text-cyan-300" : "text-slate-400"}`}
                >
                  {isFastest ? "LEAD" : `+${gap.toFixed(3)}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </HudPanel>
  );
}
