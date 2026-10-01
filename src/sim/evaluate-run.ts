import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * CLI: npm run evaluate -- [--seasons=2024,2025,2026] [--modes=real-grid,pre-quali]
 *                          [--iterations=4000] [--seed=1] [--resamples=5000]
 *
 * Runs src/sim/evaluate.ts's shared harness: scores the current production
 * Monte Carlo model and per-fold XGBoost models (see scripts/xgboost/model/
 * fold-<season>.json -- generate with `python scripts/xgboost/train.py
 * --train-until <season> --out scripts/xgboost/model/fold-<season>.json`)
 * against the same races, plus uniform/grid/standings baselines, then
 * reports a paired bootstrap for "is this difference real."
 *
 * Read-only: makes no DB writes and does not touch production params,
 * calibration, or scripts/xgboost/model/model.json. See README's
 * "Evaluation harness" section for the full design and how to read the
 * output.
 */
import type { EvalMode, EvalModelName, ModelSummary } from "./evaluate";

function parseArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=")[1];
}

const DEFAULT_SEASONS = [2024, 2025, 2026];
const DEFAULT_MODES: EvalMode[] = ["real-grid", "pre-quali"];

async function main() {
  // Dynamic imports, not static ones -- config() above must run before any
  // module that reads DATABASE_URL at import time (src/db/index.ts) is
  // evaluated, and ES module imports are hoisted above top-level statements
  // regardless of source order. Same pattern as backtest-run.ts/
  // calibrate-run.ts.
  const { existsSync, mkdirSync, writeFileSync } = await import("fs");
  const { join } = await import("path");
  const { execSync } = await import("child_process");
  const { evaluateModels, logLossMap, pairedBootstrap } = await import("./evaluate");
  const { MODEL_VERSION, PACE_WEIGHTS, PACE_NOISE_STD_DEV, QUALI_NOISE_STD_DEV, WIN_PROBABILITY_CALIBRATION } = await import("./params");

  const seasons = (parseArg("seasons")?.split(",").map((s) => parseInt(s.trim(), 10)) ?? DEFAULT_SEASONS).sort((a, b) => a - b);
  const modes = (parseArg("modes")?.split(",").map((s) => s.trim()) as EvalMode[] | undefined) ?? DEFAULT_MODES;
  const iterations = parseInt(parseArg("iterations") ?? "4000", 10);
  const seed = parseInt(parseArg("seed") ?? "1", 10);
  const resamples = parseInt(parseArg("resamples") ?? "5000", 10);

  const modelDir = join(process.cwd(), "scripts", "xgboost", "model");
  const xgboostFoldPaths = new Map<number, string>();
  for (const season of seasons) {
    const foldPath = join(modelDir, `fold-${season}.json`);
    if (existsSync(foldPath)) xgboostFoldPaths.set(season, foldPath);
  }
  const missingFolds = seasons.filter((s) => !xgboostFoldPaths.has(s));
  if (missingFolds.length > 0) {
    console.log(
      `Note: no fold model found for season(s) ${missingFolds.join(", ")} -- XGBoost will be reported as n/a for ` +
        `those. Generate one with:\n` +
        missingFolds.map((s) => `  python scripts/xgboost/train.py --train-until ${s} --out scripts/xgboost/model/fold-${s}.json`).join("\n") +
        "\n",
    );
  }

  console.log(`Evaluating seasons [${seasons.join(", ")}] x modes [${modes.join(", ")}], ${iterations} MC iterations, seed=${seed}...\n`);
  const started = Date.now();
  const result = await evaluateModels({ seasons, modes, iterations, seed, xgboostFoldPaths });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s.\n`);

  // --- Summary table ---
  const modelOrder: EvalModelName[] = ["monte-carlo", "xgboost", "xgboost-raw", "uniform", "grid-baseline", "standings-baseline"];
  const printSummaryRow = (s: ModelSummary) => {
    console.log(
      `  ${s.model.padEnd(20)} ${String(s.raceCount).padStart(4)}   ` +
        `${(s.top1Accuracy * 100).toFixed(1).padStart(5)}%  ${(s.top3Accuracy * 100).toFixed(1).padStart(5)}%  ` +
        `${s.meanLogLoss.toFixed(3).padStart(7)}  ${s.meanBrier.toFixed(3).padStart(6)}  ${s.meanRankCorrelation.toFixed(3).padStart(6)}`,
    );
  };

  for (const mode of modes) {
    console.log(`\n=== MODE: ${mode} ===`);
    for (const season of seasons) {
      const summaries = result.bySeasonAndMode.get(`${season}:${mode}`);
      if (!summaries) continue;
      console.log(`\n--- Season ${season} ---`);
      console.log("  MODEL                N     TOP1%   TOP3%   LOGLOSS  BRIER   RANKCORR");
      for (const name of modelOrder) {
        const s = summaries.get(name);
        if (s) printSummaryRow(s);
        else if (name === "xgboost" || name === "xgboost-raw") console.log(`  ${name.padEnd(20)}  n/a (no grid mode / no fold model)`);
      }
    }

    console.log(`\n--- Pooled (${seasons.join("+")}) ---`);
    const pooled = result.pooledByMode.get(mode);
    if (pooled) {
      console.log("  MODEL                N     TOP1%   TOP3%   LOGLOSS  BRIER   RANKCORR");
      for (const name of modelOrder) {
        const s = pooled.get(name);
        if (s) printSummaryRow(s);
        else if (name === "xgboost" || name === "xgboost-raw") console.log(`  ${name.padEnd(20)}  n/a`);
      }

      console.log(`\n  Worst 3 races by log loss (pooled ${seasons.join("+")}), per model:`);
      for (const name of modelOrder) {
        const s = pooled.get(name);
        if (!s || s.worstRaces.length === 0) continue;
        console.log(`  ${name}:`);
        for (const r of s.worstRaces) {
          console.log(
            `    ${r.season} R${r.round} (raceId ${r.raceId}): winner=driver#${r.winnerId ?? "?"} ` +
              `grid=${r.winnerGridPosition ?? "?"} p(win)=${r.winnerProb != null ? r.winnerProb.toFixed(4) : "?"} ` +
              `logLoss=${r.logLoss != null ? r.logLoss.toFixed(3) : "?"}`,
          );
        }
      }
    }
  }

  // --- Excluded races ---
  if (result.excludedRaces.length > 0) {
    console.log(`\n\n=== EXCLUDED RACES (${result.excludedRaces.length}) ===`);
    for (const r of result.excludedRaces) {
      console.log(`  ${r.season} R${r.round} (raceId ${r.raceId}): ${r.reason}`);
    }
  }

  // --- Bootstrap: MC vs XGBoost, and each vs best baseline ---
  console.log(`\n\n=== BOOTSTRAP (${resamples} resamples, races as the resampling unit) ===`);
  const bootstrapRows: Record<string, unknown>[] = [];
  for (const mode of modes) {
    const pooled = result.pooledByMode.get(mode);
    if (!pooled) continue;
    console.log(`\n--- Mode: ${mode} ---`);

    const mc = pooled.get("monte-carlo");
    const xgb = pooled.get("xgboost");
    if (mc && xgb) {
      const boot = pairedBootstrap(logLossMap(mc.perRace), logLossMap(xgb.perRace), { resamples, seed });
      console.log(
        `  Monte Carlo vs XGBoost (log loss, MC - XGB): mean diff = ${boot.meanDiff.toFixed(4)}, ` +
          `95% CI [${boot.ci95[0].toFixed(4)}, ${boot.ci95[1].toFixed(4)}] (n=${boot.n}) -- ` +
          `${boot.significant ? (boot.meanDiff < 0 ? "MC significantly better" : "XGBoost significantly better") : "not significant"}`,
      );
      bootstrapRows.push({ mode, comparison: "monte-carlo vs xgboost", ...boot });
    } else {
      console.log(`  Monte Carlo vs XGBoost: n/a (XGBoost has no predictions in this mode)`);
    }

    // Explicit MC vs the mode's headline baseline: grid position in
    // real-grid mode (the honest "how much does the model beat just knowing
    // where everyone starts" comparison), standings in pre-quali mode (grid
    // doesn't exist yet pre-qualifying, so standings is the closest
    // equivalent "what you'd know without simulating anything").
    const headlineBaselineName: EvalModelName = mode === "real-grid" ? "grid-baseline" : "standings-baseline";
    const headlineBaseline = pooled.get(headlineBaselineName);
    if (mc && headlineBaseline) {
      const boot = pairedBootstrap(logLossMap(mc.perRace), logLossMap(headlineBaseline.perRace), { resamples, seed: seed + 2 });
      console.log(
        `  Monte Carlo vs ${headlineBaselineName} (log loss, MC - baseline): mean diff = ${boot.meanDiff.toFixed(4)}, ` +
          `95% CI [${boot.ci95[0].toFixed(4)}, ${boot.ci95[1].toFixed(4)}] (n=${boot.n}) -- ` +
          `${boot.significant ? (boot.meanDiff < 0 ? "MC significantly better" : `${headlineBaselineName} significantly better`) : "not significant"}`,
      );
      bootstrapRows.push({ mode, comparison: `monte-carlo vs ${headlineBaselineName}`, ...boot });
    }

    for (const [modelName, summary] of pooled) {
      if (modelName === "monte-carlo" || modelName === "uniform") continue;
      const baselineNames: EvalModelName[] = ["uniform", "grid-baseline", "standings-baseline"];
      if (baselineNames.includes(modelName)) continue;
      let bestBaseline: ModelSummary | null = null;
      for (const bName of baselineNames) {
        const b = pooled.get(bName);
        if (b && (!bestBaseline || b.meanLogLoss < bestBaseline.meanLogLoss)) bestBaseline = b;
      }
      if (!bestBaseline) continue;
      const boot = pairedBootstrap(logLossMap(summary.perRace), logLossMap(bestBaseline.perRace), { resamples, seed: seed + 1 });
      console.log(
        `  ${modelName} vs best baseline (${bestBaseline.model}): mean diff = ${boot.meanDiff.toFixed(4)}, ` +
          `95% CI [${boot.ci95[0].toFixed(4)}, ${boot.ci95[1].toFixed(4)}] (n=${boot.n}) -- ` +
          `${boot.significant ? (boot.meanDiff < 0 ? `${modelName} significantly better` : `${bestBaseline.model} significantly better`) : "not significant"}`,
      );
      bootstrapRows.push({ mode, comparison: `${modelName} vs best baseline (${bestBaseline.model})`, ...boot });
    }
  }

  // --- Save JSON ---
  const commit = (() => {
    try {
      return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    } catch {
      return "unknown";
    }
  })();
  const shortCommit = commit === "unknown" ? "unknown" : commit.slice(0, 8);
  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(process.cwd(), "eval-results");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${date}-${shortCommit}.json`);

  const jsonOut = {
    generatedAt: new Date().toISOString(),
    gitCommit: commit,
    modelVersion: MODEL_VERSION,
    options: { seasons, modes, iterations, seed, resamples },
    params: {
      PACE_WEIGHTS,
      PACE_NOISE_STD_DEV,
      QUALI_NOISE_STD_DEV,
      WIN_PROBABILITY_CALIBRATION,
    },
    xgboostFoldPaths: Object.fromEntries(xgboostFoldPaths),
    bySeasonAndMode: Object.fromEntries([...result.bySeasonAndMode.entries()].map(([k, v]) => [k, Object.fromEntries(v)])),
    pooledByMode: Object.fromEntries([...result.pooledByMode.entries()].map(([k, v]) => [k, Object.fromEntries(v)])),
    excludedRaces: result.excludedRaces,
    bootstrap: bootstrapRows,
  };
  writeFileSync(outPath, JSON.stringify(jsonOut, (_key, value) => (value instanceof Map ? Object.fromEntries(value) : value), 2));
  console.log(`\n\nFull results saved to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
