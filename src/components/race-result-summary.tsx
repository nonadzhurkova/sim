import Link from "next/link";
import { HudPanel } from "./hud-panel";
import type { PredictionReview, PredictionReviewRow } from "@/queries/prediction-review";

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

const PODIUM_EDGE = ["#f3c13a", "#c9cfdb", "#e08a3c"];

/**
 * Model's predicted top 3 vs. how each actually finished -- a "hit" is a
 * predicted-podium driver who actually finished top 3 (what the model was
 * trying to call), marked distinctly from a predicted podium pick who
 * finished outside it, so the call's accuracy reads at a glance.
 */
function PodiumCall({ rows }: { rows: PredictionReviewRow[] }) {
  const predictedTop3 = rows
    .filter((r) => r.predictedRank <= 3)
    .sort((a, b) => a.predictedRank - b.predictedRank);
  if (predictedTop3.length === 0) return null;

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {predictedTop3.map((r, i) => {
        const edge = PODIUM_EDGE[i];
        const hit = r.actualFinish != null && r.actualFinish <= 3;
        return (
          <div
            key={r.driverId}
            className="relative border border-[#262a35] bg-[#0b0c10] p-3"
            style={{ borderTopWidth: 3, borderTopColor: edge }}
          >
            <div className="flex items-center justify-between">
              <span className="font-heading text-sm font-extrabold" style={{ color: edge }}>
                Predicted P{r.predictedRank}
              </span>
              <span
                className={`hud-mono border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                  hit
                    ? "border-emerald-700 text-emerald-400"
                    : "border-red-800 text-red-400"
                }`}
              >
                {hit ? "✓ Hit" : "Missed"}
              </span>
            </div>
            <p className="mt-1.5 truncate text-sm font-semibold text-[#f2f3f5]">{r.driverName}</p>
            <p className="hud-mono mt-1 text-xs text-slate-400">
              {pct(r.winProbability)}% win chance ·{" "}
              {r.actualStatus != null && r.actualStatus !== "finished" ? (
                <span className="text-red-400">{r.actualStatus.toUpperCase()}</span>
              ) : r.actualFinish != null ? (
                <span className={hit ? "text-emerald-400" : "text-slate-400"}>
                  finished P{r.actualFinish}
                </span>
              ) : (
                "—"
              )}
            </p>
          </div>
        );
      })}
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
      <PodiumCall rows={review.rows} />
      <Link
        href={`/race/${season}/${round}/prediction-review`}
        className="hud-mono mt-3 inline-block text-xs uppercase tracking-widest text-red-500 hover:text-red-300"
      >
        Full driver-by-driver comparison →
      </Link>
    </HudPanel>
  );
}
