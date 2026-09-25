/**
 * Every tunable constant of the simulation model, in one place.
 *
 * The project plan's backtesting step exists specifically to calibrate these
 * numbers (does a driver rated 15% to win actually win ~15% of the time?), so
 * they are deliberately kept out of the engine code rather than scattered
 * through it as magic numbers. All pace values are in seconds per lap,
 * field-relative — the same unit every rating in src/ratings/ produces, where
 * negative means faster than the field median.
 */

/**
 * Relative weight of each pace signal when composing a driver's expected
 * race pace. These are applied to whichever signals are actually present and
 * then renormalized, so a driver missing (say) practice pace isn't penalised
 * — their remaining signals simply carry full weight.
 *
 * Practice pace is weighted highest when available because it reflects this
 * weekend's actual car/track/fuel reality, which a season-long average can't
 * capture. Base pace anchors it against a small, noisy practice sample. Car
 * strength is weighted lower than it might seem to deserve because it's
 * derived from the same race-pace data as base pace (see team-strength.ts) —
 * weighting it fully would double-count that signal.
 */
/**
 * Calibrated against the 2026 season. Dropping the practice signals entirely
 * costs a lot (log loss 1.44 -> 1.57), confirming they carry real short-term
 * information the season-long ratings miss. Track affinity is the one signal
 * that trades off against itself: raising it improves the winner's predicted
 * probability (log loss) but worsens the predicted order of the rest of the
 * field (rank correlation 0.876 -> 0.859, position error 1.67 -> 1.82), so
 * it sits at a deliberate compromise rather than at either metric's optimum.
 */
export const PACE_WEIGHTS = {
  basePace: 1.0,
  practicePace: 1.4,
  racePaceProjection: 1.6,
  carStrength: 0.6,
  trackAffinity: 0.35,
} as const;

/**
 * Per-lap pace noise (seconds, std dev) applied per driver per iteration.
 * Represents everything the ratings don't model: tyre luck, traffic, driver
 * form on the day, strategy calls. This is the single most important
 * calibration knob — too low and the favourite wins ~100% of simulations,
 * too high and the grid becomes a coin toss.
 */
/**
 * Chosen across both backtested seasons rather than either one alone: 2026
 * alone prefers ~0.25 and 2025 alone prefers ~0.45-0.55, while top-1 accuracy
 * is flat across the whole range — this knob moves how *confident* the model
 * is, not what it ranks first. 0.35 sits between the two seasons' optima and
 * corrects the over-confidence both showed in the high-probability band.
 */
export const PACE_NOISE_STD_DEV = 0.35;

/**
 * Extra noise (seconds, std dev) applied when simulating a qualifying
 * session that hasn't happened yet. Higher than race noise: a single
 * qualifying lap is far more variable than a race-distance average, and one
 * mistake or a yellow flag costs the whole session.
 */
export const QUALI_NOISE_STD_DEV = 0.28;

/**
 * How much a grid position is worth, in effective race pace (seconds/lap),
 * by circuit type. Overtaking at Monaco is near-impossible so track position
 * dominates; at a high-speed circuit with long DRS zones a fast car recovers.
 * Applied as `gridPosition * value` added to the driver's pace.
 */
/**
 * Calibrated against the 2026 season (see src/sim/backtest.ts). The initial
 * hand-guessed values (0.018-0.055) proved far too weak: they let the model
 * rank a car starting 6th ahead of the pole-sitter, while in reality pole
 * won 9 of 14 races and 26 of 42 podiums came from the top three grid slots.
 * Raising these lifted top-1 accuracy from 36% to 64% and cut log loss from
 * 2.12 to 1.46 — the single largest accuracy gain of the whole model.
 *
 * The per-type ordering is the empirical one (street punishes a bad grid slot
 * hardest, high-speed circuits least, matching how hard each is to overtake
 * on), but the ordering rests on few races per type — 2 street, 7 technical,
 * 5 high-speed — so the values are deliberately kept close together rather
 * than set to each type's own sweep optimum, which would be overfitting.
 */
export const GRID_PENALTY_PER_POSITION: Record<string, number> = {
  street: 0.26,
  technical: 0.21,
  high_speed: 0.18,
};
export const GRID_PENALTY_DEFAULT = 0.2;

/**
 * Probability that a safety car / red flag materially bunches the field, and
 * how much of each driver's pace advantage it erases when it does. A safety
 * car compresses gaps and randomises strategy, which mostly helps cars that
 * were losing — hence it scales pace differences toward zero.
 */
export const SAFETY_CAR_PROBABILITY: Record<string, number> = {
  street: 0.72,
  technical: 0.45,
  high_speed: 0.38,
};
export const SAFETY_CAR_PROBABILITY_DEFAULT = 0.5;
/** Fraction of the pace spread retained when a safety car happens. */
export const SAFETY_CAR_COMPRESSION = 0.65;
/**
 * Extra pace noise during a safety car, as a multiple of PACE_NOISE_STD_DEV.
 * This — not the compression above — is what actually reorders cars: pit-stop
 * timing luck around a safety car is the mechanism by which a race result
 * changes, whereas compression alone is order-preserving and so invisible in
 * the finishing positions.
 */
export const SAFETY_CAR_SHUFFLE_FACTOR = 0.3;

/**
 * DNF rate used for a driver with no reliability history (a rookie, or the
 * first race of the earliest ingested season). Roughly the modern-era field
 * average; better than assuming either invincibility or the field's worst.
 */
export const DEFAULT_DNF_RATE = 0.08;

/**
 * Reliability is a recency-weighted DNF rate over a short window, so a
 * driver with two recent retirements can read implausibly high (e.g. 0.6).
 * Clamping keeps one bad run of luck from making a driver a near-certain
 * retirement in every simulated race.
 */
export const MIN_DNF_RATE = 0.01;
export const MAX_DNF_RATE = 0.35;

/** Points for finishing positions 1-10, plus fastest lap ignored for now. */
export const POINTS_BY_POSITION = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

/** Default Monte Carlo iteration count — the plan's 5,000-10,000 range. */
export const DEFAULT_ITERATIONS = 8000;
