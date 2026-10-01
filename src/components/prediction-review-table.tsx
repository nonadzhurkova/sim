import { getTeamColor } from "@/lib/team-colors";
import { HudPanel } from "./hud-panel";
import type { PredictionReview, PredictionReviewRow } from "@/queries/prediction-review";

function pct(v: number): string {
  if (v >= 0.995) return "100";
  if (v > 0 && v < 0.001) return "<0.1";
  return (v * 100).toFixed(1);
}

/** Colored by how far off the model was, not just the sign — a miss of 1-2 places is normal noise, a double-digit miss is a real blind spot. Used for the magnitude call-outs (Weakest spots / Best calls) and the numeric Miss columns in the main table. */
function rankErrorColor(error: number | null): string {
  if (error == null) return "text-slate-600";
  const abs = Math.abs(error);
  if (abs <= 2) return "text-slate-400";
  if (abs <= 5) return "text-amber-400";
  return "text-red-400";
}

/**
 * Whole-field accuracy verdict for one model's predicted rank vs. what
 * actually happened, across every position, not just the podium boundary —
 * predicted #7 finishing #8 is a good call just like predicted #1 finishing
 * #1 is, and predicted #3 finishing #9 is a bad one even though neither
 * position is on the podium. Four tiers, not three, so an exact call reads
 * differently from a near miss: "exact" = the precise position. "close" =
 * within 2 places (normal noise range). "off" = 3-4 places (a real but
 * modest miss). "miss" = 5 or more places off, a genuine blind spot. Null
 * when there's no actual finish to compare against (DNF/DSQ) — that's not a
 * miss, there's nothing to score.
 */
type AccuracyCall = "exact" | "close" | "off" | "miss" | null;

function accuracyCall(predictedRank: number, actualFinish: number | null): AccuracyCall {
  if (actualFinish == null) return null;
  const abs = Math.abs(actualFinish - predictedRank);
  if (abs === 0) return "exact";
  if (abs <= 2) return "close";
  if (abs <= 4) return "off";
  return "miss";
}

