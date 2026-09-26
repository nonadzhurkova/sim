# f1sym

A Formula 1 race and season outcome predictor. Ingests real race data, turns
it into per-driver pace/reliability ratings, and runs a Monte Carlo
simulation to produce win/podium/points probabilities — shown live in a
Next.js app and validated against real results via a backtest harness.

## Pipeline

```
ingest → ratings → sim → (calibrate / backtest)
```

- **`src/ingest/`** — pulls race results, qualifying, and session/lap data
  from external sources (Jolpica, OpenF1) into Postgres (Neon, via Drizzle
  ORM). `npm run ingest`.
- **`src/ratings/`** — turns raw history into per-driver, per-race ratings:
  base pace, reliability (DNF rate), practice pace, qualifying form, race
  form, track affinity, car strength, race craft. Computed using only
  pre-race data, so a past race can be backtested honestly — the model never
  sees information it wouldn't have had on race morning. `npm run ratings`.
- **`src/sim/`** — the Monte Carlo engine and everything around it: building
  a race's entrant list from ratings (`entrants.ts`), running the simulation
  (`engine.ts`), calibrating win probabilities (`calibration.ts`), and
  backtesting predictions against real results (`backtest.ts`).
  `npm run simulate`, `npm run backtest`, `npm run calibrate`.
- **`src/app/`** — the Next.js UI: home page, driver/team pages, standings,
  and a per-race page with a live simulation view and a post-race analysis
  view.

## How the simulation works

For a given race, `buildSimContext` (`src/sim/entrants.ts`) assembles the
starting field: each driver's real grid position (or a simulated one, if
qualifying hasn't happened), expected race pace, and DNF probability.

Expected pace is a weighted combination of independent signals
(`PACE_WEIGHTS` in `src/sim/params.ts`):

| signal | what it captures |
|---|---|
| `basePace` | season-long field-relative pace rating |
| `practicePace` | this weekend's long-run pace from FP sessions |
| `racePaceProjection` | live projection from practice, refined as FP sessions land |
| `carStrength` | team-level pace, derived from race pace |
| `trackAffinity` | driver's pace at this circuit *type* vs. their overall average |
| `qualiForm` | recent one-lap (qualifying) pace, distinct from race pace |
| `raceForm` | recent race pace over the driver's last few races |

Weights are renormalized over whichever signals are actually present, so a
missing signal doesn't penalize a driver — the rest just carry more weight.

`runSimulation` (`src/sim/engine.ts`) then runs thousands of iterations
(default 8,000). Each iteration:

1. Establishes a grid (real, or simulated from qualifying form + noise).
2. Samples each driver's race pace from their expected pace plus Gaussian
   noise (`PACE_NOISE_STD_DEV`) — this represents everything the ratings
   don't model: tyre luck, traffic, on-the-day form.
3. Rolls a DNF per driver from their reliability rating.
4. Rolls a safety car (probability varies by circuit type), which compresses
   the field's pace spread and adds extra shuffle noise — this is what
   actually reorders the field around a safety car, not the compression
   itself.
5. Converts pace + grid into a finishing order via a per-circuit-type grid
   penalty (how hard the track is to overtake on) and tallies the result.

Win/podium/points probabilities are just the fraction of iterations each
outcome occurred in. Raw win probabilities are then passed through a
**Platt-scaling calibration** (`src/sim/calibration.ts`) — a monotonic
transform fitted against real outcomes so a "30% to win" pick actually wins
about 30% of the time. This never changes who the model favors, only how
honest the stated percentage is.

### Simulation pattern

The engine (`simulationIterator` in `src/sim/engine.ts`) is a plain
generator — a synchronous, CPU-bound loop with no async work inside it —
that yields a progress snapshot every `progressInterval` iterations instead
of running to completion in one blocking call:

```
runSimulation(ctx, iterations)              # drains the generator synchronously
  └─ simulationIterator(ctx, iterations)     # the actual loop, one yield per progressInterval
        for each iteration:
          1. grid        — real quali order, or simulate one (pace + quali noise, ranked)
          2. race pace    — expectedPace + Gaussian noise (widened by paceUncertainty)
          3. retirements  — Bernoulli roll per driver from dnfRate
          4. safety car   — Bernoulli roll; if true, compress pace spread + add shuffle noise
          5. grid penalty — effective pace += (grid position - 1) * per-circuit-type penalty
          6. finishing order = sort by effective pace, DNFs last
          → tally: wins / podiums / points / dnf / grid / finish-position, per driver
        yield snapshot(tallies)  # lets a caller stream partial results / let the event loop breathe
      return final SimulationOutcome
```

Two call sites drain this differently:
- `runSimulation` (used by the backtest, where nothing needs to stream) just
  calls `.next()` until done and returns the final value.
- `run-simulation.ts` (used by the live app) consumes it as a generator, so a
  browser can see win probabilities converge iteration-by-iteration instead
  of waiting for all 8,000 to finish — and applies calibration
  (`calibrateOutcome`) at that boundary, right before a result is persisted,
  streamed, or returned, never inside the engine itself.

Scratch arrays (`grid`, `effectivePace`, `retired`, `order`) are allocated
once outside the loop and reused every iteration — at 8,000 iterations × ~20
cars, per-iteration allocation would be a meaningful share of runtime.

### Variables at a glance

**Pace composition weights** (`PACE_WEIGHTS`, `src/sim/params.ts`) — combined
via a renormalized weighted average in `composePace` (`entrants.ts`):

