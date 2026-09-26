/**
 * Post-hoc probability calibration (Platt scaling) for the model's raw win
 * probabilities.
 *
 * The Monte Carlo engine's winPct is already a real probability estimate,
 * but the backtest's calibration table has repeatedly shown it isn't a
 * perfectly honest one — some probability bands are over-confident, others
 * under-confident (see project memory). This does not change who the model
 * picks as favourite (it's a monotonic transform, so rank order — and
 * therefore top-1/top-3 accuracy — is unaffected); it only reshapes the
 * reported percentage so that "the model says 30%" actually happens ~30%
 * of the time.
 *
 * Standard Platt scaling: fit a 2-parameter logistic regression mapping the
 * raw probability's logit to the actual binary outcome,
 * calibrated = sigmoid(a * logit(raw) + b), by maximum likelihood.
 */

export type PlattParams = { a: number; b: number };

/** Numerically safe logit — raw probabilities of exactly 0 or 1 are clipped first. */
const CLIP_EPSILON = 1e-4;

function clip(p: number): number {
  return Math.min(1 - CLIP_EPSILON, Math.max(CLIP_EPSILON, p));
}

function logit(p: number): number {
  const c = clip(p);
  return Math.log(c / (1 - c));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Fits Platt scaling parameters by gradient descent on the logistic-regression
 * negative log-likelihood. The problem is convex in (a, b), so plain batch
 * gradient descent with a fixed learning rate converges reliably for a
 * 2-parameter fit at this data scale (hundreds of points) — no need for a
 * full IRLS/Newton implementation.
 */
export function fitPlattScaling(
  points: { p: number; won: boolean }[],
  options: { iterations?: number; learningRate?: number } = {},
): PlattParams {
  const { iterations = 5000, learningRate = 0.05 } = options;
  if (points.length === 0) return { a: 1, b: 0 };

  const xs = points.map((pt) => logit(pt.p));
  const ys = points.map((pt) => (pt.won ? 1 : 0));
  const n = xs.length;

  // a=1, b=0 starts as the identity transform (no correction), so an early
  // stop or a degenerate dataset never makes calibration worse than raw.
  let a = 1;
  let b = 0;

  for (let iter = 0; iter < iterations; iter++) {
    let gradA = 0;
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      const pred = sigmoid(a * xs[i] + b);
      const err = pred - ys[i];
      gradA += err * xs[i];
      gradB += err;
    }
    a -= (learningRate * gradA) / n;
    b -= (learningRate * gradB) / n;
  }

  return { a, b };
}

/** Applies a fitted Platt transform to one raw probability. */
export function applyCalibration(rawP: number, params: PlattParams): number {
  return sigmoid(params.a * logit(rawP) + params.b);
}