/** Text color for a whole model's prediction cells (rank, win%, finish) — the verdict is one glanceable color across the whole block, not just the rank digit. */
function accuracyCallColor(call: AccuracyCall): string {
  if (call === "exact") return "text-emerald-300";
  if (call === "close") return "text-emerald-500";
  if (call === "off") return "text-amber-400";
  if (call === "miss") return "text-red-400";
  return "text-slate-400";
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-slate-800/80 bg-slate-950/40 px-3 py-2">
      <p className="hud-mono text-[10px] uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-slate-100">{value}</p>
      {sub && <p className="hud-mono text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function DriverLine({ row, accent }: { row: PredictionReviewRow; accent?: boolean }) {
  const color = getTeamColor(row.teamName);
  return (
    <span className={`flex items-center gap-2 ${accent ? "font-semibold text-cyan-300" : "text-slate-200"}`}>
      <span className="h-3 w-[3px] shrink-0" style={{ backgroundColor: color }} />
      {row.driverName}
    </span>
  );
}

export function PredictionReviewTable({ review }: { review: PredictionReview }) {
  const { rows, favourite, actualWinner, winnerPredictedRank, podiumHits, meanAbsRankError, logLoss, isFrozen, modelVersion, xgboost, blended } =
    review;

  const xgboostByDriver = new Map((xgboost?.rows ?? []).map((r) => [r.driverId, r]));
  const blendedByDriver = new Map((blended?.rows ?? []).map((r) => [r.driverId, r]));

  // Ordered by what actually happened, not by either model's prediction —
  // reading the table top to bottom should match reading the race result
  // top to bottom, with both models' calls lined up against it. Finishers
  // come first in finishing order; DNF/DSQ drivers (no actual position)
  // trail at the end since there's nothing to sort them by.
  const rowsByActualFinish = [...rows].sort((a, b) => {
    if (a.actualFinish == null && b.actualFinish == null) return 0;
    if (a.actualFinish == null) return 1;
    if (b.actualFinish == null) return -1;
    return a.actualFinish - b.actualFinish;
  });

  const biggestMisses = [...rows]
    .filter((r) => r.rankError != null)
    .sort((a, b) => Math.abs(b.rankError!) - Math.abs(a.rankError!))
    .slice(0, 3);
  const bestCalls = [...rows]
    .filter((r) => r.rankError != null)
    .sort((a, b) => Math.abs(a.rankError!) - Math.abs(b.rankError!))
    .slice(0, 3);

  return (
    <div className="mt-6 flex flex-col gap-6">
      <p className="hud-mono text-[10px] uppercase tracking-widest text-slate-400">
        {isFrozen ? (
          <span className="text-emerald-400">
            frozen prediction — made before this race{modelVersion ? ` (model ${modelVersion})` : ""}
          </span>
        ) : (
          <span className="text-amber-400">
            reconstructed — no pre-race run was saved; this is a live replay under today&apos;s ratings/weights, not
            what the model said at the time
          </span>
        )}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Model's Pick"
          value={favourite?.driverName ?? "—"}
          sub={favourite ? `${pct(favourite.winProbability)}% win chance` : undefined}
        />
        <StatTile
          label="Actual Winner"
          value={actualWinner?.driverName ?? "—"}
          sub={winnerPredictedRank != null ? `predicted rank #${winnerPredictedRank}` : "not simulated"}
        />
        <StatTile label="Podium Hits" value={`${podiumHits}/3`} />
        <StatTile
          label="Log Loss"
          value={logLoss != null ? logLoss.toFixed(3) : "—"}
          sub={meanAbsRankError != null ? `avg rank miss ${meanAbsRankError.toFixed(1)}` : undefined}
        />
      </div>

      {(biggestMisses.length > 0 || bestCalls.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <HudPanel title="Weakest spots — biggest misses">
            <ul className="flex flex-col gap-2">
              {biggestMisses.map((r) => (
                <li key={r.driverId} className="flex items-center justify-between gap-3 text-sm">
                  <DriverLine row={r} />
                  <span className="hud-mono text-xs text-slate-400">
                    predicted #{r.predictedRank} → actual{" "}
                    {r.actualFinish != null ? `#${r.actualFinish}` : r.actualStatus?.toUpperCase() ?? "?"}
                    <span className={`ml-2 font-semibold ${rankErrorColor(r.rankError)}`}>
                      ({r.rankError! > 0 ? "+" : ""}
                      {r.rankError})
                    </span>
                  </span>
                </li>
              ))}
              {biggestMisses.length === 0 && <p className="hud-mono text-xs text-slate-600">No finishers to compare.</p>}
            </ul>
          </HudPanel>

          <HudPanel title="Best calls">
            <ul className="flex flex-col gap-2">
              {bestCalls.map((r) => (
                <li key={r.driverId} className="flex items-center justify-between gap-3 text-sm">
                  <DriverLine row={r} />
                  <span className="hud-mono text-xs text-slate-400">
                    predicted #{r.predictedRank} → actual #{r.actualFinish}
                    <span className="ml-2 font-semibold text-emerald-400">
                      ({r.rankError! > 0 ? "+" : ""}
                      {r.rankError})
                    </span>
                  </span>
                </li>
              ))}
              {bestCalls.length === 0 && <p className="hud-mono text-xs text-slate-600">No finishers to compare.</p>}
            </ul>
          </HudPanel>
        </div>
      )}

      {blended && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Blended Pick (production)"
            value={blended.favourite?.driverName ?? "—"}
            sub={blended.favourite ? `${pct(blended.favourite.winProbability)}% win chance` : undefined}
          />
          <StatTile
            label="Blended Winner Rank"
            value={blended.winnerPredictedRank != null ? `#${blended.winnerPredictedRank}` : "—"}
          />
          <StatTile label="Blended Podium Hits" value={`${blended.podiumHits}/3`} />
          <StatTile label="Blended Log Loss" value={blended.logLoss != null ? blended.logLoss.toFixed(3) : "—"} />
        </div>
      )}

      {xgboost && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="XGBoost Pick"
            value={xgboost.favourite?.driverName ?? "—"}
            sub={xgboost.favourite ? `${pct(xgboost.favourite.winProbability)}% win chance` : undefined}
          />
          <StatTile
            label="XGBoost Winner Rank"
            value={xgboost.winnerPredictedRank != null ? `#${xgboost.winnerPredictedRank}` : "—"}
          />
          <StatTile label="XGBoost Podium Hits" value={`${xgboost.podiumHits}/3`} />
          <StatTile label="XGBoost Log Loss" value={xgboost.logLoss != null ? xgboost.logLoss.toFixed(3) : "—"} />
        </div>
      )}

      <HudPanel title={blended ? "Full field — race result vs. Blended vs. Monte Carlo vs. XGBoost" : "Full field — race result vs. predicted"}>
        {blended && (
          <p className="hud-mono text-[10px] uppercase tracking-widest text-cyan-500">
            Blended is the production prediction (BLEND_ALPHA in params.ts). Monte Carlo and XGBoost below are each
            parent model&apos;s own standalone call.
          </p>
        )}
        <p className="hud-mono mt-1 text-[10px] uppercase tracking-widest text-slate-600">
          Ordered by what actually happened, not by any model&apos;s prediction.{" "}
          <span className="text-emerald-300 font-semibold">bright green</span> = exact position ·{" "}
          <span className="text-emerald-500 font-semibold">green</span> = within 2 places ·{" "}
          <span className="text-amber-400 font-semibold">amber</span> = 3-4 places off ·{" "}
          <span className="text-red-400 font-semibold">red</span> = 5 or more places off
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="py-1.5 pr-3 font-medium">Actual</th>
                <th className="py-1.5 pr-3 font-medium">Driver</th>
                {blended && (
                  <>
                    <th className="py-1.5 pr-3 font-medium text-right text-cyan-400">Blend #</th>
                    <th className="py-1.5 pr-3 font-medium text-right text-cyan-400">Blend Win%</th>
                    <th className="py-1.5 pr-3 font-medium text-right text-cyan-400">Closer</th>
                  </>
                )}
                <th className="py-1.5 pr-3 font-medium text-right">MC #</th>
                <th className="py-1.5 pr-3 font-medium text-right">MC Win%</th>
                <th className="py-1.5 pr-3 font-medium text-right">MC Finish</th>
                {xgboost && (
                  <>
                    <th className="py-1.5 pr-3 font-medium text-right text-amber-500">XGB #</th>
                    <th className="py-1.5 pr-3 font-medium text-right text-amber-500">XGB Win%</th>
                    <th className="py-1.5 pr-3 font-medium text-right text-amber-500">XGB Finish</th>
                  </>
                )}
                <th className="py-1.5 font-medium text-right">MC Miss</th>
              </tr>
            </thead>
            <tbody>
              {rowsByActualFinish.map((r) => {
                const xr = xgboostByDriver.get(r.driverId);
                const br = blendedByDriver.get(r.driverId);
                const mcCall = accuracyCall(r.predictedRank, r.actualFinish);
                const mcColor = accuracyCallColor(mcCall);
                const xgbCall = xr ? accuracyCall(xr.predictedRank, r.actualFinish) : null;
                const xgbColor = xr ? accuracyCallColor(xgbCall) : "text-slate-600";
                const blendCall = br ? accuracyCall(br.predictedRank, r.actualFinish) : null;
                const blendColor = br ? accuracyCallColor(blendCall) : "text-slate-600";
                return (
                  <tr key={r.driverId} className="border-t border-slate-800/60">
                    <td className="hud-mono py-1.5 pr-3 text-slate-300">
                      {r.actualFinish != null ? r.actualFinish : r.actualStatus?.toUpperCase() ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3">
                      <DriverLine row={r} accent={r.driverId === actualWinner?.driverId} />
                    </td>
                    {blended && (
                      <>
                        <td className={`hud-mono py-1.5 pr-3 text-right font-semibold ${blendColor}`}>
                          {br ? br.predictedRank : "—"}
                        </td>
                        <td className={`hud-mono py-1.5 pr-3 text-right ${blendColor}`}>
                          {br ? `${pct(br.winProbability)}%` : "—"}
                        </td>
                        <td className="hud-mono py-1.5 pr-3 text-right text-[10px] uppercase tracking-wider text-slate-500">
                          {br?.closerModel === "monte-carlo" ? "MC" : br?.closerModel === "xgboost" ? "XGB" : br?.closerModel === "tie" ? "tie" : "—"}
                        </td>
                      </>
                    )}
                    <td className={`hud-mono py-1.5 pr-3 text-right font-semibold ${mcColor}`}>{r.predictedRank}</td>
                    <td className={`hud-mono py-1.5 pr-3 text-right ${mcColor}`}>{pct(r.winProbability)}%</td>
                    <td className={`hud-mono py-1.5 pr-3 text-right ${mcColor}`}>
                      {r.predictedFinish != null ? r.predictedFinish.toFixed(1) : "—"}
                    </td>
                    {xgboost && (
                      <>
                        <td className={`hud-mono py-1.5 pr-3 text-right font-semibold ${xgbColor}`}>
                          {xr ? xr.predictedRank : "—"}
                        </td>
                        <td className={`hud-mono py-1.5 pr-3 text-right ${xgbColor}`}>
                          {xr ? `${pct(xr.winProbability)}%` : "—"}
                        </td>
                        <td className={`hud-mono py-1.5 pr-3 text-right ${xgbColor}`}>
                          {xr?.predictedFinish != null ? xr.predictedFinish.toFixed(1) : "—"}
                        </td>
                      </>
                    )}
                    <td className={`hud-mono py-1.5 text-right font-semibold ${mcColor}`}>
                      {r.rankError != null ? `${r.rankError > 0 ? "+" : ""}${r.rankError}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hud-mono mt-3 text-[10px] leading-relaxed text-slate-600">
          BLEND = PRODUCTION PREDICTION (MONTE CARLO + XGBOOST, SEE BLEND_ALPHA IN SRC/SIM/PARAMS.TS). MC = MONTE
          CARLO (PARENT MODEL). XGB = XGBOOST OVERLAY (PARENT MODEL). CLOSER = WHICH PARENT MODEL&apos;S RANK WAS
          NEARER THE ACTUAL FINISH FOR THAT DRIVER. MISS = ACTUAL FINISH − MC PREDICTED RANK. NEGATIVE MEANS THE
          MODEL RATED THEM TOO LOW (THEY FINISHED BETTER THAN EXPECTED); POSITIVE MEANS TOO HIGH. DNF/DSQ DRIVERS
          HAVE NO MISS VALUE — THERE&apos;S NO MEANINGFUL &quot;PREDICTED FINISH&quot; TO COMPARE A RETIREMENT
          AGAINST.
        </p>
      </HudPanel>
    </div>
  );
}
