import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * CLI: npm run simulate -- <season> <round> [iterations]
 * Prints the predicted probabilities without touching the UI — the quickest
 * way to sanity-check model changes against a known race.
 */
async function main() {
  const { db } = await import("@/db");
  const { races } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { runAndStoreSimulation } = await import("./run-simulation");
  const { DEFAULT_ITERATIONS } = await import("./params");

  const [, , seasonArg, roundArg, iterArg] = process.argv;
  if (!seasonArg || !roundArg) {
    console.error("usage: npm run simulate -- <season> <round> [iterations]");
    process.exit(1);
  }
  const season = parseInt(seasonArg, 10);
  const round = parseInt(roundArg, 10);
  const iterations = iterArg ? parseInt(iterArg, 10) : DEFAULT_ITERATIONS;

  const [race] = await db
    .select({ id: races.id })
    .from(races)
    .where(and(eq(races.season, season), eq(races.round, round)));
  if (!race) {
    console.error(`No race found for ${season} round ${round}`);
    process.exit(1);
  }

  const started = Date.now();
  const result = await runAndStoreSimulation(race.id, iterations);
  const elapsed = Date.now() - started;

  console.log(
    `\n${season} round ${round} — ${result.iterations} iterations in ${elapsed}ms ` +
      `(grid: ${result.hasRealGrid ? "real qualifying" : "simulated"})\n`,
  );
  console.log("  DRIVER                 WIN%   POD%   PTS%   DNF%   AVG FIN  PACE");
  for (const d of result.drivers.slice(0, 20)) {
    console.log(
      `  ${d.driverName.padEnd(22)}` +
        `${(d.winPct * 100).toFixed(1).padStart(5)}  ` +
        `${(d.podiumPct * 100).toFixed(1).padStart(5)}  ` +
        `${(d.pointsPct * 100).toFixed(1).padStart(5)}  ` +
        `${(d.dnfPct * 100).toFixed(1).padStart(5)}  ` +
        `${(d.avgFinishPosition ?? 0).toFixed(1).padStart(7)}  ` +
        `${d.expectedPace >= 0 ? "+" : ""}${d.expectedPace.toFixed(3)}`,
    );
  }
  const winSum = result.drivers.reduce((s, d) => s + d.winPct, 0);
  console.log(`\n  (win probabilities sum to ${(winSum * 100).toFixed(1)}%)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
