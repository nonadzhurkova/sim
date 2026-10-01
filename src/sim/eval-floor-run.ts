import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * CLI: npm run evaluate:floor -- [--iterations=4000] [--seed=1] [--resamples=5000]
 *
 * Eval-only probability floor experiment (see evaluate.ts's applyProbabilityFloor):
 * p' = (1 - eps) * p + eps / N, applied to Monte Carlo's and XGBoost's (raw and
 * calibrated) win probabilities before scoring. Sweeps eps against 2024+2025 and
 * reports both those seasons and the untouched 2026 holdout for every eps, plus a
 * bootstrap of the best eps (by pooled 2024+2025 log loss) vs eps=0.
 *
 * Does not change any production param, calibration, or model.json -- purely a
 * report. Requires scripts/xgboost/model/fold-2024.json and fold-2025.json (see
 * evaluate-run.ts's own note on generating them); 2026 is scored MC-only unless
 * fold-2026.json also exists.
 */
import type { EvalMode, EvalModelName } from "./evaluate";

function parseArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=")[1];
}

const TUNE_SEASONS = [2024, 2025];
const HOLDOUT_SEASON = 2026;
const EPS_VALUES = [0, 0.005, 0.01, 0.02, 0.03, 0.05];
const MODES: EvalMode[] = ["real-grid"];

