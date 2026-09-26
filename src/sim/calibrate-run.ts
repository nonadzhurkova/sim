import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * CLI: npm run calibrate -- [trainSeasons] [holdoutSeason] [iterations]
 * Default: fit Platt scaling on 2025+2026 (already used to tune other
 * params), validate cold on 2024 — the one season nothing else has been
 * calibrated against. Prints log loss and the calibration table before and
 * after, on the holdout only, since that's the honest test.
 */
async function main() {
  const { backtestSeason } = await import("./backtest");
  const { fitPlattScaling, applyCalibration } = await import("./calibration");

  const [, , trainArg, holdoutArg, iterArg] = process.argv;
  const trainSeasons = trainArg ? trainArg.split(",").map((s) => parseInt(s, 10)) : [2025, 2026];
  const holdoutSeason = holdoutArg ? parseInt(holdoutArg, 10) : 2024;
  const iterations = iterArg ? parseInt(iterArg, 10) : 3000;

  console.log(`Fitting Platt scaling on seasons [${trainSeasons.join(", ")}], validating on ${holdoutSeason}...\n`);

  const trainSummaries = await Promise.all(trainSeasons.map((s) => backtestSeason(s, iterations)));
  const trainPoints = trainSummaries.flatMap((s) => s.calibrationPoints);
  console.log(`Training points: ${trainPoints.length}`);

  const params = fitPlattScaling(trainPoints);
  console.log(`Fitted Platt params: a=${params.a.toFixed(4)} b=${params.b.toFixed(4)}\n`);

  const holdout = await backtestSeason(holdoutSeason, iterations);
  const rawPoints = holdout.calibrationPoints;
  const calibratedPoints = rawPoints.map((pt) => ({ p: applyCalibration(pt.p, params), won: pt.won }));

  const LOG_LOSS_FLOOR = 1e-4;
  const logLossOf = (points: { p: number; won: boolean }[]) => {
    const winnerPoints = points.filter((pt) => pt.won);
    if (winnerPoints.length === 0) return 0;
    return (
      winnerPoints.reduce((sum, pt) => sum - Math.log(Math.max(pt.p, LOG_LOSS_FLOOR)), 0) / winnerPoints.length
    );
  };

  console.log(`=== HOLDOUT: ${holdoutSeason} (${iterations} iters) ===`);
  console.log(`Raw mean log loss:        ${logLossOf(rawPoints).toFixed(3)}`);
  console.log(`Calibrated mean log loss: ${logLossOf(calibratedPoints).toFixed(3)}\n`);

  const { buildCalibration } = await import("./backtest");
  console.log("--- RAW calibration ---");
  printTable(buildCalibration(rawPoints));
  console.log("\n--- CALIBRATED calibration ---");
  printTable(buildCalibration(calibratedPoints));
}

function printTable(buckets: { label: string; predicted: number; actual: number; count: number }[]) {
  console.log("  BAND        PREDICTED   ACTUAL   N     VERDICT");
  for (const b of buckets) {
    if (b.count === 0) continue;
    const diff = b.actual - b.predicted;
    const verdict = Math.abs(diff) < 0.03 ? "good" : diff > 0 ? "under-confident" : "over-confident";
    console.log(
      `  ${b.label.padEnd(10)}  ${(b.predicted * 100).toFixed(1).padStart(7)}%  ` +
        `${(b.actual * 100).toFixed(1).padStart(6)}%  ${String(b.count).padStart(4)}  ${verdict}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
