/**
 * A one-dimensional Kalman filter over a scalar "true pace" that drifts
 * slowly over time, observed noisily once per race/qualifying session.
 *
 * This replaces the fixed-half-life exponential average in decay.ts with
 * something that adapts its own effective half-life per driver: a rookie
 * with one race has huge uncertainty, so the next observation moves their
 * estimate a lot; a driver with 40 races of consistent form has tight
 * uncertainty, so one odd result barely moves them. The exponential-decay
 * model treats both cases identically.
 *
 * State is never stored — every caller replays a driver's history through
 * this filter from a prior, which costs the same O(races) as the existing
 * weightedAverage() and keeps this consistent with how the rest of the
 * ratings pipeline already works (see project memory: recompute over
 * persisted state, to avoid stored state drifting from corrected results).
 */

export type KalmanState = {
  /** Current best estimate of the true value. */
  mean: number;
  /** Uncertainty (variance) around that estimate. Shrinks with more data. */
  variance: number;
};

/**
 * How much the true value is expected to drift between observations
 * (process noise). Without this, variance only ever shrinks and an old
 * observation from 40 races ago would carry the same weight as the pace a
 * driver actually has now — form changes, cars are developed, this term is
 * what makes recent observations matter more without a hand-picked half-life.
 */
export type FilterParams = {
  /** Variance added per race of elapsed time, representing true drift. */
  processVariancePerRace: number;
  /** Variance of a single observation (how noisy one data point is). */
  observationVariance: number;
};

/**
 * Advances the filter by one time step (a race) with no observation —
 * uncertainty grows because the true value may have drifted since the last
 * observation.
 */
function predict(state: KalmanState, params: FilterParams, racesElapsed: number): KalmanState {
  return {
    mean: state.mean,
    variance: state.variance + params.processVariancePerRace * racesElapsed,
  };
}

/**
 * Incorporates one new observation, producing a posterior that blends the
 * prior estimate and the new data weighted by their relative confidence —
 * the standard scalar Kalman update.
 */
function update(state: KalmanState, params: FilterParams, observation: number): KalmanState {
  const kalmanGain = state.variance / (state.variance + params.observationVariance);
  return {
    mean: state.mean + kalmanGain * (observation - state.mean),
    variance: (1 - kalmanGain) * state.variance,
  };
}

/**
 * Runs a full history of observations through the filter, oldest first,
 * starting from `prior`. Each entry's `racesSincePrevious` lets the caller
 * pass gaps (e.g. a driver who missed races through injury) so drift is
 * measured in elapsed races, not observation count.
 */
export function runFilter(
  prior: KalmanState,
  params: FilterParams,
  observations: { value: number; racesSincePrevious: number }[],
): KalmanState {
  let state = prior;
  for (const obs of observations) {
    state = predict(state, params, obs.racesSincePrevious);
    state = update(state, params, obs.value);
  }
  return state;
}

/**
 * The filter's estimate for "now" (one prediction step past the last
 * observation, with no new data), for when a rating is needed for a race
 * that hasn't happened yet — the mean is unchanged but uncertainty reflects
 * however long it's been since the driver's last relevant session.
 */
export function projectForward(
  state: KalmanState,
  params: FilterParams,
  racesElapsed: number,
): KalmanState {
  return predict(state, params, racesElapsed);
}
