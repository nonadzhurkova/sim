# f1sym

A Formula 1 race and season outcome predictor. Ingests real race data, turns
it into per-driver pace/reliability ratings, and runs a Monte Carlo
simulation to produce win/podium/points probabilities — shown live in a
Next.js app and validated against real results via a backtest harness.

## Pipeline

```
ingest → ratings → sim → (calibrate / backtest)
```

- **`src/ingest/`** — pulls race results, qualifying, sprint results, and
  session/lap data (including sprint and sprint-qualifying sessions) from
  external sources (Jolpica, OpenF1) into Postgres (Neon, via Drizzle ORM).
  `npm run ingest`. A single import covers both a main race weekend and, if
  the calendar entry marks it as one, a sprint weekend — sprint points feed
  the standings via `sprintPointsForPosition` (8-7-6-5-4-3-2-1 for P1-P8),
  kept separate from race wins/podiums in the standings calculation.
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
- **`src/app/`** — the Next.js UI: a home page leading with the next race's
  top-3 win chances, championship odds, and a season calendar with
  sprint-weekend badges; a `/races` schedule page; a drivers table (points,
  base pace, DNF rate); driver/team pages; standings; a per-race page led by
  a tabbed Monte Carlo/XGBoost prediction, then a weekend session schedule
  (live from OpenF1, not the DB — see `session-schedule/route.ts`); a
  telemetry analysis subpage; a prediction-review subpage that compares both
  models against an already-decided race, driver by driver, sorted by actual
  finishing order; and a `/model` page for the data-import/freshness status
  and the model's own driver/team ratings — see `DESIGN.md` for the full
  page-by-page breakdown and the reasoning behind this layout.

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

`qualiForm` (and `basePace`'s own qualifying component) combine a driver's
per-race qualifying history with a **trimmed mean**: the single best and
single worst race in the recency window are dropped before averaging. This
replaced a plain recency-weighted mean after a real case surfaced it: a
driver with an excellent qualifying record for most of a season had one
genuinely anomalous session (a Q1-exit-level result, ~3s off pole against a
normal ~0.3s) that, under the 5-race half-life, dominated his rating and
made him look mediocre relative to a rival who simply qualified once
recently. Validated on 2025+2026 pooled: log loss 1.221→1.210 alongside
`basePace`'s own trim (combined: →1.189), top-1 53.8%→56.4% (qualiForm trim
alone; combined moved back to 53.8%, read as noise at n=39 — see Validation
below), and — the clearest signal — calibration in the model's own
highest-confidence band went from ~80% predicted / 50% actual to 75% / 65%,
substantially closing a real overconfidence gap. A weighted-median
alternative was also tried; statistically tied with the trimmed mean on
aggregate metrics, so the simpler, more-data-retaining trim was kept.

`runSimulation` (`src/sim/engine.ts`) then runs thousands of iterations
(default 8,000). Each iteration:

1. Establishes a grid — the real one if qualifying has happened, or a
   simulated one otherwise (`simulatedQualiPace` in `entrants.ts`, shared by
   both the single-race engine and the season projection so the two can't
   silently diverge — they once did: a driver's `qualiForm` was blended
   into `expectedPace`, which already includes `qualiForm` at its own
   weight, double-counting it and measurably skewing simulated grids toward
   whoever had the strongest recent qualifying form. Fixed by blending
   against a qualiForm-free pace base instead).
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

### Single-race vs. season projection

There are two independent simulations in the app, and their per-race numbers
for the *same* race can legitimately differ slightly:

- **Single-race** (`engine.ts`, the "Race Prediction — Monte Carlo" panel on
  a race page): simulates only that one race, with its own dedicated
  iteration budget (2,000-20,000, user-selectable).
- **Season projection** (`season.ts`, the home page's championship-odds
  panel and its "Race-by-Race Predictions" summary): simulates the *entire
  remaining calendar in one correlated run*, repeated `DEFAULT_SEASON_ITERATIONS`
  (2,000) times total — so any one race's per-driver win share is drawn from
  a much smaller effective sample than a dedicated single-race run gets.