| variable | value | meaning |
|---|---|---|
| `basePace` | 1.0 | season-long field-relative pace rating |
| `practicePace` | 1.4 | this weekend's FP long-run pace |
| `racePaceProjection` | 1.6 | live projection from practice, refined as FP sessions land |
| `carStrength` | 0.6 | team-level pace (derived from race pace — weighted down to avoid double-counting) |
| `trackAffinity` | 0.35 | driver's pace at this circuit type vs. their own overall average |
| `qualiForm` | 0.6 | recent one-lap pace |
| `raceForm` | 0.6 | recent race pace over the driver's last few races |

**Engine constants** (`src/sim/params.ts`), each a knob the backtest sweeps
to calibrate:

| variable | value | meaning |
|---|---|---|
| `PACE_NOISE_STD_DEV` | 0.35 | per-lap race pace noise (sec/lap std dev) — the single biggest calibration knob; too low and the favorite always wins, too high and it's a coin toss |
| `QUALI_NOISE_STD_DEV` | 0.28 | extra noise for a simulated (not-yet-run) qualifying session |
| `QUALI_FORM_BLEND` | 0.5 | how much recent quali form vs. race pace determines a simulated grid |
| `GRID_PENALTY_PER_POSITION` | street 0.26 / technical 0.21 / high_speed 0.18 | effective pace cost per grid slot, by circuit type — the single largest accuracy lever found so far |
| `GRID_PENALTY_DEFAULT` | 0.2 | fallback when circuit type is unknown |
| `RACE_CRAFT_WEIGHT` | 0 (disabled) | how much grid-slot-conversion skill shifts effective starting position — real effect, too noisy to help predictions |
| `SAFETY_CAR_PROBABILITY` | street 0.72 / technical 0.45 / high_speed 0.38 | per-race chance of a safety car, by circuit type |
| `SAFETY_CAR_PROBABILITY_DEFAULT` | 0.5 | fallback when circuit type is unknown |
| `SAFETY_CAR_COMPRESSION` | 0.65 | fraction of pace spread retained under a safety car |
| `SAFETY_CAR_SHUFFLE_FACTOR` | 0.3 | extra noise multiplier during a safety car — this, not compression, is what actually reorders finishers |
| `PACE_UNCERTAINTY_WEIGHT` | 0 (disabled) | how much a driver's own rating uncertainty widens their pace noise — tested, rejected |
| `WIN_PROBABILITY_CALIBRATION` | `{ a: 0.6698, b: -0.3283 }` | Platt-scaling params: `calibrated = sigmoid(a * logit(raw) + b)` |
| `DEFAULT_DNF_RATE` | 0.08 | fallback reliability for a driver with no history |
| `MIN_DNF_RATE` / `MAX_DNF_RATE` | 0.01 / 0.35 | clamps so one bad recent run of luck can't make a driver a near-certain retirement |
| `POINTS_BY_POSITION` | `[25,18,15,12,10,8,6,4,2,1]` | championship points for positions 1-10 |
| `DEFAULT_ITERATIONS` | 8000 | Monte Carlo iterations per race prediction |
| `DEFAULT_SEASON_ITERATIONS` (`season.ts`) | 2000 | iterations per race when projecting a whole season (lower, for UI responsiveness across many races) |

## Validation

Every constant in `params.ts` is calibrated, not guessed — the backtest
harness (`src/sim/backtest.ts`) replays past races using only pre-race data
and scores predictions against what actually happened, via:

- **Top-1 / top-3 accuracy** — was the actual winner the model's favorite /
  in its top 3?
- **Log loss** — how confident was the model in the actual winner, penalizing
  confident wrongness far more than cautious wrongness. The metric behind
  the calibration work above.
- **Mean rank correlation / position error** — how close was the *whole*
  predicted order to the real one, not just the winner.

The project's working discipline: sweep a candidate constant against the
backtest on one or two seasons, then confirm the direction holds on a season
untouched by that sweep, before adopting it. 2024, 2025, and 2026 are all
ingested; 2024 is reserved as a holdout for validating new changes once
2025/2026 have both been used to tune existing constants.

### What's been tried

Adopted: hand-tuned pace weights and grid penalties (the single largest
accuracy gain — raising the grid penalty alone lifted top-1 accuracy from
36% to 64%), a dedicated race-form signal, and Platt-scaling calibration.

Built, tested, and rejected — kept only as reference/comparison tools where
noted:

- A full lap-by-lap race simulation (more mechanistic detail, worse
  predictions than the aggregate pace model).
- A Bayesian (Kalman-filter) pace rating — lost to the hand-tuned rating on
  a held-out season.
- Per-iteration pace noise scaled by that Bayesian model's uncertainty —
  log loss got monotonically worse.
- Race-craft (grid-slot-conversion skill) as a pace/grid adjustment — a real
  historical effect too small and noisy to survive contact with race-to-race
  variance.
- An ensemble blending hand-tuned and Bayesian pace ratings — no blend weight
  beat the better pure model on both tuning seasons.
- Jointly fitting all pace weights via a Plackett-Luce ranking likelihood
  instead of one-at-a-time sweeps — improved two seasons but regressed the
  third by a similar margin, consistent with overfitting on ~50 races.

The recurring finding: with ~14-24 scorable races per season, more
statistically sophisticated models consistently overfit rather than out-predict
the simpler hand-tuned weights — so far, only better-calibrating the existing
model's confidence (not building a fancier one) has produced a validated
improvement.

## Development

```
npm install
npm run dev            # start the app
npm run ingest          # pull latest race data
npm run ratings         # recompute ratings from ingested data
npm run backtest -- 2026 4000     # backtest a season at N iterations
npm run calibrate -- 2024,2025,2026 2024   # fit Platt-scaling calibration
```

Requires a `.env.local` with a Neon Postgres connection string.
