"use client";

import { useState } from "react";
import { getTeamColor } from "@/lib/team-colors";
import { HudPanel } from "./hud-panel";

type SimSignals = {
  basePace: boolean;
  practicePace: boolean;
  racePaceProjection: boolean;
  carStrength: boolean;
  trackAffinity: boolean;
  qualiForm: boolean;
};

type DriverOutcome = {
  driverId: number;
  driverName: string;
  teamName: string | null;
  avgFinishPosition: number | null;
  winPct: number;
  podiumPct: number;
  pointsPct: number;
  dnfPct: number;
  avgPoints: number;
  avgGridPosition: number | null;
  expectedPace: number;
  signals: SimSignals;
};

type SimResult = {
  runId: number;
  iterations: number;
  hasRealGrid: boolean;
  gridIsProvisional: boolean;
  drivers: DriverOutcome[];
};

const INITIAL_ROW_COUNT = 10;
const ITERATION_OPTIONS = [2000, 8000, 20000];

function pct(v: number): string {
  if (v >= 0.995) return "100";
  if (v > 0 && v < 0.001) return "<0.1";
  return (v * 100).toFixed(1);
}

/** Which rating signals fed a driver's prediction — shown so a number built on thin data is visibly thin. */
function SignalDots({ signals }: { signals: SimSignals }) {
  const entries: [keyof SimSignals, string][] = [
    ["basePace", "Base pace"],
    ["practicePace", "Practice (qualifying) pace"],
    ["racePaceProjection", "Practice long-run pace"],
    ["carStrength", "Car strength"],
    ["trackAffinity", "Track affinity"],
    ["qualiForm", "Recent qualifying form"],
  ];
  return (
    <span className="flex items-center gap-[3px]">
      {entries.map(([key, label]) => (
        <span
          key={key}
          title={`${label}: ${signals[key] ? "available" : "missing"}`}
          className={`h-1.5 w-1.5 rounded-full ${signals[key] ? "bg-cyan-400" : "bg-slate-700"}`}
        />
      ))}
    </span>
  );
}

