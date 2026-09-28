"use client";

import { useState } from "react";
import { PredictionPanel } from "./prediction-panel";
import { XgboostPredictionPanel } from "./xgboost-prediction-panel";

type Tab = "main" | "experimental";

/**
 * Tabbed container for the two prediction models — previously PredictionPanel
 * and XgboostPredictionPanel were stacked directly on top of each other with
 * only their own internal titles to distinguish them, which read as two
 * near-duplicate panels rather than "the real one" and "a second opinion."
 *
 * Both panels stay mounted (just hidden via CSS) rather than being
 * conditionally rendered, so switching tabs doesn't discard an in-progress
 * or completed simulation run -- re-running a Monte Carlo simulation isn't
 * expensive, but there's no reason to throw the result away on a tab click.
 */
export function PredictionTabs({ raceId }: { raceId: number }) {
  const [tab, setTab] = useState<Tab>("main");

  return (
    <div>
      <div className="flex gap-2">
        <button
          onClick={() => setTab("main")}
          className={`hud-mono border px-4 py-2 text-xs font-semibold uppercase tracking-widest transition-colors ${
            tab === "main"
              ? "border-cyan-500 bg-cyan-950/60 text-cyan-300"
              : "border-slate-800 text-slate-400 hover:border-slate-700"
          }`}
        >
          Monte Carlo — Main Model
        </button>
        <button
          onClick={() => setTab("experimental")}
          className={`hud-mono border px-4 py-2 text-xs font-semibold uppercase tracking-widest transition-colors ${
            tab === "experimental"
              ? "border-amber-500 bg-amber-950/40 text-amber-300"
              : "border-slate-800 text-slate-400 hover:border-slate-700"
          }`}
        >
          XGBoost — Experimental
        </button>
      </div>

      <div className={`mt-4 ${tab === "main" ? "" : "hidden"}`}>
        <PredictionPanel raceId={raceId} />
      </div>
      <div className={`mt-4 ${tab === "experimental" ? "" : "hidden"}`}>
        <XgboostPredictionPanel raceId={raceId} />
      </div>
    </div>
  );
}
