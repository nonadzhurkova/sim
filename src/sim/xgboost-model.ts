import { readFileSync } from "fs";
import { join } from "path";

/**
 * Loads and evaluates the XGBoost model trained once by
 * scripts/xgboost/train.py (offline, manual, on the full 2014-2026
 * historical CSVs) and exported as plain nested tree JSON — NOT XGBoost's
 * native model file format, which encodes extra internal bookkeeping
 * (categorical split flags, per-tree stats) that a hand-written reader
 * would have to reproduce exactly to avoid silently wrong predictions.
 * scripts/xgboost/train.py's export_trees() docstring covers this in
 * detail. This lets a race prediction run entirely inside the Next.js
 * process — no Python, no subprocess — so it works the same in local dev
 * and on a read-only deployment filesystem (e.g. Vercel): only reading a
 * committed file, never writing one at request time.
 *
 * Retraining (scripts/xgboost/train.py) is a separate, occasional, manual
 * step — run it again to fold in more seasons or a refreshed
 * data/historical/ snapshot, then commit the regenerated model.json.
 * Nothing here retrains; it only evaluates the frozen model against
 * whatever live feature values the caller supplies.
 */

type TreeNode = {
  nodeid: number;
  leaf?: number;
  split?: string;
  split_condition?: number;
  yes?: number;
  no?: number;
  missing?: number;
  children?: TreeNode[];
};

type XgboostModel = {
  features: string[];
  featureMedians: Record<string, number>;
  calibration: { a: number; b: number };
  finishPositionRegressor: { baseScore: number; trees: TreeNode[] };
  dnfClassifier: { baseScore: number; trees: TreeNode[] };
};

let cachedModel: XgboostModel | null = null;

function loadModel(): XgboostModel {
  if (cachedModel) return cachedModel;
  const path = join(process.cwd(), "scripts", "xgboost", "model", "model.json");
  cachedModel = JSON.parse(readFileSync(path, "utf-8"));
  return cachedModel!;
}

/** Returns null if scripts/xgboost/train.py hasn't been run yet. */
export function xgboostModelAvailable(): boolean {
  try {
    loadModel();
    return true;
  } catch {
    return false;
  }
}

function evalTree(node: TreeNode, features: Record<string, number>): number {
  if (node.leaf != null) return node.leaf;
  const value = features[node.split!];

  let nextId: number | undefined;
  if (node.split_condition == null) {
    // Binary/one-hot feature split (e.g. an era_* dummy): no threshold or
    // missing branch. Empirically verified against XGBoost's own
    // .predict() (not documented) — truthy (1) goes to "no", falsy (0)
    // goes to "yes", the OPPOSITE of the numeric-split convention below.
    nextId = value ? node.no : node.yes;
  } else if (value == null || Number.isNaN(value)) {
    // XGBoost sends a missing feature down the tree's designated "missing"
    // branch rather than treating it as, say, 0 or -Infinity.
    nextId = node.missing;
  } else {
    // XGBoost stores split thresholds as float32 and compares in float32
    // internally. Comparing in JS's native float64 can disagree with the
    // model's own branch choice when a value and a threshold round to the
    // identical float32 (e.g. 8.8 and 8.80000019 are both float32(8.8)) but
    // differ in float64 — verified empirically to cause real mispredictions.
    nextId = Math.fround(value) < Math.fround(node.split_condition) ? node.yes : node.no;
  }

  const next = node.children?.find((c) => c.nodeid === nextId);
  if (!next) throw new Error(`XGBoost tree walk: child node ${nextId} not found`);
  return evalTree(next, features);
}

function evalForest(trees: TreeNode[], baseScore: number, features: Record<string, number>): number {
  return baseScore + trees.reduce((sum, t) => sum + evalTree(t, features), 0);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function logit(p: number): number {
  const c = Math.min(1 - 1e-4, Math.max(1e-4, p));
  return Math.log(c / (1 - c));
}

export type XgboostFeatureInput = {
  driverId: number;
  grid: number;
  qualiGapToPole: number | null;
  driverFormFinish: number | null;
  driverDnfRate: number | null;
  constructorFormFinish: number | null;
  constructorDnfRate: number | null;
  era: "hybrid_narrow_2014_2016" | "hybrid_wide_2017_2021" | "ground_effect_2022_2026";
};

export type XgboostPrediction = {
  driverId: number;
  predFinishPosition: number;
  predDnfProb: number;
  winProbability: number;
};

/**
 * Scores one race's entrants: predicted finish position, DNF probability,
 * and a calibrated win probability (Platt-scaled, then renormalized across
 * the field the same way run-simulation.ts's calibrateOutcome does for the
 * production model's own calibration).
 */
export function predictRace(entrants: XgboostFeatureInput[]): XgboostPrediction[] {
  const model = loadModel();

  const rows = entrants.map((e) => {
    const filled: Record<string, number> = {
      grid: e.grid,
      qualiGapToPole: e.qualiGapToPole ?? model.featureMedians.qualiGapToPole,
      driverFormFinish: e.driverFormFinish ?? model.featureMedians.driverFormFinish,
      driverDnfRate: e.driverDnfRate ?? model.featureMedians.driverDnfRate,
      constructorFormFinish: e.constructorFormFinish ?? model.featureMedians.constructorFormFinish,
      constructorDnfRate: e.constructorDnfRate ?? model.featureMedians.constructorDnfRate,
      era_hybrid_narrow_2014_2016: e.era === "hybrid_narrow_2014_2016" ? 1 : 0,
      era_hybrid_wide_2017_2021: e.era === "hybrid_wide_2017_2021" ? 1 : 0,
      era_ground_effect_2022_2026: e.era === "ground_effect_2022_2026" ? 1 : 0,
    };
    const predFinishPosition = evalForest(model.finishPositionRegressor.trees, model.finishPositionRegressor.baseScore, filled);
    const dnfLogit = evalForest(model.dnfClassifier.trees, logit(model.dnfClassifier.baseScore), filled);
    const predDnfProb = sigmoid(dnfLogit);
    return { driverId: e.driverId, predFinishPosition, predDnfProb };
  });

  const strengths = rows.map((r) => Math.exp(-r.predFinishPosition));
  const strengthSum = strengths.reduce((a, b) => a + b, 0);
  const rawWinProb = rows.map((_, i) => strengths[i] / strengthSum);

  const calibrated = rawWinProb.map((p) => sigmoid(model.calibration.a * logit(p) + model.calibration.b));
  const calibratedSum = calibrated.reduce((a, b) => a + b, 0);

  return rows.map((r, i) => ({
    driverId: r.driverId,
    predFinishPosition: r.predFinishPosition,
    predDnfProb: r.predDnfProb,
    winProbability: calibratedSum > 0 ? calibrated[i] / calibratedSum : rawWinProb[i],
  }));
}
