import type { KalmanState } from "./kalman";

/**
 * Starting priors for a driver with no history yet.
 *
 * A rookie's rating currently falls back to `null` in the existing model,
 * which then either drops out of the pace blend entirely or forces a bad
 * default elsewhere. Kalman filtering needs an explicit starting point, and
 * the sensible one is "as good as whatever we already know about the team,"
 * not "average of the whole field" — a driver joining the fastest team
 * should start closer to that team's pace, not the grid midpoint.
 */

/** Uncertainty (variance) assigned to a brand-new driver with zero history. */
export const ROOKIE_PRIOR_VARIANCE = 1.0; // ~1s std dev — deliberately wide

/** Uncertainty when even a team-mate's pace is unknown (both drivers new). */
export const FIELD_PRIOR_VARIANCE = 1.5;

/**
 * Builds a rookie's starting state: their team-mate's current estimate if
 * one exists (same car, so the closest available proxy for expected pace),
 * else the field mean, in both cases with high variance so the very next
 * observation can move the estimate substantially.
 */
export function rookiePrior(
  teammateEstimate: KalmanState | null,
  fieldMeanPace: number,
): KalmanState {
  if (teammateEstimate) {
    // Slightly widen the team-mate's own uncertainty rather than reuse it
    // directly — a new driver in the same car is not guaranteed to perform
    // like their team-mate, just more likely to than a random field member.
    return { mean: teammateEstimate.mean, variance: teammateEstimate.variance + 0.3 };
  }
  return { mean: fieldMeanPace, variance: FIELD_PRIOR_VARIANCE };
}

/**
 * Prior for a driver's circuit-type deviation (their pace at, say, street
 * circuits relative to their own overall pace). Centred on zero — "no known
 * affinity" — with variance tuned so it takes several same-type races before
 * this deviation is trusted much, which is what makes the hierarchical
 * structure behave like automatic shrinkage instead of a fixed 0.35 weight.
 */
export const CIRCUIT_TYPE_PRIOR: KalmanState = { mean: 0, variance: 0.25 };