Both read the same `buildSimContext`/`expectedPace`/ratings, apply the same
calibration, and — after `season.ts`'s `simulateRaceOrder` was found to be
silently missing the `raceCraft` grid-position offset that `engine.ts`
applies (harmless today, since that weight is 0, but a real divergence that
would have silently reappeared the moment race craft was ever re-enabled) —
now run the same per-iteration race logic. A real, substantial gap between
the two for the same race is still worth investigating, but a close call
between two near-tied drivers (a percentage-point or two apart) landing in
a different order on each panel is expected sampling noise from the season
panel's smaller per-race budget, verified directly: a single-race run at
matching (2,000) iterations reproduces the same order flip on a different
seed, for the same race, with no code difference at all.

### Frozen prediction log

Every simulation run (Monte Carlo, via `runAndStoreSimulation`/`streamSimulation` in `run-simulation.ts`) and every
XGBoost call (`/api/xgboost-predict`) is stamped with `predictedBeforeRace` (was the race's date still in the
future at the moment this run was created?) and `modelVersion` (`MODEL_VERSION` in `params.ts`, hand-bumped
whenever a change would alter what a run outputs for the same race). This exists so "what did the model predict
for this race" has an honest answer: `getFrozenPrediction`/`getFrozenXgboostPrediction` return the *most recent
run made before the race happened*, not the most recent run overall — re-running a simulation before the race is
still refining a genuine prediction, but a run made after the result is known would misrepresent history if shown
as a prior forecast. The prediction-review page prefers this frozen record and only falls back to a live replay
(clearly labelled as reconstructed) when no pre-race run exists for that race yet.

### Variables at a glance

**Pace composition weights** (`PACE_WEIGHTS`, `src/sim/params.ts`) — combined
via a renormalized weighted average in `composePace` (`entrants.ts`):

| variable | value | meaning |
|---|---|---|
| `basePace` | 1.0 | season-long field-relative pace rating |
| `practicePace` | 1.4 | this weekend's FP long-run pace |
| `racePaceProjection` | 1.6 | live projection from practice, refined as FP sessions land |
| `carStrength` | 0.6 | team-level pace (derived from race pace — weighted down to avoid double-counting) |
| `trackAffinity` | 0.35 | driver's pace at this circuit type vs. their own overall average — requires ≥3 same-circuit-type races (below that, returns null rather than a single-race number) and clips any one race's pace contribution to ±3s before averaging, after a genuine case produced a raw value nearly double a typical `basePace` magnitude from one very bad race dominating an 11-race average |
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
| `WIN_PROBABILITY_CALIBRATION` | `{ a: 0.7697, b: -0.2061 }` | Platt-scaling params: `calibrated = sigmoid(a * logit(raw) + b)` |
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
- **Calibration buckets** (`buildCalibration` in `backtest.ts`) — group every
  predicted win probability into bands (0-2%, 2-5%, ..., 60-100%) and compare
  the band's mean predicted probability to how often those picks actually
  won. A well-calibrated model has predicted ≈ actual in every band. This
  check sat unused for most of the project's history in favor of top-1/log
  loss alone, until it caught a real, substantial overconfidence problem in
  the 60-100% band (see the qualifying-form fix above) — worth checking
  whenever a change targets *which* predictions the model is confident about,
  not just whether its favorite wins.

The project's working discipline: sweep a candidate constant against the
backtest on one or two seasons, then confirm the direction holds on a season
untouched by that sweep, before adopting it. At 15-24 scorable races per
season, a single race's outcome is worth several accuracy points — treat a
one-race swing in top-1/top-3 as noise unless it's corroborated by log loss
or calibration, which use every driver's probability in every race and are
far more stable at this sample size. 2024, 2025, and 2026 are all ingested
and share one regulation era (`ground_effect_2022_2026`); 2024 is reserved
as a holdout for validating new changes once 2025/2026 have both been used
to tune existing constants, though a change validated only on 2025/2026 and
checked cold on 2024 is on genuinely equal footing across all three, not
just "sanity checked."

### What's been tried

