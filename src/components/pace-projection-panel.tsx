"use client";

import { useState, useEffect } from "react";
import { getTeamColor } from "@/lib/team-colors";
import { HudPanel } from "./hud-panel";

type PaceRow = {
  driverId: number;
  driverName: string;
  teamName: string | null;
  relativePace: number;
  sampleSize: number | null;
  rank: number;
};

const LOW_CONFIDENCE_SAMPLE_SIZE = 3; // fewer drivers than this sharing a compound baseline = unreliable gap
const LOW_FIELD_COVERAGE_THRESHOLD = 8; // fewer than this many drivers with any data at all = weekend-wide warning

const INITIAL_ROW_COUNT = 10;

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

/** Last name only -- fits the narrow column without truncating mid-word. */
function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
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

  if (state === "loading") return <p className="hud-mono py-2 text-[11px] text-slate-400">LOADING...</p>;
  if (state === "error") return <p className="hud-mono py-2 text-[11px] text-red-400">FAILED TO LOAD</p>;
  if (stints.length === 0)
    return <p className="hud-mono py-2 text-[11px] text-slate-400">NO STINT DATA</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-slate-400">
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
              <td className="hud-mono py-1 text-right text-red-300">{formatLapTime(s.bestLapTime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaceProjectionPanel({
  raceId,
  endpoint,
  title,
  emptyMessage,
}: {
  raceId: number;
  endpoint: "/api/practice-pace" | "/api/race-pace-projection";
  title: string;
  emptyMessage: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [rows, setRows] = useState<PaceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedDriverId, setExpandedDriverId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  function fetchPace(onDone: () => boolean) {
    (async () => {
      try {
        const res = await fetch(`${endpoint}?raceId=${raceId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (onDone()) {
            setError(body.error ?? `Request failed (${res.status})`);
            setState("error");
          }
          return;
        }
        const data: { drivers: PaceRow[] } = await res.json();
        if (onDone()) {
          setRows(data.drivers);
          setState("done");
        }
      } catch (err) {
        if (onDone()) {
          setError(err instanceof Error ? err.message : "Calculation failed");
          setState("error");
        }
      }
    })();
  }

  function load() {
    setState("loading");
    setError(null);
    fetchPace(() => true);
  }

  useEffect(() => {
    let cancelled = false;
    // Fetch on mount / whenever the race or endpoint changes — this loading
    // state is intrinsic to the fetch lifecycle the effect starts, not
    // derivable from props, so a direct setState here is the correct shape.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState("loading");
    setError(null);
    fetchPace(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [raceId, endpoint]);

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
      <div className="flex items-center justify-between gap-3">
        <p className="hud-mono text-[11px] text-slate-400">
          {state === "loading" && rows.length === 0
            ? "CALCULATING..."
            : state === "done" && rows.length > 0 && rows.length < LOW_FIELD_COVERAGE_THRESHOLD
              ? `⚠ ONLY ${rows.length} DRIVER${rows.length === 1 ? "" : "S"} HAVE USABLE DATA — LOW CONFIDENCE`
              : ""}
        </p>
        <button
          onClick={load}
          disabled={state === "loading"}
          className="hud-mono shrink-0 border border-red-500 bg-red-950/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-red-300 shadow-[0_0_12px_-2px_rgba(212,0,0,0.5)] transition-colors hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "loading" ? "..." : "Recalculate"}
        </button>
      </div>

      {state === "error" && <p className="hud-mono mt-2 text-[11px] text-red-400">{error}</p>}

      {state === "done" && rows.length === 0 && (
        <p className="hud-mono mt-2 text-xs text-slate-400">{emptyMessage}</p>
      )}

      {state === "done" && rows.length > 0 && (
        <div className="mt-3 flex flex-col">
          {(showAll ? rows : rows.slice(0, INITIAL_ROW_COUNT)).map((r) => {
            const color = getTeamColor(r.teamName);
            const gap = r.relativePace - fastest;
            // Bar length tracks pace itself (leader = full bar), not the gap --
            // a longer bar reading as "faster" is the intuitive direction;
            // encoding the gap directly made the leader's bar a sliver and
            // everyone else's fill most of the track, backwards from how a
            // speed comparison should read.
            const widthPct = Math.max(4, 100 - (gap / scaleMax) * 100);
            const isFastest = r.rank === 1;
            const isExpanded = expandedDriverId === r.driverId;
            const isLowConfidence = r.sampleSize != null && r.sampleSize < LOW_CONFIDENCE_SAMPLE_SIZE;
            return (
              <div key={r.driverId}>
                <button
                  onClick={() => setExpandedDriverId(isExpanded ? null : r.driverId)}
                  className="flex w-full items-center gap-2.5 border-t border-[#1b1e27] py-1.5 text-left first:border-t-0 hover:bg-red-950/20"
                >
                  <span className="hud-mono w-3 shrink-0 text-[10px] text-slate-600">
                    {isExpanded ? "▾" : "▸"}
                  </span>
                  <div className="hud-mono w-5 shrink-0 text-right text-xs text-slate-400">{r.rank}</div>
                  <div className="w-24 shrink-0 truncate text-sm text-[#f2f3f5]">
                    {lastName(r.driverName)}
                    {isLowConfidence && (
                      <span className="ml-1 text-amber-400" title="Low sample size — treat with caution">
                        ⚠
                      </span>
                    )}
                  </div>
                  <div className="relative h-4 flex-1 overflow-hidden bg-[#1e212b]">
                    <div
                      className="hud-bar-fill h-full opacity-90"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: color,
                        boxShadow: isFastest ? `0 0 10px 1px ${color}` : undefined,
                        animationDelay: `${r.rank * 40}ms`,
                        opacity: isLowConfidence ? 0.5 : 0.9,
                      }}
                    />
                  </div>
                  <div
                    className={`hud-mono w-14 shrink-0 text-right text-xs ${isFastest ? "text-red-300" : "text-slate-400"}`}
                  >
                    {isFastest ? "LEAD" : `+${gap.toFixed(3)}`}
                  </div>
                </button>
                {isExpanded && (
                  <div className="ml-11 border-l border-red-900/60 py-1 pl-4">
                    <StintDetail raceId={raceId} driverId={r.driverId} />
                  </div>
                )}
              </div>
            );
          })}
          {rows.length > INITIAL_ROW_COUNT && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="hud-mono mt-1 w-full border-t border-slate-800/80 pt-2 text-center text-[11px] uppercase tracking-wider text-red-500 hover:text-red-300"
            >
              {showAll ? "Show less ▴" : `+${rows.length - INITIAL_ROW_COUNT} more ▾`}
            </button>
          )}
        </div>
      )}
    </HudPanel>
  );
}
