import { getTeamColor } from "@/lib/team-colors";
import { HudPanel, SectionHeading } from "./hud-panel";
import type { PredictionReview, PredictionReviewRow } from "@/queries/prediction-review";

function pct(v: number): string {
  if (v >= 0.995) return "100";
  if (v > 0 && v < 0.001) return "<0.1";
  return (v * 100).toFixed(1);
}

/** Colored by how far off the model was, not just the sign — a miss of 1-2 places is normal noise, a double-digit miss is a real blind spot. */
function rankErrorColor(error: number | null): string {
  if (error == null) return "text-slate-600";
  const abs = Math.abs(error);
  if (abs <= 2) return "text-slate-400";
  if (abs <= 5) return "text-amber-400";
  return "text-red-400";
}

/** Same tiering as rankErrorColor, as a bordered chip instead of plain text. */
function missChipClass(error: number | null): string {
  const abs = Math.abs(error ?? 0);
  if (abs <= 2) return "border-slate-600 bg-slate-800/40 text-slate-300";
  if (abs <= 5) return "border-amber-700 bg-amber-950/40 text-amber-400";
  return "border-red-700 bg-red-950/40 text-red-400";
}

type AccuracyCall = "exact" | "close" | "off" | "miss" | null;

function accuracyCall(predictedRank: number, actualFinish: number | null): AccuracyCall {
  if (actualFinish == null) return null;
  const abs = Math.abs(actualFinish - predictedRank);
  if (abs === 0) return "exact";
  if (abs <= 2) return "close";
  if (abs <= 4) return "off";
  return "miss";
}

function missDotColor(call: AccuracyCall): string {
  if (call === "exact") return "#5eead4";
  if (call === "close") return "#34d399";
  if (call === "off") return "#fbbf24";
  if (call === "miss") return "#f87171";
  return "#475569";
}

const CIRCUIT_TYPE_LABEL: Record<string, string> = {
  street: "street circuit",
  technical: "technical circuit",
  high_speed: "high-speed circuit",
};

function DriverLine({ row, accent }: { row: PredictionReviewRow; accent?: boolean }) {
  const color = getTeamColor(row.teamName);
  return (
    <span className={`flex items-center gap-2 ${accent ? "font-semibold text-red-300" : "text-[#f2f3f5]"}`}>
      <span className="h-3 w-[3px] shrink-0" style={{ backgroundColor: color }} />
      {row.driverName}
    </span>
  );
}

function VerdictCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-[#262a35] bg-[#0b0c10] p-4">
      <p className="hud-mono text-[10px] uppercase tracking-widest text-[#8a91a3]">{label}</p>
      <p className="font-heading mt-1 text-2xl font-bold text-[#f2f3f5]">{value}</p>
      {sub && <p className="hud-mono mt-0.5 text-[10px] text-[#8a91a3]">{sub}</p>}
    </div>
  );
}

/**
 * Section 1: one plain sentence plus 4 verdict cards, built entirely from
 * the Blend (production) numbers -- the spec's rule is that the headline
 * verdict uses whichever prediction was actually served, not the Monte
 * Carlo parent model's own, separate call.
 */
