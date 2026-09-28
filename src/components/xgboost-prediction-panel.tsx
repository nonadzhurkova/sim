"use client";

import { useState } from "react";
import { getTeamColor } from "@/lib/team-colors";
import { HudPanel } from "./hud-panel";

type XgboostDriver = {
  driverId: number;
  driverName: string;
  teamName: string | null;
  predFinishPosition: number;
  predDnfProb: number;
  winProbability: number;
};

function pct(v: number): string {
  if (v >= 0.995) return "100";
  if (v > 0 && v < 0.001) return "<0.1";
  return (v * 100).toFixed(1);
}

/**
 * Experimental second opinion alongside the production Monte Carlo
 * prediction (PredictionPanel) — see README's "What's been tried" section.
 * Trained once, offline, on 13 seasons of historical data
 * (scripts/xgboost/train.py); this panel evaluates that frozen model
 * in-process against live DB features, no Python involved at request time.
 */
export function XgboostPredictionPanel({ raceId }: { raceId: number }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [drivers, setDrivers] = useState<XgboostDriver[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function run() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/xgboost-predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raceId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }
      setDrivers(body.drivers);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed");
      setState("error");
    }
  }

  const INITIAL_ROW_COUNT = 10;
  const visible = showAll ? drivers : drivers.slice(0, INITIAL_ROW_COUNT);

  return (
    <HudPanel title="Race Prediction — XGBoost (experimental)">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="hud-mono text-[10px] uppercase tracking-widest text-amber-500">
          Unvalidated against the production backtest at the same rigor as the Monte Carlo model — treat as a second opinion
        </p>
        <button
          onClick={run}
          disabled={state === "loading"}
          className="hud-mono border border-amber-500 bg-amber-950/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-amber-300 transition-colors hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "loading" ? "Predicting..." : state === "done" ? "Re-run" : "Run XGBoost Prediction"}
        </button>
      </div>

      {state === "error" && <p className="hud-mono mt-3 text-[11px] text-red-400">{error}</p>}

      {state === "done" && drivers.length > 0 && (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="py-1.5 pr-2 font-medium">#</th>
                  <th className="py-1.5 pr-3 font-medium">Driver</th>
                  <th className="py-1.5 pr-3 font-medium">Win</th>
                  <th className="py-1.5 pr-3 font-medium text-right">DNF</th>
                  <th className="py-1.5 font-medium text-right">Pred. Finish</th>
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
                          <span className="h-3 w-[3px] shrink-0" style={{ backgroundColor: color }} />
                          <span className="truncate text-slate-200">{d.driverName}</span>
                        </div>
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="relative h-3 w-16 shrink-0 overflow-hidden bg-slate-900/60">
                            <div
                              className="hud-bar-fill h-full"
                              style={{
                                width: `${Math.max(d.winProbability * 100, d.winProbability > 0 ? 2 : 0)}%`,
                                backgroundColor: color,
                                opacity: 0.9,
                              }}
                            />
                          </div>
                          <span className="hud-mono w-10 text-right text-amber-300">{pct(d.winProbability)}%</span>
                        </div>
                      </td>
                      <td className="hud-mono py-1.5 pr-3 text-right text-slate-400">{pct(d.predDnfProb)}%</td>
                      <td className="hud-mono py-1.5 text-right text-slate-400">{d.predFinishPosition.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {drivers.length > INITIAL_ROW_COUNT && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="hud-mono mt-2 w-full border-t border-slate-800/80 pt-2 text-center text-[11px] uppercase tracking-wider text-amber-500 hover:text-amber-300"
            >
              {showAll ? "Show less ▴" : `+${drivers.length - INITIAL_ROW_COUNT} more ▾`}
            </button>
          )}
        </>
      )}
    </HudPanel>
  );
}