Adopted: hand-tuned pace weights and grid penalties (the single largest
accuracy gain — raising the grid penalty alone lifted top-1 accuracy from
36% to 64%), a dedicated race-form signal, Platt-scaling calibration, and
(see below) an XGBoost overlay trained on a much larger historical dataset,
plus a trimmed-mean fix to qualifying-form outlier sensitivity.

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
- An XGBoost finish-position regressor + DNF classifier trained on only 2
  seasons (~800-900 rows) of this app's own ingested data (grid position,
  qualifying gap-to-pole, driver/car reliability, plus the 7 signals above)
  — the most decisive rejection of the original five: 75-79% top-1 accuracy
  on its training seasons, but log loss on the untouched 2024 holdout
  collapsed to 4.9 (worse than random guessing), a severe overfit from too
  little training data.
- Reweighting `basePace`/`carStrength` (driver skill vs. car pace) relative
  to `qualiForm`, in the specific pre-qualifying (no real grid yet) scenario
  — swept `basePace` up to 1.8x and `carStrength` down to 0.15x in
  combination; top-1 accuracy was identical (33.3%) for every weighting
  tried, and log loss barely moved. Reweighting these two signals against
  each other isn't the lever that improves pre-qualifying predictions.
- Widening `qualiForm`'s recency-decay half-life (5→8/12/20 races) and
  blending toward a season-long average, to reduce sensitivity to a short
  recent slump — both made things worse or flat on 2025+2026 pooled data.
  The season-long blend specifically backfired: "season-long" pools every
  ingested season including a driver's weaker rookie year, reintroducing a
  different bias rather than fixing the recency one. The eventual fix
  (trimmed mean, adopted above) targets the actual shape of the problem — a
  genuine single-session outlier, not a real trend — without either
  side effect.
- Blending a sprint weekend's sprint-qualifying/sprint-race pace into
  `qualiForm`/`raceForm` as extra history entries — log loss essentially
  unchanged but top-1 regressed (50.0%→45.8%) on the 2024 holdout; a
  sprint's much shorter length makes its pace less representative of true
  race/qualifying pace. Sprint *points* (for standings) and sprint
  *sessions* (for the live session-pace display) are unaffected by this
  rejection and are fully supported.

