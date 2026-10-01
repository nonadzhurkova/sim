import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * CLI: npm run evaluate:blend -- [--iterations=4000] [--seed=1] [--resamples=5000]
 *
 * Eval-only MC + XGBoost-raw blend (see evaluate.ts's blendPredictions):
 * blendWinPct[driver] = alpha * mcWinPct[driver] + (1-alpha) * xgbRawWinPct[driver],
 * renormalized. Real-grid mode only -- XGBoost has no pre-quali mode. Sweeps
 * alpha in [0, 1] in steps of 0.1 (1.0 = pure Monte Carlo, 0.0 = pure
 * XGBoost-raw), tuned on 2024+2025 pooled, checked on the untouched 2026
 * holdout, then bootstraps the best alpha against pure MC, pure XGBoost-raw,
 * and grid-baseline pooled across all three seasons.
 *
 * Does not change any production param, calibration, or model.json --
 * purely a report. Requires scripts/xgboost/model/fold-2024.json and
 * fold-2025.json (fold-2026.json only needed for the 2026 check).
 */
import type { EvalMode, ModelRacePrediction, PerRaceScore } from "./evaluate";

function parseArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=")[1];
}

const SEASONS = [2024, 2025, 2026];
const TUNE_SEASONS = [2024, 2025];
const HOLDOUT_SEASON = 2026;
const ALPHAS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const MODE: EvalMode = "real-grid";

