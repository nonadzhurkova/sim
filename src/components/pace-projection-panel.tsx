"use client";

import { useState, useEffect } from "react";
import { getTeamColor } from "@/lib/team-colors";
import { HudPanel } from "./hud-panel";

type PaceRow = {
  driverId: number;
  driverName: string;
  teamName: string | null;
  relativePace: number;
  rank: number;
};

type StintBreakdown = {
  sessionType: "fp1" | "fp2" | "fp3";
  stintNumber: number;
  compound: string;
  lapCount: number;
  avgLapTime: number;
  bestLapTime: number;
};

const SESSION_LABELS: Record<string, string> = { fp1: "FP1", fp2: "FP2", fp3: "FP3" };

function formatLapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${rest}`;
}

function StintDetail({ raceId, driverId }: { raceId: number; driverId: number }) {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [stints, setStints] = useState<StintBreakdown[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stint-breakdown?raceId=${raceId}&driverId=${driverId}`)
      .then((res) => res.json())
      .then((data: { stints: StintBreakdown[] }) => {
        if (cancelled) return;
        setStints(data.stints);
        setState("done");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, driverId]);

  if (state === "loading") return <p className="hud-mono py-2 text-[11px] text-slate-500">LOADING...</p>;
  if (state === "error") return <p className="hud-mono py-2 text-[11px] text-red-400">FAILED TO LOAD</p>;
  if (stints.length === 0)
    return <p className="hud-mono py-2 text-[11px] text-slate-500">NO STINT DATA</p>;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-slate-500">
          <th className="py-1 pr-3 font-medium">Session</th>
          <th className="py-1 pr-3 font-medium">Compound</th>
          <th className="py-1 pr-3 font-medium text-right">Laps</th>
          <th className="py-1 pr-3 font-medium text-right">Avg</th>
          <th className="py-1 font-medium text-right">Best</th>
        </tr>
      </thead>
      <tbody>
        {stints.map((s, i) => (
          <tr key={i} className="border-t border-slate-800/60">
            <td className="hud-mono py-1 pr-3 text-slate-400">{SESSION_LABELS[s.sessionType]}</td>
            <td className="hud-mono py-1 pr-3 text-slate-300">{s.compound}</td>
            <td className="hud-mono py-1 pr-3 text-right text-slate-400">{s.lapCount}</td>
            <td className="hud-mono py-1 pr-3 text-right text-slate-300">{formatLapTime(s.avgLapTime)}</td>
            <td className="hud-mono py-1 text-right text-cyan-300">{formatLapTime(s.bestLapTime)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PaceProjectionPanel({
  raceId,
  endpoint,
  title,
  buttonLabel,
  emptyMessage,
}: {
  raceId: number;
  endpoint: "/api/practice-pace" | "/api/race-pace-projection";
  title: string;
  buttonLabel: string;
  emptyMessage: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [rows, setRows] = useState<PaceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedDriverId, setExpandedDriverId] = useState<number | null>(null);

  async function handleClick() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`${endpoint}?raceId=${raceId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }
      const data: { drivers: PaceRow[] } = await res.json();
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
    <HudPanel title={title}>
      <button
        onClick={handleClick}
        disabled={state === "loading"}
        className="hud-mono border border-cyan-500 bg-cyan-950/40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-cyan-300 shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] transition-colors hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "loading" ? "Calculating..." : buttonLabel}
      </button>

      {state === "error" && <p className="hud-mono mt-2 text-[11px] text-red-400">{error}</p>}

      {state === "done" && rows.length === 0 && (
        <p className="hud-mono mt-2 text-xs text-slate-500">{emptyMessage}</p>
      )}

      {state === "done" && rows.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5">
          {rows.map((r) => {
            const color = getTeamColor(r.teamName);
            const gap = r.relativePace - fastest;
            const widthPct = Math.max(3, Math.min(100, (gap / scaleMax) * 100));
            const isFastest = r.rank === 1;
            const isExpanded = expandedDriverId === r.driverId;
            return (
              <div key={r.driverId}>
                <button
                  onClick={() => setExpandedDriverId(isExpanded ? null : r.driverId)}
                  className="flex w-full items-center gap-3 text-left hover:bg-cyan-950/20"
                >
                  <span className="hud-mono w-4 shrink-0 text-xs text-slate-600">
                    {isExpanded ? "▾" : "▸"}
                  </span>
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
                </button>
                {isExpanded && (
                  <div className="ml-13 border-l border-cyan-900/60 pl-4">
                    <StintDetail raceId={raceId} driverId={r.driverId} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </HudPanel>
  );
}