**Retested and adopted — the one exception to the pattern below:** the same
XGBoost approach, retrained on 13 seasons (2014-2026, ~5,200 rows) from a
public historical dataset instead of this app's own 2-3 seasons, genuinely
beat the production Monte Carlo model on the untouched 2024 holdout (log
loss 1.470 vs. 1.599, top-1 58.3% vs. 45.8%). The lesson that survives from
the original rejection is specifically about training-data volume, not
about gradient-boosted models being unsuitable in general. See
"XGBoost overlay" below for the architecture. Its pre-qualifying-prediction
extension (substituting a proxy for the real starting grid, which the model
has never seen missing) was tried and rejected the same way as the
`basePace`/`carStrength` reweighting above — every proxy tested (a driver's
own rolling average grid, their constructor's, a mid-pack constant)
regressed both log loss and top-1 versus the real grid.

The recurring finding: with ~14-24 scorable races per season, more
statistically sophisticated models consistently overfit rather than
out-predict the simpler hand-tuned weights *when trained on this app's own
small ingested history* — but the XGBoost retest shows that specific
failure was about data volume, not model choice: given enough historical
rows, a more expressive model can out-predict the hand-tuned one after all.
Weight-reshuffling proposals (moving accuracy around inside the existing
seven-signal formula) have a much weaker track record even with more data —
treat those with continued skepticism; treat "more expressive model, more
training data" proposals as worth testing on their own merits.

**Checked for new signal, none found (existing signals already capture what
matters, or the effect isn't real):**

- Pit-stop count/timing vs. finishing-position swing — correlation ~0.08,
  negligible.
- Tyre degradation rate (fuel-burn- and track-evolution-corrected) — real
  and physically sensible (soft tyres degrade faster than hard, as expected),
  but statistically indistinguishable between race winners and the rest of
  the field (t-stat 0.33).
- Team-level strategy skill (does a team's stop-count tendency predict
  gaining positions beyond the field) — an apparent team ranking turned out
  to be a grid-position artifact (backmarker teams simply have more room to
  gain places); adjusting for grid position just re-surfaces the existing
  car-strength pecking order, not a new signal.

**A real gap found, not yet fixed:** splitting the current model's backtest
by recorded race-day weather (`sessions.weather`, already ingested from
OpenF1) shows it is substantially worse and badly overconfident on wet
races — top-1 accuracy 30.8% (wet) vs. 55.1% (dry), log loss 2.05 vs. 1.20,
and in its most-confident (60-100%) probability band, wet races only win
37.5% of the time against a stated 72.5%. This is the clearest real finding
of the whole session — but only 13 wet races exist across all three
ingested seasons, so fitting (or even coarsely guessing) a specific
wet-weather noise/grid-penalty adjustment now risks tuning to that small
sample rather than a real effect, the same failure mode that sank the
Plackett-Luce and XGBoost attempts above. Revisit once more wet races are
ingested. Using this for *future*-race predictions (not just backtesting
known-wet past races) would also need a weather-forecast data source, which
isn't ingested yet.

## XGBoost overlay

A second, experimental prediction ("Race Prediction — XGBoost (experimental)"
on a race page, alongside the Monte Carlo one, not replacing it) trained on
13 seasons (2014-2026, ~5,200 rows) of historical data from a public dataset
(tracinginsights/RaceData), not just this app's own ingested history.

**Architecture — Python trains once, TypeScript predicts always:**

- `data/historical/*.csv` — committed CSV snapshots, deliberately *not*
  ingested into the production database (kept as flat files so training data
  and live app data stay clearly separate).
- `scripts/xgboost/train.py` — a one-time/occasional manual step. Builds a
  no-lookahead feature table (grid, quali gap-to-pole, 5-race rolling
  driver/team form, regulation era as an explicit feature), trains a
  finish-position regressor and DNF classifier, fits Platt calibration, and
  exports everything — including the trees themselves, via
  `booster.get_dump(dump_format="json")` rather than XGBoost's native model
  format, which encodes extra bookkeeping a hand-written reader would have
  to reproduce exactly — to `scripts/xgboost/model/model.json`.
- `src/sim/xgboost-model.ts` — loads that JSON and walks the trees in pure
  TypeScript. No Python, no subprocess, at request time, so it works
  identically on a read-only deployment filesystem (e.g. Vercel) as in local
  dev. Two subtle bugs had to be found and fixed here by cross-checking
  against Python's own `.predict()` output: a one-hot/binary split's
  "yes"/"no" branches are inverted relative to a numeric split's, and split
  thresholds must be compared in float32 (`Math.fround`), not JS's native
  float64.
- `src/sim/xgboost-features.ts` — computes the same live, no-lookahead
  features from the production DB for one race's actual entrants.
- Retraining (`train.py`) is separate and occasional — a future race needs
  no Python at all, only fresh DB data, once the model has been trained.

**Validated, adopted, with one confirmed limitation:** beat the production
model on the untouched 2024 holdout (log loss 1.470 vs. 1.599, top-1 58.3%
vs. 45.8%). Requires a real (or quali-derived) starting grid — every proxy
tested for the pre-qualifying case (a driver's own rolling average grid,
their constructor's, a mid-pack constant) regressed both log loss and top-1
versus the real grid, so the panel shows "no grid yet" rather than a
degraded prediction until qualifying has happened.

## Development

```
npm install
npm run dev            # start the app
npm run ingest          # pull latest race data
npm run ratings         # recompute ratings from ingested data
npm run backtest -- 2026 4000     # backtest a season at N iterations
npm run calibrate                 # fit Platt-scaling on 2025+2026, validate cold on 2024
npm run db:generate                # generate a drizzle migration after a schema.ts change
npm run db:migrate                 # apply pending migrations
```

Requires a `.env.local` with a Neon Postgres connection string. Don't fit-and-validate Platt calibration on
overlapping seasons (e.g. `npm run calibrate -- 2024,2025,2026 2024`) — that isn't a real holdout; the no-arg
default (train on 2025+2026, validate cold on 2024) is the honest version and what's actually shipped.
