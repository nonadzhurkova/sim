import { config } from "dotenv";
config({ path: ".env.local" });

/** CLI: npm run backtest -- <season> [iterations] [--model=bayesian|ensemble] [--weight=0.5] */
async function main() {
  const { backtestSeason, attachWinnerNames, DEFAULT_ENSEMBLE_WEIGHT } = await import("./backtest");
  const args = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--model=") && !a.startsWith("--weight="));
  const modelArg = process.argv.find((a) => a.startsWith("--model="))?.split("=")[1];
  const paceModel = modelArg === "bayesian" ? "bayesian" : modelArg === "ensemble" ? "ensemble" : "current";
  const weightArg = process.argv.find((a) => a.startsWith("--weight="))?.split("=")[1];
  const ensembleWeight = weightArg ? parseFloat(weightArg) : DEFAULT_ENSEMBLE_WEIGHT;
  const [seasonArg, iterArg] = args;
  const season = seasonArg ? parseInt(seasonArg, 10) : 2026;
  const iterations = iterArg ? parseInt(iterArg, 10) : 4000;

  const started = Date.now();
  const summary = await attachWinnerNames(
    await backtestSeason(season, iterations, undefined, paceModel, ensembleWeight),
  );
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const modelLabel = paceModel === "ensemble" ? `ensemble w=${ensembleWeight}` : paceModel;
  console.log(
    `\n=== BACKTEST ${season} [model=${modelLabel}] — ${summary.races.length} races, ${iterations} iters each (${elapsed}s) ===\n`,
  );
  console.log("  RND  ACTUAL WINNER          MODEL RANK   P(win)   PODIUM HITS   MAE   RHO");
  for (const r of summary.races) {
    console.log(
      `  ${String(r.round).padStart(3)}  ${(r.actualWinner ?? "?").padEnd(22)}` +
        `${String(r.winnerPredictedRank ?? "-").padStart(6)}    ` +
        `${r.winnerProbability != null ? (r.winnerProbability * 100).toFixed(1).padStart(6) : "     -"}  ` +
        `${String(r.podiumHits).padStart(9)}/3   ` +
        `${r.meanAbsPositionError != null ? r.meanAbsPositionError.toFixed(2).padStart(4) : "   -"}  ` +
        `${r.rankCorrelation != null ? r.rankCorrelation.toFixed(2).padStart(5) : "    -"}`,
    );
  }

  console.log(`\n  --- HEADLINE ---`);
  console.log(`  Winner was model's top pick : ${(summary.top1Accuracy * 100).toFixed(1)}%`);
  console.log(`  Winner in model's top 3     : ${(summary.top3Accuracy * 100).toFixed(1)}%`);
  console.log(`  Mean log loss (lower=better): ${summary.meanLogLoss.toFixed(3)}`);
  console.log(`  Mean abs position error     : ${summary.meanAbsPositionError.toFixed(2)} places`);
  console.log(`  Mean rank correlation       : ${summary.meanRankCorrelation.toFixed(3)}`);

  console.log(`\n  --- CALIBRATION (predicted vs actual win rate) ---`);
  console.log("  BAND        PREDICTED   ACTUAL   N     VERDICT");
  for (const b of summary.calibration) {
    if (b.count === 0) continue;
    const diff = b.actual - b.predicted;
    const verdict =
      Math.abs(diff) < 0.03 ? "good" : diff > 0 ? `under-confident` : `over-confident`;
    console.log(
      `  ${b.label.padEnd(10)}  ${(b.predicted * 100).toFixed(1).padStart(7)}%  ` +
        `${(b.actual * 100).toFixed(1).padStart(6)}%  ${String(b.count).padStart(4)}  ${verdict}`,
    );
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
