import Link from "next/link";
import { HudPanel } from "./hud-panel";
import type { PredictionReview } from "@/queries/prediction-review";

function pct(v: number): string {
  if (v >= 0.995) return "100";
  if (v > 0 && v < 0.001) return "<0.1";
  return (v * 100).toFixed(1);
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-slate-800/80 bg-slate-950/40 px-3 py-2">
      <p className="hud-mono text-[10px] uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-slate-100">{value}</p>
      {sub && <p className="hud-mono text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

/**
 * Compact result-vs-prediction summary for a race that's already happened —
 * leads a finished race's page instead of the interactive prediction tabs,
 * since a visitor arriving at a done race almost always wants "what
 * happened, and did the model call it" before "run me a simulation."
 * Links through to the full driver-by-driver comparison
 * (prediction-review-table.tsx) rather than embedding it, since that table
 * is dense enough to deserve its own page.
 */
export function RaceResultSummary({
  review,
  season,
  round,
}: {
  review: PredictionReview;
  season: number;
  round: number;
}) {
  const { favourite, actualWinner, winnerPredictedRank, podiumHits, logLoss, isFrozen, modelVersion } = review;

  return (
    <HudPanel title="Race Result">
      <p className="hud-mono text-[10px] uppercase tracking-widest text-slate-400">
        {isFrozen ? (
          <span className="text-emerald-400">
            model&apos;s prediction was frozen before this race{modelVersion ? ` (model ${modelVersion})` : ""}
          </span>
        ) : (
          <span className="text-amber-400">
            reconstructed — no pre-race run was saved, this is today&apos;s model replaying the race, not what it
            said at the time
          </span>
        )}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Winner" value={actualWinner?.driverName ?? "—"} />
        <Tile
          label="Model's Pick"
          value={favourite?.driverName ?? "—"}
          sub={favourite ? `${pct(favourite.winProbability)}% win chance` : undefined}
        />
        <Tile
          label="Called It?"
          value={winnerPredictedRank === 1 ? "Yes" : winnerPredictedRank != null ? `#${winnerPredictedRank}` : "—"}
          sub={winnerPredictedRank != null && winnerPredictedRank !== 1 ? "predicted winner's rank" : undefined}
        />
        <Tile label="Podium Hits" value={`${podiumHits}/3`} sub={logLoss != null ? `log loss ${logLoss.toFixed(3)}` : undefined} />
      </div>
      <Link
        href={`/race/${season}/${round}/prediction-review`}
        className="hud-mono mt-3 inline-block text-xs uppercase tracking-widest text-cyan-500 hover:text-cyan-300"
      >
        Full driver-by-driver comparison →
      </Link>
    </HudPanel>
  );
}
