# F1 Race Predictor — Project Plan

A web app that predicts race outcomes before they happen using Monte Carlo
simulation, built on historical + current-season F1 data. F1 only for now —
F2 is a later, separate extension (see Phase 7).

## Tech stack

- **Frontend**: Next.js (App Router) + TypeScript
- **Backend**: Next.js API routes; move simulation to a separate worker if it
  gets CPU-heavy
- **Database**: PostgreSQL on Neon (branch-based dev workflow — see below)
- **ORM**: Drizzle (lighter than Prisma, closer to raw SQL for sim queries)
- **Data sources**: OpenF1 (live + historical F1 telemetry/results/stints),
  Jolpica-F1 (Ergast-compatible historical results back decades).
- **Hosting**: Vercel (app) + Neon (DB). Separate worker (Fly.io/Railway) only
  if simulation batches get heavy.

## Neon setup

- `main` branch = source of truth, real ingested data
- `dev` branch = daily local work, created off `main`
- Feature branches for risky schema changes, merged back once solid
- Free tier auto-suspends on idle — expect brief cold start after inactivity

---

## Phase 1 — Foundation

- [ ] Create Neon project, `main` and `dev` branches
- [ ] Scaffold Next.js + TypeScript app, connect Drizzle to Neon
- [ ] Design and migrate schema (see Data model below)
- [ ] Set up `.env` for local dev pointing at the `dev` branch

## Phase 2 — Ingestion

- [ ] Jolpica-F1 bulk backfill script: seasons, races, results, qualifying,
      as far back as desired
- [ ] OpenF1 ingestion job: sessions, laps, stints, weather, pit stops for
      recent/live sessions
- [ ] Normalize both sources into the shared schema; upsert logic to avoid
      duplicates on re-runs
- [ ] Schedule ingestion (Vercel Cron or similar) so new race data lands
      automatically after each round

## Phase 3 — Rating model

- [ ] Base pace rating per driver: weighted average of qualifying gap-to-pole
      and race pace over last N races, exponential recency decay
- [ ] Reliability rating: DNF probability split into car-caused (team/engine
      level, shared by teammates) vs driver-caused (crashes, spins) — needs
      multi-season history for sample size
- [ ] Track affinity: adjust pace by circuit type (street/high-speed/
      technical) using multi-season history
- [ ] Team/car strength this season, tracked separately from driver skill so
      mid-season upgrades shift it independently
- [ ] Practice-pace rating (see Phase 3b) as a short-term signal layered on
      top of the season-long ratings
- [ ] Keep base skill/reliability, season form, and practice pace as
      **separate stored values** — don't blend into one number, tune their
      relative weight independently during backtesting

### Phase 3b — Practice-session pace

- [ ] Pull FP1–FP3 laps per session from OpenF1
- [ ] Join laps to stints (by session_key/driver_number/lap range) to tag
      each lap with compound and computed tyre age
- [ ] Filter out-laps, in-laps, and laps on old/scrubbed tyres
- [ ] Group by compound; weight FP3 more heavily than FP1/FP2 (sandbagging is
      heaviest early in the weekend)
- [ ] Tag session weather conditions; exclude/separate wet-session laps from
      dry-race prediction input

## Phase 4 — Simulation engine

- [ ] Monte Carlo core (start in Node/TypeScript, move to Python if stats
      modeling outgrows it):
  1. Sample starting grid (real quali if available, else simulated)
  2. Sample per-driver race pace from rating + noise (variance learned from
     that driver's historical consistency)
  3. Roll DNF per driver from reliability rating
  4. Roll safety car / weather events from historical base rates
  5. Convert pace + grid + events into a finishing order
  6. Record result
- [ ] Repeat 5,000–10,000 iterations per race, ratings fixed for the run
- [ ] Aggregate: win / podium / points-finish probability per driver
- [ ] Write running totals to the DB periodically during the run (not just
      at completion) so the UI can show live-updating probabilities
- [ ] Backtest: hide actual results, simulate, compare — calibrate variance
      so a driver rated ~15% to win actually wins ~15% of the time across
      many races
- [ ] Second backtest axis: simulate using only pre-race practice data,
      compare against actual result — isolates simulation/short-term-weighting
      errors from long-term rating errors

## Phase 5 — App/UI

- [ ] Race setup screen: pick upcoming race, view grid, choose iteration
      count, run simulation
- [ ] Live simulation screen: progress bar, probability bars updating as
      iterations accumulate, optional scrolling sample-outcome log
- [ ] Results screen: win/podium/points probability per driver, sorted
- [ ] Historical accuracy view: predicted vs actual for past races
- [ ] Driver/team trend dashboards (optional, uses stored historical data)

## Phase 6 — Polish

- [ ] Auth/sharing if the app goes public
- [ ] Deploy to Vercel; add a separate worker only if simulation load
      requires it

## Phase 7 — F2 (later, not started yet)

- [ ] Investigate official F2 results pages for scraping (no solid public
      API exists, unlike F1)
- [ ] Mirror the F1 schema for F2 tables
- [ ] Reuse the same rating model and simulation engine, retrained on F2 data
- [ ] Only start this once the F1 app is working end-to-end and backtested

---

## Data model (initial shape)

```
drivers          id, name, nationality, date_of_birth
teams            id, name, engine_supplier
circuits         id, name, type (street/high-speed/technical), country
races            id, season, round, circuit_id, date
qualifying_results  race_id, driver_id, team_id, position, gap_to_pole
race_results     race_id, driver_id, team_id, grid_position, finish_position,
                  status (finished/DNF/DSQ), dnf_cause (car/driver/other)
sessions         race_id, session_type (FP1/FP2/FP3/Q/R), weather
laps             session_id, driver_id, lap_number, lap_duration, compound,
                  is_pit_in_out
stints           session_id, driver_id, stint_number, compound,
                  tyre_age_at_start, lap_start, lap_end
driver_ratings   driver_id, race_id, base_pace, reliability, track_affinity,
                  practice_pace, computed_at
simulation_runs  race_id, iteration_count, status, started_at, completed_at
simulation_results  simulation_run_id, driver_id, win_pct, podium_pct,
                     points_pct
```

F2 tables mirror this shape once Phase 7 starts.

---

## Sequencing notes

- Build and validate the full F1 pipeline — ingestion, ratings, simulation,
  backtesting — end to end before touching F2 (Phase 7). That's where most
  of the actual risk lives, and F2's lack of a solid public API makes it a
  distraction until the core approach is proven.
- Don't blend practice pace into the long-term rating until both backtest
  axes (Phase 4) are independently validated — otherwise it's impossible to
  tell which one is producing prediction errors.