async function main() {
  const { existsSync } = await import("fs");
  const { join } = await import("path");
  const {
    loadCompletedRaces,
    loadActualResults,
    predictMonteCarlo,
    predictXgboost,
    predictGridBaseline,
    blendPredictions,
    scoreModel,
    summarizeScores,
    pairedBootstrap,
    logLossMap,
  } = await import("./evaluate");

  const iterations = parseInt(parseArg("iterations") ?? "4000", 10);
  const seed = parseInt(parseArg("seed") ?? "1", 10);
  const resamples = parseInt(parseArg("resamples") ?? "5000", 10);

  const modelDir = join(process.cwd(), "scripts", "xgboost", "model");
  const xgboostFoldPaths = new Map<number, string>();
  for (const season of SEASONS) {
    const foldPath = join(modelDir, `fold-${season}.json`);
    if (existsSync(foldPath)) xgboostFoldPaths.set(season, foldPath);
  }
  const missing = SEASONS.filter((s) => !xgboostFoldPaths.has(s));
  if (missing.length > 0) {
    console.log(`Note: no fold model for season(s) ${missing.join(", ")} -- those seasons are skipped entirely (blend needs both models).\n`);
  }

  console.log(`MC + XGBoost-raw blend sweep: alpha in [${ALPHAS.join(", ")}], tuning on ${TUNE_SEASONS.join("+")}, checking on ${HOLDOUT_SEASON}.\n`);

  // Load once per season: completed races, actuals, MC predictions, XGBoost-raw
  // predictions, grid-baseline. Shared race set = races both MC and XGBoost
  // (and grid-baseline) actually predicted -- same rule evaluateModels uses.
  type SeasonData = {
    season: number;
    actualByRaceId: Map<number, Awaited<ReturnType<typeof loadActualResults>>>;
    mc: ModelRacePrediction[];
    xgbRaw: ModelRacePrediction[];
    grid: ModelRacePrediction[];
    sharedRaceIds: Set<number>;
  };
  const seasonData: SeasonData[] = [];

  for (const season of SEASONS) {
    if (!xgboostFoldPaths.has(season)) continue;
    const started = Date.now();
    const completedRaces = await loadCompletedRaces(season);
    const actualByRaceId = new Map<number, Awaited<ReturnType<typeof loadActualResults>>>();
    for (const race of completedRaces) actualByRaceId.set(race.id, await loadActualResults(race.id));

    const mc = await predictMonteCarlo(completedRaces, MODE, iterations, seed);
    const xgbRaw = await predictXgboost(completedRaces, MODE, xgboostFoldPaths.get(season)!, true);
    const grid = await predictGridBaseline(completedRaces);

    const mcIds = new Set(mc.map((p) => p.raceId));
    const xgbIds = new Set(xgbRaw.map((p) => p.raceId));
    const gridIds = new Set(grid.map((p) => p.raceId));
    const sharedRaceIds = new Set(completedRaces.map((r) => r.id).filter((id) => mcIds.has(id) && xgbIds.has(id) && gridIds.has(id)));

    seasonData.push({ season, actualByRaceId, mc, xgbRaw, grid, sharedRaceIds });
    console.log(`Loaded ${season}: ${sharedRaceIds.size} shared races (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
  console.log();

  const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  type AlphaRow = { alpha: number; tunePerRace: PerRaceScore[]; holdoutPerRace: PerRaceScore[] };
  const rows: AlphaRow[] = [];

  for (const alpha of ALPHAS) {
    const tunePerRace: PerRaceScore[] = [];
    const holdoutPerRace: PerRaceScore[] = [];
    for (const sd of seasonData) {
      const blend = blendPredictions(sd.mc, sd.xgbRaw, alpha);
      const perRace = scoreModel(blend, sd.actualByRaceId, sd.sharedRaceIds);
      if (TUNE_SEASONS.includes(sd.season)) tunePerRace.push(...perRace);
      if (sd.season === HOLDOUT_SEASON) holdoutPerRace.push(...perRace);
    }
    rows.push({ alpha, tunePerRace, holdoutPerRace });
  }

  console.log(`=== Alpha sweep, pooled ${TUNE_SEASONS.join("+")} (tuning, N=${rows[0].tunePerRace.length}) ===`);
  console.log("  ALPHA   LOGLOSS  BRIER   TOP1%");
  for (const row of rows) {
    const s = summarizeScores("monte-carlo", MODE, "pooled", row.tunePerRace);
    console.log(`  ${String(row.alpha).padEnd(7)} ${s.meanLogLoss.toFixed(4).padStart(7)}  ${s.meanBrier.toFixed(4).padStart(6)}  ${(s.top1Accuracy * 100).toFixed(1).padStart(5)}%`);
  }

  const bestRow = rows.reduce((best, row) => {
    const bestLoss = summarizeScores("monte-carlo", MODE, "pooled", best.tunePerRace).meanLogLoss;
    const rowLoss = summarizeScores("monte-carlo", MODE, "pooled", row.tunePerRace).meanLogLoss;
    return rowLoss < bestLoss ? row : best;
  });
  console.log(`\nBest alpha by pooled ${TUNE_SEASONS.join("+")} log loss: ${bestRow.alpha}`);

  const holdoutHasData = rows[0].holdoutPerRace.length > 0;
  if (holdoutHasData) {
    console.log(`\n=== ${HOLDOUT_SEASON} holdout, best 3 alphas by tuning log loss ===`);
    const ranked = [...rows].sort(
      (a, b) =>
        summarizeScores("monte-carlo", MODE, "pooled", a.tunePerRace).meanLogLoss -
        summarizeScores("monte-carlo", MODE, "pooled", b.tunePerRace).meanLogLoss,
    );
    console.log("  ALPHA   LOGLOSS  BRIER   TOP1%");
    for (const row of ranked.slice(0, 3)) {
      const s = summarizeScores("monte-carlo", MODE, "pooled", row.holdoutPerRace);
      console.log(`  ${String(row.alpha).padEnd(7)} ${s.meanLogLoss.toFixed(4).padStart(7)}  ${s.meanBrier.toFixed(4).padStart(6)}  ${(s.top1Accuracy * 100).toFixed(1).padStart(5)}%`);
    }
  } else {
    console.log(`\n${HOLDOUT_SEASON} holdout: n/a (no fold model)`);
  }

  // Pooled across all seasons with data, for the bootstrap comparisons.
  const allPerRace = (alpha: number) => {
    const out: PerRaceScore[] = [];
    for (const sd of seasonData) {
      const blend = blendPredictions(sd.mc, sd.xgbRaw, alpha);
      out.push(...scoreModel(blend, sd.actualByRaceId, sd.sharedRaceIds));
    }
    return out;
  };
  const pureMcPerRace = (() => {
    const out: PerRaceScore[] = [];
    for (const sd of seasonData) out.push(...scoreModel(sd.mc, sd.actualByRaceId, sd.sharedRaceIds));
    return out;
  })();
  const pureXgbPerRace = (() => {
    const out: PerRaceScore[] = [];
    for (const sd of seasonData) out.push(...scoreModel(sd.xgbRaw, sd.actualByRaceId, sd.sharedRaceIds));
    return out;
  })();
  const gridPerRace = (() => {
    const out: PerRaceScore[] = [];
    for (const sd of seasonData) out.push(...scoreModel(sd.grid, sd.actualByRaceId, sd.sharedRaceIds));
    return out;
  })();
  const bestBlendPerRace = allPerRace(bestRow.alpha);

  const bestBlendSummary = summarizeScores("monte-carlo", MODE, "pooled", bestBlendPerRace);
  const mcSummary = summarizeScores("monte-carlo", MODE, "pooled", pureMcPerRace);
  const xgbSummary = summarizeScores("xgboost-raw", MODE, "pooled", pureXgbPerRace);
  const gridSummary = summarizeScores("grid-baseline", MODE, "pooled", gridPerRace);

  console.log(`\n=== Pooled (all seasons with fold models, N=${bestBlendPerRace.length}) ===`);
  console.log("  MODEL              LOGLOSS  BRIER   TOP1%   TOP3%");
  const printRow = (name: string, s: typeof bestBlendSummary) =>
    console.log(
      `  ${name.padEnd(18)} ${s.meanLogLoss.toFixed(4).padStart(7)}  ${s.meanBrier.toFixed(4).padStart(6)}  ${(s.top1Accuracy * 100).toFixed(1).padStart(5)}%  ${(s.top3Accuracy * 100).toFixed(1).padStart(5)}%`,
    );
  printRow(`blend (alpha=${bestRow.alpha})`, bestBlendSummary);
  printRow("pure monte-carlo", mcSummary);
  printRow("pure xgboost-raw", xgbSummary);
  printRow("grid-baseline", gridSummary);

  console.log(`\n=== BOOTSTRAP (${resamples} resamples) -- best blend (alpha=${bestRow.alpha}) vs each ===`);
  for (const [name, otherPerRace] of [
    ["pure monte-carlo", pureMcPerRace],
    ["pure xgboost-raw", pureXgbPerRace],
    ["grid-baseline", gridPerRace],
  ] as const) {
    const boot = pairedBootstrap(logLossMap(bestBlendPerRace), logLossMap(otherPerRace), { resamples, seed });
    console.log(
      `  blend vs ${name}: mean diff = ${boot.meanDiff.toFixed(4)}, 95% CI [${boot.ci95[0].toFixed(4)}, ${boot.ci95[1].toFixed(4)}] (n=${boot.n}) -- ` +
        `${boot.significant ? (boot.meanDiff < 0 ? "blend significantly better" : `${name} significantly better`) : "not significant"}`,
    );
  }

  console.log(`\n=== Calibration buckets, best blend (alpha=${bestRow.alpha}) ===`);
  console.log("  BAND        PREDICTED  ACTUAL   COUNT");
  for (const bucket of bestBlendSummary.calibration) {
    console.log(`  ${bucket.label.padEnd(11)} ${(bucket.predicted * 100).toFixed(1).padStart(7)}%  ${(bucket.actual * 100).toFixed(1).padStart(6)}%  ${String(bucket.count).padStart(5)}`);
  }

  console.log(`\n=== Worst 3 races by log loss ===`);
  const printWorst = (name: string, perRace: PerRaceScore[]) => {
    const worst = [...perRace.filter((r) => r.logLoss != null)].sort((a, b) => b.logLoss! - a.logLoss!).slice(0, 3);
    console.log(`  ${name}:`);
    for (const r of worst) {
      console.log(
        `    ${r.season} R${r.round} (raceId ${r.raceId}): winner=driver#${r.winnerId ?? "?"} grid=${r.winnerGridPosition ?? "?"} ` +
          `p(win)=${r.winnerProb != null ? r.winnerProb.toFixed(4) : "?"} logLoss=${r.logLoss!.toFixed(3)}`,
      );
    }
  };
  printWorst(`blend (alpha=${bestRow.alpha})`, bestBlendPerRace);
  printWorst("pure monte-carlo", pureMcPerRace);
  printWorst("pure xgboost-raw", pureXgbPerRace);

  console.log(`\n=== MC vs XGBoost-raw strong disagreements (one >40%, other <10%, same race) ===`);
  const mcByRace = new Map(seasonData.flatMap((sd) => sd.mc.map((p) => [p.raceId, p])));
  const xgbByRace = new Map(seasonData.flatMap((sd) => sd.xgbRaw.map((p) => [p.raceId, p])));
  const actualByRace = new Map(seasonData.flatMap((sd) => [...sd.actualByRaceId.entries()]));
  let disagreements = 0;
  for (const sd of seasonData) {
    for (const raceId of sd.sharedRaceIds) {
      const mcPred = mcByRace.get(raceId)!;
      const xgbPred = xgbByRace.get(raceId)!;
      const actual = actualByRace.get(raceId)!;
      const winnerId = actual.find((a) => a.finishPosition === 1)?.driverId;
      for (const driverId of mcPred.winProbByDriver.keys()) {
        const mcP = mcPred.winProbByDriver.get(driverId) ?? 0;
        const xgbP = xgbPred.winProbByDriver.get(driverId) ?? 0;
        if ((mcP > 0.4 && xgbP < 0.1) || (xgbP > 0.4 && mcP < 0.1)) {
          disagreements++;
          console.log(
            `  ${sd.season} R? (raceId ${raceId}) driver#${driverId}: MC=${(mcP * 100).toFixed(1)}% XGB=${(xgbP * 100).toFixed(1)}% ` +
              `${driverId === winnerId ? "(WON)" : ""}`,
          );
        }
      }
    }
  }
  if (disagreements === 0) console.log("  none found");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