export function PredictionPanel({ raceId }: { raceId: number }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iterations, setIterations] = useState(8000);
  const [showAll, setShowAll] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  // Live standings from the in-flight run, shown while it converges.
  const [liveDrivers, setLiveDrivers] = useState<DriverOutcome[]>([]);

  async function run() {
    setState("loading");
    setError(null);
    setProgress({ completed: 0, total: iterations });
    setLiveDrivers([]);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raceId, iterations }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }

      // NDJSON stream: one event per line. Buffer partial lines, since a
      // chunk boundary can land in the middle of a JSON object.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "progress") {
            setProgress({ completed: event.completed, total: event.total });
            setLiveDrivers(event.drivers);
          } else if (event.type === "done") {
            setResult(event.result);
            setProgress({ completed: event.result.iterations, total: event.result.iterations });
            setState("done");
          } else if (event.type === "error") {
            setError(event.error);
            setState("error");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
      setState("error");
    }
  }

  // While a run is in flight the table is driven by the latest streamed
  // snapshot, so the probabilities are visibly converging rather than the
  // panel sitting blank until the end.
  const isLive = state === "loading" && liveDrivers.length > 0;
  const rows = isLive ? liveDrivers : result?.drivers ?? [];
  const visible = showAll ? rows : rows.slice(0, INITIAL_ROW_COUNT);

  return (
    <HudPanel title="Race Prediction — Monte Carlo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="hud-mono text-[10px] uppercase tracking-widest text-slate-500">
            Iterations
          </span>
          {ITERATION_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setIterations(n)}
              disabled={state === "loading"}
              className={`hud-mono border px-2 py-1 text-[10px] tracking-wider transition-colors disabled:opacity-50 ${
                iterations === n
                  ? "border-cyan-500 bg-cyan-950/60 text-cyan-300"
                  : "border-slate-800 text-slate-500 hover:border-slate-700"
              }`}
            >
              {n.toLocaleString()}
            </button>
          ))}
        </div>
        <button
          onClick={run}
          disabled={state === "loading"}
          className="hud-mono border border-cyan-500 bg-cyan-950/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-cyan-300 shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] transition-colors hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "loading" ? "Simulating..." : state === "done" ? "Re-run" : "Run Simulation"}
        </button>
      </div>

      {state === "idle" && (
        <p className="hud-mono mt-3 text-[11px] leading-relaxed text-slate-500">
          RUNS A MONTE CARLO SIMULATION OF THIS RACE FROM THE RATINGS COMPUTED
          BEFORE IT — BASE PACE, PRACTICE PACE, LONG-RUN PACE, CAR STRENGTH,
          TRACK AFFINITY AND RELIABILITY — SAMPLING PACE NOISE, RETIREMENTS AND
          SAFETY CARS EACH LAP OF THE FIELD.
        </p>
      )}

      {state === "loading" && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <p className="hud-mono text-xs text-cyan-400">
              SIMULATING<span className="hud-ellipsis" /> {progress
                ? `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}`
                : iterations.toLocaleString()}{" "}
              RACES
            </p>
            <p className="hud-mono text-xs text-cyan-300">
              {progress && progress.total > 0
                ? Math.round((progress.completed / progress.total) * 100)
                : 0}
              %
            </p>
          </div>
          <div className="relative mt-1.5 h-1.5 overflow-hidden bg-slate-900/80">
            <div
              className="h-full bg-cyan-400 shadow-[0_0_10px_0_rgba(34,211,238,0.8)] transition-[width] duration-200 ease-linear"
              style={{
                width: `${progress && progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%`,
              }}
            />
            {/* sweep highlight, so the bar reads as active even between ticks */}
            <div className="hud-scan pointer-events-none absolute inset-y-0 w-1/3" />
          </div>
        </div>
      )}

      {state === "error" && <p className="hud-mono mt-3 text-[11px] text-red-400">{error}</p>}

      {(isLive || (state === "done" && result)) && (
        <>
          {result && state === "done" ? (
            <p className="hud-mono mt-3 text-[10px] uppercase tracking-wider text-slate-500">
              {result.iterations.toLocaleString()} iterations ·{" "}
              {!result.hasRealGrid ? (
                <span className="text-amber-400">grid simulated (no qualifying yet)</span>
              ) : result.gridIsProvisional ? (
                <span className="text-cyan-500">
                  grid from qualifying lap times (classified results pending — excludes penalties)
                </span>
              ) : (
                <span className="text-cyan-500">grid from real qualifying</span>
              )}
            </p>
          ) : (
            <p className="hud-mono mt-3 text-[10px] uppercase tracking-wider text-cyan-600">
              live estimate — converging
            </p>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-xs">
              <thead>
                <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="py-1.5 pr-2 font-medium">#</th>
                  <th className="py-1.5 pr-3 font-medium">Driver</th>
                  <th className="py-1.5 pr-3 font-medium">Win</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Podium</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Points</th>
                  <th className="py-1.5 pr-3 font-medium text-right">DNF</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Avg Fin</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Pace</th>
                  <th className="py-1.5 font-medium text-right">Signals</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d, i) => {
                  const color = getTeamColor(d.teamName);
                  return (
                    <tr key={d.driverId} className="border-t border-slate-800/60">
                      <td className="hud-mono py-1.5 pr-2 text-slate-600">{i + 1}</td>
                      <td className="py-1.5 pr-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-[3px] shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="truncate text-slate-200">{d.driverName}</span>
                        </div>
                      </td>
                      {/* win probability doubles as a bar so the favourite reads at a glance */}
                      <td className="py-1.5 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="relative h-3 w-16 shrink-0 overflow-hidden bg-slate-900/60">
                            {/* During a live run the width is transitioned
                                rather than re-animated from zero, so the bar
                                visibly grows and settles as estimates firm up. */}
                            <div
                              className={
                                isLive
                                  ? "h-full transition-[width] duration-200 ease-out"
                                  : "hud-bar-fill h-full"
                              }
                              style={{
                                width: `${Math.max(d.winPct * 100, d.winPct > 0 ? 2 : 0)}%`,
                                backgroundColor: color,
                                opacity: 0.9,
                              }}
                            />
                          </div>
                          <span className="hud-mono w-10 text-right text-cyan-300">
                            {pct(d.winPct)}%
                          </span>
                        </div>
                      </td>
                      <td className="hud-mono py-1.5 pr-3 text-right text-slate-300">
                        {pct(d.podiumPct)}%
                      </td>
                      <td className="hud-mono py-1.5 pr-3 text-right text-slate-400">
                        {pct(d.pointsPct)}%
                      </td>
                      <td className="hud-mono py-1.5 pr-3 text-right text-slate-500">
                        {pct(d.dnfPct)}%
                      </td>
                      <td className="hud-mono py-1.5 pr-3 text-right text-slate-400">
                        {d.avgFinishPosition != null ? d.avgFinishPosition.toFixed(1) : "—"}
                      </td>
                      <td className="hud-mono py-1.5 pr-3 text-right text-slate-500">
                        {d.expectedPace >= 0 ? "+" : ""}
                        {d.expectedPace.toFixed(3)}
                      </td>
                      <td className="py-1.5">
                        <div className="flex justify-end">
                          <SignalDots signals={d.signals} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rows.length > INITIAL_ROW_COUNT && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="hud-mono mt-2 w-full border-t border-slate-800/80 pt-2 text-center text-[11px] uppercase tracking-wider text-cyan-500 hover:text-cyan-300"
            >
              {showAll ? "Show less ▴" : `+${rows.length - INITIAL_ROW_COUNT} more ▾`}
            </button>
          )}
        </>
      )}
    </HudPanel>
  );
}
