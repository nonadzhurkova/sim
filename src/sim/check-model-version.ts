import { execSync } from "child_process";

/**
 * Warns (does not fail the run) when src/sim/params.ts has changed since the
 * commit that last set MODEL_VERSION, on any line other than MODEL_VERSION
 * itself. MODEL_VERSION exists specifically so a stored prediction can be
 * told apart from one made under different model settings (see
 * run-simulation.ts's getFrozenPrediction) — that only works if it's
 * actually bumped whenever a param change would affect a run's output, and
 * a hand-maintained constant like this will eventually get forgotten. This
 * is a nudge at the point someone is about to trust a backtest/calibration
 * number, not a hard gate — a false positive (params.ts touched for a
 * comment-only change) costs nothing but a line of output.
 */
export function checkModelVersionFreshness(): void {
  try {
    const lastBumpCommit = execSync('git log -1 --format=%H -S"MODEL_VERSION = " -- src/sim/params.ts', {
      encoding: "utf-8",
    }).trim();
    if (!lastBumpCommit) {
      console.warn("[model-version] Could not find a commit that set MODEL_VERSION — skipping freshness check.");
      return;
    }

    const diff = execSync(`git diff ${lastBumpCommit} HEAD -- src/sim/params.ts`, { encoding: "utf-8" });
    const workingTreeDiff = execSync("git diff HEAD -- src/sim/params.ts", { encoding: "utf-8" });

    const changedOutsideVersionLine = [diff, workingTreeDiff].some((d) =>
      d
        .split("\n")
        .some((line) => (line.startsWith("+") || line.startsWith("-")) && !line.includes("MODEL_VERSION")),
    );

    if (changedOutsideVersionLine) {
      console.warn(
        "\n[model-version] WARNING: src/sim/params.ts has changed since MODEL_VERSION was last bumped, " +
          "but MODEL_VERSION itself hasn't moved. If this change affects what a simulation run outputs, " +
          "bump MODEL_VERSION in src/sim/params.ts so stored predictions can be told apart from ones made " +
          "under these settings.\n",
      );
    }
  } catch (err) {
    // Not a git repo, git not installed, or some other environment quirk --
    // this check is a convenience, never worth failing a backtest run over.
    console.warn(`[model-version] Freshness check skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