function VerdictBanner({ review }: { review: PredictionReview }) {
  const { blended, actualWinner, isFrozen, modelVersion, rows } = review;
  const winnerPick = blended?.favourite ?? review.favourite;
  const winnerRank = blended?.winnerPredictedRank ?? review.winnerPredictedRank;
  const podiumHits = blended?.podiumHits ?? review.podiumHits;
  const winnerConfidence = blended
    ? (blended.rows.find((r) => r.driverId === actualWinner?.driverId)?.winProbability ?? null)
    : (actualWinner?.winProbability ?? null);
  const randomGuessOdds = rows.length > 0 ? 1 / rows.length : null;
  const called = winnerRank === 1;

  const biggestSurprise = [...rows]
    .filter((r) => r.rankError != null)
    .sort((a, b) => Math.abs(b.rankError!) - Math.abs(a.rankError!))[0];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg leading-relaxed text-[#f2f3f5]">
        We gave{" "}
        <span className="font-semibold" style={{ color: getTeamColor(winnerPick?.teamName) }}>
          {winnerPick?.driverName ?? "—"}
        </span>{" "}
        a <span className="font-semibold text-red-400">{winnerPick ? pct(winnerPick.winProbability) : "—"}%</span>{" "}
        chance to win —{" "}
        {called ? (
          <span className="font-semibold text-emerald-400">that call was right</span>
        ) : (
          <>
            <span className="font-semibold text-amber-400">{actualWinner?.driverName ?? "—"} won instead</span>
            {winnerRank != null && (
              <span className="text-[#a3a9b8]"> (we had them at #{winnerRank})</span>
            )}
          </>
        )}
        . {podiumHits} of 3 podium finishers correct.
        {biggestSurprise && Math.abs(biggestSurprise.rankError ?? 0) >= 5 && (
          <>
            {" "}
            Biggest surprise:{" "}
            <span className="font-semibold">{biggestSurprise.driverName}</span>, predicted P
            {biggestSurprise.predictedRank}, finished{" "}
            {biggestSurprise.actualFinish != null ? `P${biggestSurprise.actualFinish}` : biggestSurprise.actualStatus?.toUpperCase()}.
          </>
        )}
      </p>

      {!isFrozen && (
        <p className="hud-mono border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-400">
          Reconstructed: no pre-race prediction was saved for this race. This uses today&apos;s model settings, so
          it may look better (or worse) than the real pre-race call.
        </p>
      )}
      {isFrozen && modelVersion && (
        <p className="hud-mono text-[10px] uppercase tracking-widest text-emerald-400">
          Frozen prediction — made before this race (model {modelVersion})
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <VerdictCard
          label="Winner called?"
          value={called ? "Yes" : "No"}
          sub={!called && winnerRank != null ? `predicted rank #${winnerRank}` : undefined}
        />
        <VerdictCard label="Podium hits" value={`${podiumHits}/3`} />
        <VerdictCard
          label="Avg position miss"
          value={review.meanAbsRankError != null ? review.meanAbsRankError.toFixed(1) : "—"}
          sub="finishers only"
        />
        <VerdictCard
          label="Confidence in actual winner"
          value={winnerConfidence != null ? `${pct(winnerConfidence)}%` : "—"}
          sub={randomGuessOdds != null ? `random guess: ${pct(randomGuessOdds)}%` : undefined}
        />
      </div>
    </div>
  );
}

const PODIUM_EDGE = ["#f3c13a", "#c9cfdb", "#e08a3c"];

/**
 * The actual top 3 finishers, each card showing what the model predicted
 * for them -- their predicted rank and win probability -- so a reader sees
 * at a glance how the call went for every podium finisher, not just the
 * winner. Uses the production blend's numbers when available, same rule as
 * the verdict banner.
 */
function ActualPodium({ review }: { review: PredictionReview }) {
  const primaryRows = review.blended ? review.blended.rows : review.rows;
  const podiumRows = primaryRows
    .filter((r) => r.actualFinish != null && r.actualFinish <= 3)
    .sort((a, b) => a.actualFinish! - b.actualFinish!);
  if (podiumRows.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {podiumRows.map((r) => {
        const edge = PODIUM_EDGE[r.actualFinish! - 1];
        const called = r.predictedRank === r.actualFinish;
        return (
          <article
            key={r.driverId}
            className="relative overflow-hidden border border-[#262a35] bg-[#12141a] p-5"
            style={{ borderTopWidth: 4, borderTopColor: edge }}
          >
            <div className="flex items-baseline gap-3">
              <span className="font-heading text-xl font-extrabold" style={{ color: edge }}>
                P{r.actualFinish}
              </span>
              <span className="hud-mono text-[11px] uppercase tracking-wider text-[#8a91a3]">
                {r.teamName ?? "—"}
              </span>
            </div>
            <div className="font-heading mt-1.5 text-2xl font-bold uppercase leading-tight text-[#f2f3f5]">
              {r.driverName}
            </div>
            <p className="hud-mono mt-1 text-[11px] text-[#8a91a3]">
              Started {r.gridPosition != null ? `P${r.gridPosition}` : "grid unknown"}
            </p>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#1b1e27] pt-3">
              <span className="hud-mono text-xs text-[#8a91a3]">We predicted</span>
              <span
                className={`hud-mono text-sm font-semibold ${called ? "text-emerald-400" : rankErrorColor(r.rankError)}`}
              >
                #{r.predictedRank} · {pct(r.winProbability)}% win chance
              </span>
            </div>
            <div className="mt-2">
              {called ? (
                <span className="hud-mono inline-block border border-emerald-700 bg-emerald-950/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                  Called it exactly
                </span>
              ) : (
                <span
                  className={`hud-mono inline-block border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${missChipClass(r.rankError)}`}
                >
                  Off by {Math.abs(r.rankError ?? 0)} place{Math.abs(r.rankError ?? 0) === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/**
 * Section 2: plain-English pipeline strip using this race's actual values.
 * No finishing-distribution chart or SHAP here (section 3/4 of the spec) --
 * neither exists in the data today (Monte Carlo only accumulates aggregate
 * win/podium/points sums per driver, never keeps each iteration's finish
 * position; XGBoost has no feature-contribution/SHAP mechanism at all). This
 * strip sticks to what's real: the actual grid/pace/blend/iteration counts.
 */
function PipelineStrip({ review }: { review: PredictionReview }) {
  const circuitLabel = review.circuitType ? CIRCUIT_TYPE_LABEL[review.circuitType] ?? review.circuitType : "unknown circuit type";
  const blendPct = Math.round(review.blendAlpha * 100);
  const xgbPct = 100 - blendPct;

  const steps: { title: string; body: string }[] = [
    {
      title: "1. Inputs",
      body: `${review.hasRealGrid ? "Real qualifying grid" : "Simulated grid (no qualifying yet)"}, driver & team pace ratings, and this race's track profile (${circuitLabel}).`,
    },
    {
      title: "2. Monte Carlo",
      body: `Simulated the race ${review.iterations.toLocaleString()} times with random variation in pace, incidents, safety cars and retirements, and counted how often each driver finished where.`,
    },
    {
      title: "3. XGBoost",
      body: review.xgboost
        ? "A machine-learning model trained on past races predicts finishing position from grid slot, recent form and reliability history."
        : "Not used for this race — XGBoost needs a real qualifying grid, which this race didn't have at prediction time, or the model wasn't trained yet.",
    },
    {
      title: "4. Blend",
      body: review.blended
        ? `Final prediction = ${blendPct}% Monte Carlo + ${xgbPct}% XGBoost.`
        : "No blend for this race — only Monte Carlo ran, so that's the production prediction as-is.",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((s) => (
        <div key={s.title} className="border border-[#262a35] bg-[#0b0c10] p-4">
          <p className="font-heading text-sm font-bold uppercase tracking-wide text-red-400">{s.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-[#a3a9b8]">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Section 5: biggest misses, with the one reason tag that's actually
 * derivable today (a grid-penalty / pit-lane start, from grid position vs.
 * qualifying classification). Everything else the spec lists (incident,
 * rating-out-of-date, safety-car chaos) has no real recorded data behind
 * it -- see src/temp/prediction-review-redesign.md's own "don't invent
 * numbers" rule -- so a miss without a known reason says "unexplained"
 * rather than guessing.
 */
function BiggestMisses({ rows }: { rows: PredictionReviewRow[] }) {
  const biggestMisses = [...rows]
    .filter((r) => r.rankError != null)
    .sort((a, b) => Math.abs(b.rankError!) - Math.abs(a.rankError!))
    .slice(0, 3);
  const bestCalls = [...rows]
    .filter((r) => r.rankError != null)
    .sort((a, b) => Math.abs(a.rankError!) - Math.abs(b.rankError!))
    .slice(0, 3);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <HudPanel title="Weakest spots — biggest misses">
        <ul className="flex flex-col gap-2">
          {biggestMisses.map((r) => (
            <li key={r.driverId} className="flex items-center justify-between gap-3 text-sm">
              <DriverLine row={r} />
              <span className="hud-mono text-xs text-[#8a91a3]">
                predicted #{r.predictedRank} → actual{" "}
                {r.actualFinish != null ? `#${r.actualFinish}` : (r.actualStatus?.toUpperCase() ?? "?")}
                <span className={`ml-2 font-semibold ${rankErrorColor(r.rankError)}`}>
                  ({r.rankError! > 0 ? "+" : ""}
                  {r.rankError})
                </span>
                {r.startedOutOfPosition === true ? (
                  <span className="ml-2 border border-amber-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-400">
                    grid penalty
                  </span>
                ) : (
                  <span className="ml-2 text-[9px] uppercase tracking-wider text-slate-600">unexplained</span>
                )}
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
              <span className="hud-mono text-xs text-[#8a91a3]">
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
  );
}

/**
 * Section 6: retirements, with the model's own predicted DNF probability
 * when available. Monte Carlo's per-driver DNF% only exists when
 * reconstructed live (a genuinely frozen run only stored win/podium/points
 * percentages, not DNF -- see predictedDnfProbability's doc comment on
 * PredictionReviewRow); XGBoost's is always available. Says so rather than
 * silently showing "—" with no context.
 */
function RetirementsSection({ review }: { review: PredictionReview }) {
  const dnfRows = review.rows.filter((r) => r.actualStatus === "dnf" || r.actualStatus === "dsq");
  if (dnfRows.length === 0) return null;

  const expectedDnfCount = review.rows.reduce((sum, r) => sum + (r.predictedDnfProbability ?? 0), 0);
  const hasAnyDnfData = review.rows.some((r) => r.predictedDnfProbability != null);

  return (
    <HudPanel title="Retirements">
      <p className="hud-mono text-xs text-[#8a91a3]">
        {hasAnyDnfData
          ? `Model expected ~${expectedDnfCount.toFixed(1)} retirements, actual ${dnfRows.length}.`
          : `${dnfRows.length} retirement${dnfRows.length === 1 ? "" : "s"} this race. Per-driver DNF probability isn't available for this prediction (only a live-reconstructed Monte Carlo run or XGBoost carries it; a frozen run doesn't store it).`}
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {dnfRows.map((r) => (
          <li key={r.driverId} className="flex items-center justify-between gap-3 text-sm">
            <DriverLine row={r} />
            <span className="hud-mono text-xs text-[#8a91a3]">
              {r.actualStatus?.toUpperCase()} · predicted DNF chance:{" "}
              {r.predictedDnfProbability != null ? `${pct(r.predictedDnfProbability)}%` : "not available"}
            </span>
          </li>
        ))}
      </ul>
    </HudPanel>
  );
}

/** Section 7: simplified full-field table — Actual / Driver / Predicted (Blend) / Win% / Expected finish / Miss. No "expected range" column: that needs a per-driver finishing distribution the simulation doesn't retain today. */
function FullFieldTable({ review }: { review: PredictionReview }) {
  const { rows, blended, actualWinner } = review;
  const mcByDriver = new Map(rows.map((r) => [r.driverId, r]));
  const primaryRows = blended ? blended.rows : rows;

  const rowsByActualFinish = [...primaryRows].sort((a, b) => {
    if (a.actualFinish == null && b.actualFinish == null) return 0;
    if (a.actualFinish == null) return 1;
    if (b.actualFinish == null) return -1;
    return a.actualFinish - b.actualFinish;
  });

  return (
    <HudPanel title="Full field">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-[#8a91a3]">
              <th className="py-1.5 pr-3 font-medium">Actual</th>
              <th className="py-1.5 pr-3 font-medium">Driver</th>
              <th className="py-1.5 pr-3 font-medium text-right" title="Predicted finishing rank, production blend">
                Predicted
              </th>
              <th className="py-1.5 pr-3 font-medium text-right" title="Win probability, production blend">
                Win %
              </th>
              <th
                className="py-1.5 pr-3 font-medium text-right"
                title="Monte Carlo's average simulated finishing position for this driver"
              >
                Expected finish
              </th>
              <th className="py-1.5 font-medium text-right" title="Actual finish minus predicted rank">
                Miss
              </th>
            </tr>
          </thead>
          <tbody>
            {rowsByActualFinish.map((r) => {
              const call = accuracyCall(r.predictedRank, r.actualFinish);
              const mcRow = mcByDriver.get(r.driverId);
              return (
                <tr key={r.driverId} className="border-t border-[#1b1e27]">
                  <td className="hud-mono py-1.5 pr-3 text-[#a3a9b8]">
                    {r.actualFinish != null ? r.actualFinish : (r.actualStatus?.toUpperCase() ?? "—")}
                  </td>
                  <td className="py-1.5 pr-3">
                    <DriverLine row={r} accent={r.driverId === actualWinner?.driverId} />
                  </td>
                  <td className="hud-mono py-1.5 pr-3 text-right font-semibold text-[#f2f3f5]">
                    #{r.predictedRank}
                  </td>
                  <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">{pct(r.winProbability)}%</td>
                  <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                    {mcRow?.predictedFinish != null ? mcRow.predictedFinish.toFixed(1) : "—"}
                  </td>
                  <td className="py-1.5 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: missDotColor(call) }} />
                      <span className={`hud-mono font-semibold ${rankErrorColor(r.rankError)}`}>
                        {r.rankError != null ? `${r.rankError > 0 ? "+" : ""}${r.rankError}` : "—"}
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hud-mono mt-3 text-[10px] leading-relaxed text-slate-600">
        MISS = ACTUAL FINISH − PREDICTED RANK. NEGATIVE MEANS THE MODEL RATED THEM TOO LOW (FINISHED BETTER THAN
        EXPECTED); POSITIVE MEANS TOO HIGH. DNF/DSQ DRIVERS HAVE NO MISS VALUE. EXPECTED FINISH IS MONTE CARLO&apos;S
        AVERAGE SIMULATED FINISHING POSITION, SEPARATE FROM THE BLEND&apos;S PREDICTED RANK.
      </p>
    </HudPanel>
  );
}

/**
 * Section 8: model comparison, collapsed by default. Two tables: the
 * aggregate pick/winner-rank/podium-hits/log-loss summary (unchanged from
 * before), plus a per-driver breakdown (predicted rank + win% for each
 * parent model, and which one was closer) -- this detail existed in the
 * page's previous version and was genuinely useful for inspecting whether
 * the blend tracks both models or just whichever was closer that race, so
 * it belongs here rather than staying gone.
 */
function ModelComparison({ review }: { review: PredictionReview }) {
  const { blended, xgboost, favourite, winnerPredictedRank, podiumHits, logLoss, rows, actualWinner } = review;
  if (!blended || !xgboost) return null;

  const mcByDriver = new Map(rows.map((r) => [r.driverId, r]));
  const xgbByDriver = new Map(xgboost.rows.map((r) => [r.driverId, r]));
  const perDriverRows = [...blended.rows].sort((a, b) => {
    if (a.actualFinish == null && b.actualFinish == null) return 0;
    if (a.actualFinish == null) return 1;
    if (b.actualFinish == null) return -1;
    return a.actualFinish - b.actualFinish;
  });

  const { monteCarlo, xgboost: xgbCount, tie } = blended.closerModelCounts;
  const takeaway =
    monteCarlo === xgbCount
      ? `Monte Carlo and XGBoost were equally close, tied on ${tie}.`
      : `${monteCarlo > xgbCount ? "Monte Carlo" : "XGBoost"} was closer on ${Math.max(monteCarlo, xgbCount)} drivers, the other on ${Math.min(monteCarlo, xgbCount)}, tied on ${tie}.`;

  return (
    <details className="group">
      <summary className="font-heading cursor-pointer list-none text-xl font-extrabold uppercase tracking-wide text-[#f2f3f5] hover:text-red-400">
        <span className="mr-2 inline-block text-base transition-transform group-open:rotate-90">▶</span>
        Model comparison
      </summary>
      <div className="mt-4 flex flex-col gap-3">
        <p className="hud-mono text-xs text-[#8a91a3]">{takeaway}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-[#8a91a3]">
                <th className="py-1.5 pr-3 font-medium">Model</th>
                <th className="py-1.5 pr-3 font-medium">Pick</th>
                <th className="py-1.5 pr-3 font-medium text-right">Win %</th>
                <th className="py-1.5 pr-3 font-medium text-right">Winner rank</th>
                <th className="py-1.5 pr-3 font-medium text-right">Podium hits</th>
                <th className="py-1.5 font-medium text-right">Log loss</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[#1b1e27]">
                <td className="hud-mono py-1.5 pr-3 font-semibold text-red-400">Blend</td>
                <td className="py-1.5 pr-3 text-[#f2f3f5]">{blended.favourite?.driverName ?? "—"}</td>
                <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                  {blended.favourite ? `${pct(blended.favourite.winProbability)}%` : "—"}
                </td>
                <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                  {blended.winnerPredictedRank != null ? `#${blended.winnerPredictedRank}` : "—"}
                </td>
                <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">{blended.podiumHits}/3</td>
                <td className="hud-mono py-1.5 text-right text-[#a3a9b8]">
                  {blended.logLoss != null ? blended.logLoss.toFixed(3) : "—"}
                </td>
              </tr>
              <tr className="border-t border-[#1b1e27]">
                <td className="hud-mono py-1.5 pr-3 font-semibold text-slate-300">Monte Carlo</td>
                <td className="py-1.5 pr-3 text-[#f2f3f5]">{favourite?.driverName ?? "—"}</td>
                <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                  {favourite ? `${pct(favourite.winProbability)}%` : "—"}
                </td>
                <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                  {winnerPredictedRank != null ? `#${winnerPredictedRank}` : "—"}
                </td>
                <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">{podiumHits}/3</td>
                <td className="hud-mono py-1.5 text-right text-[#a3a9b8]">{logLoss != null ? logLoss.toFixed(3) : "—"}</td>
              </tr>
              <tr className="border-t border-[#1b1e27]">
                <td className="hud-mono py-1.5 pr-3 font-semibold text-amber-500">XGBoost</td>
                <td className="py-1.5 pr-3 text-[#f2f3f5]">{xgboost.favourite?.driverName ?? "—"}</td>
                <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                  {xgboost.favourite ? `${pct(xgboost.favourite.winProbability)}%` : "—"}
                </td>
                <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                  {xgboost.winnerPredictedRank != null ? `#${xgboost.winnerPredictedRank}` : "—"}
                </td>
                <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">{xgboost.podiumHits}/3</td>
                <td className="hud-mono py-1.5 text-right text-[#a3a9b8]">
                  {xgboost.logLoss != null ? xgboost.logLoss.toFixed(3) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="hud-mono mt-2 text-[10px] uppercase tracking-widest text-[#8a91a3]">Per-driver breakdown</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-[#8a91a3]">
                <th className="py-1.5 pr-3 font-medium">Actual</th>
                <th className="py-1.5 pr-3 font-medium">Driver</th>
                <th className="py-1.5 pr-3 font-medium text-right text-red-400">Blend #</th>
                <th className="py-1.5 pr-3 font-medium text-right text-red-400">Blend Win%</th>
                <th className="py-1.5 pr-3 font-medium text-right text-slate-300">MC #</th>
                <th className="py-1.5 pr-3 font-medium text-right text-slate-300">MC Win%</th>
                <th className="py-1.5 pr-3 font-medium text-right text-amber-500">XGB #</th>
                <th className="py-1.5 pr-3 font-medium text-right text-amber-500">XGB Win%</th>
                <th className="py-1.5 font-medium text-right">Closer</th>
              </tr>
            </thead>
            <tbody>
              {perDriverRows.map((r) => {
                const mcRow = mcByDriver.get(r.driverId);
                const xgbRow = xgbByDriver.get(r.driverId);
                return (
                  <tr key={r.driverId} className="border-t border-[#1b1e27]">
                    <td className="hud-mono py-1.5 pr-3 text-[#a3a9b8]">
                      {r.actualFinish != null ? r.actualFinish : (r.actualStatus?.toUpperCase() ?? "—")}
                    </td>
                    <td className="py-1.5 pr-3">
                      <DriverLine row={r} accent={r.driverId === actualWinner?.driverId} />
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right font-semibold text-[#f2f3f5]">#{r.predictedRank}</td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">{pct(r.winProbability)}%</td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                      {mcRow ? `#${mcRow.predictedRank}` : "—"}
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                      {mcRow ? `${pct(mcRow.winProbability)}%` : "—"}
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                      {xgbRow ? `#${xgbRow.predictedRank}` : "—"}
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-[#a3a9b8]">
                      {xgbRow ? `${pct(xgbRow.winProbability)}%` : "—"}
                    </td>
                    <td className="hud-mono py-1.5 text-right text-[10px] uppercase tracking-wider text-slate-500">
                      {r.closerModel === "monte-carlo" ? "MC" : r.closerModel === "xgboost" ? "XGB" : r.closerModel === "tie" ? "tie" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

/** Section 8 (glossary): short collapsible list of plain-English terms. */
function Glossary() {
  const terms: [string, string][] = [
    ["Monte Carlo", "Simulates the race thousands of times with random variation, and counts how often each driver wins or finishes where."],
    ["XGBoost", "A machine-learning model trained on past races, predicting finishing position from grid slot, form and reliability."],
    ["Blend", "The production prediction: a weighted mix of Monte Carlo and XGBoost (see the pipeline strip above for this race's weights)."],
    ["Log loss", "A scoring rule for probability predictions — lower is better, 0 would mean perfect certainty in what actually happened."],
    ["Miss", "Actual finish minus predicted rank. Negative means the model rated a driver too low (they did better than expected)."],
  ];
  return (
    <details className="group">
      <summary className="font-heading cursor-pointer list-none text-xl font-extrabold uppercase tracking-wide text-[#f2f3f5] hover:text-red-400">
        <span className="mr-2 inline-block text-base transition-transform group-open:rotate-90">▶</span>
        Glossary
      </summary>
      <dl className="mt-3 flex flex-col gap-2">
        {terms.map(([term, def]) => (
          <div key={term} className="text-sm">
            <dt className="font-semibold text-[#f2f3f5]">{term}</dt>
            <dd className="text-[#a3a9b8]">{def}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function PredictionReviewTable({ review }: { review: PredictionReview }) {
  return (
    <div className="mt-8 flex flex-col gap-10">
      <VerdictBanner review={review} />

      <ActualPodium review={review} />

      <div className="flex flex-col gap-5">
        <SectionHeading eyebrow="How this prediction was made" title="The pipeline" />
        <PipelineStrip review={review} />
      </div>

      <BiggestMisses rows={review.rows} />

      <RetirementsSection review={review} />

      <FullFieldTable review={review} />

      <ModelComparison review={review} />

      <Glossary />
    </div>
  );
}