async function main() {
  const { existsSync } = await import("fs");
  const { join } = await import("path");
  const { evaluateModels, logLossMap, pairedBootstrap } = await import("./evaluate");

  const iterations = parseInt(parseArg("iterations") ?? "4000", 10);
  const seed = parseInt(parseArg("seed") ?? "1", 10);
  const resamples = parseInt(parseArg("resamples") ?? "5000", 10);

  const modelDir = join(process.cwd(), "scripts", "xgboost", "model");
  const allSeasons = [...TUNE_SEASONS, HOLDOUT_SEASON];
  const xgboostFoldPaths = new Map<number, string>();
  for (const season of allSeasons) {
    const foldPath = join(modelDir, `fold-${season}.json`);
    if (existsSync(foldPath)) xgboostFoldPaths.set(season, foldPath);
  }

  console.log(
    `Probability floor sweep: eps in [${EPS_VALUES.join(", ")}], tuning on ${TUNE_SEASONS.join("+")}, checking on ${HOLDOUT_SEASON}.\n`,
  );

  type Row = { eps: number; pooledTunePerRace: Map<EvalModelName, ReturnType<typeof logLossMap>>; holdoutPerRace: Map<EvalModelName, ReturnType<typeof logLossMap>> };
  const rows: Row[] = [];
  const modelOrder: EvalModelName[] = ["monte-carlo", "xgboost", "xgboost-raw"];

  for (const eps of EPS_VALUES) {
    const started = Date.now();
    const result = await evaluateModels({
      seasons: allSeasons,
      modes: MODES,
      iterations,
      seed,
      xgboostFoldPaths,
      probabilityFloor: eps,
    });
    console.log(`eps=${eps}: done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    const pooledTune = new Map<EvalModelName, ReturnType<typeof logLossMap>>();
    const holdout = new Map<EvalModelName, ReturnType<typeof logLossMap>>();
    for (const mode of MODES) {
      // Pool the tuning seasons' per-race scores manually -- evaluateModels
      // pools across every requested season, but the holdout season must be
      // excluded from the tuning pool it's being checked against.
      for (const modelName of modelOrder) {
        const tuneScores = new Map<number, number>();
        for (const season of TUNE_SEASONS) {
          const summary = result.bySeasonAndMode.get(`${season}:${mode}`)?.get(modelName);
          if (!summary) continue;
          for (const [raceId, loss] of logLossMap(summary.perRace)) tuneScores.set(raceId, loss);
        }
        if (tuneScores.size > 0) pooledTune.set(modelName, tuneScores);

        const holdoutSummary = result.bySeasonAndMode.get(`${HOLDOUT_SEASON}:${mode}`)?.get(modelName);
        if (holdoutSummary) holdout.set(modelName, logLossMap(holdoutSummary.perRace));
      }
    }
    rows.push({ eps, pooledTunePerRace: pooledTune, holdoutPerRace: holdout });
  }

  const meanOf = (m: Map<number, number>) => (m.size > 0 ? [...m.values()].reduce((a, b) => a + b, 0) / m.size : null);

  console.log(`\n=== Pooled ${TUNE_SEASONS.join("+")} (tuning) log loss by eps ===`);
  console.log("  EPS      " + modelOrder.map((m) => m.padEnd(14)).join(""));
  for (const row of rows) {
    const cells = modelOrder.map((m) => {
      const mean = row.pooledTunePerRace.has(m) ? meanOf(row.pooledTunePerRace.get(m)!) : null;
      return (mean != null ? mean.toFixed(4) : "n/a").padEnd(14);
    });
    console.log(`  ${String(row.eps).padEnd(8)} ${cells.join("")}`);
  }

  console.log(`\n=== ${HOLDOUT_SEASON} (holdout) log loss by eps ===`);
  console.log("  EPS      " + modelOrder.map((m) => m.padEnd(14)).join(""));
  for (const row of rows) {
    const cells = modelOrder.map((m) => {
      const mean = row.holdoutPerRace.has(m) ? meanOf(row.holdoutPerRace.get(m)!) : null;
      return (mean != null ? mean.toFixed(4) : "n/a").padEnd(14);
    });
    console.log(`  ${String(row.eps).padEnd(8)} ${cells.join("")}`);
  }

  // Best eps per model, chosen on the tuning seasons only (2026 stays a check, not a tuning input).
  console.log(`\n=== Best eps per model (by pooled ${TUNE_SEASONS.join("+")} log loss) vs eps=0 ===`);
  const baseline = rows.find((r) => r.eps === 0)!;
  for (const modelName of modelOrder) {
    if (!baseline.pooledTunePerRace.has(modelName)) {
      console.log(`  ${modelName}: n/a (no predictions)`);
      continue;
    }
    let best = baseline;
    let bestMean = meanOf(baseline.pooledTunePerRace.get(modelName)!)!;
    for (const row of rows) {
      if (!row.pooledTunePerRace.has(modelName)) continue;
      const mean = meanOf(row.pooledTunePerRace.get(modelName)!)!;
      if (mean < bestMean) {
        best = row;
        bestMean = mean;
      }
    }
    const boot = pairedBootstrap(best.pooledTunePerRace.get(modelName)!, baseline.pooledTunePerRace.get(modelName)!, {
      resamples,
      seed,
    });
    console.log(
      `  ${modelName}: best eps=${best.eps} (tune logloss ${bestMean.toFixed(4)} vs eps=0's ${meanOf(baseline.pooledTunePerRace.get(modelName)!)!.toFixed(4)}) -- ` +
        `bootstrap mean diff = ${boot.meanDiff.toFixed(4)}, 95% CI [${boot.ci95[0].toFixed(4)}, ${boot.ci95[1].toFixed(4)}] (n=${boot.n}) -- ` +
        `${boot.significant ? (boot.meanDiff < 0 ? "significantly better than eps=0" : "significantly worse than eps=0") : "not significant"}`,
    );
    if (best.holdoutPerRace.has(modelName) && baseline.holdoutPerRace.has(modelName)) {
      const holdoutBoot = pairedBootstrap(best.holdoutPerRace.get(modelName)!, baseline.holdoutPerRace.get(modelName)!, {
        resamples,
        seed,
      });
      console.log(
        `    on ${HOLDOUT_SEASON} holdout: eps=${best.eps} logloss ${meanOf(best.holdoutPerRace.get(modelName)!)!.toFixed(4)} vs eps=0's ${meanOf(baseline.holdoutPerRace.get(modelName)!)!.toFixed(4)} -- ` +
          `bootstrap mean diff = ${holdoutBoot.meanDiff.toFixed(4)}, 95% CI [${holdoutBoot.ci95[0].toFixed(4)}, ${holdoutBoot.ci95[1].toFixed(4)}] (n=${holdoutBoot.n}) -- ` +
          `${holdoutBoot.significant ? (holdoutBoot.meanDiff < 0 ? "significantly better" : "significantly worse") : "not significant"}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
