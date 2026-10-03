import {
  pgTable,
  serial,
  text,
  integer,
  date,
  real,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";

export const dnfCauseEnum = pgEnum("dnf_cause", ["car", "driver", "other"]);
export const raceStatusEnum = pgEnum("race_status", [
  "finished",
  "dnf",
  "dsq",
]);
export const sessionTypeEnum = pgEnum("session_type", [
  "fp1",
  "fp2",
  "fp3",
  "sprint_quali",
  "sprint",
  "q",
  "r",
]);
export const circuitTypeEnum = pgEnum("circuit_type", [
  "street",
  "high_speed",
  "technical",
]);
export const simulationStatusEnum = pgEnum("simulation_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

/**
 * Which point in the race weekend a simulation run represents. Stored once
 * at completion (derived from hasRealGrid + predictedBeforeRace) rather than
 * recomputed later, so a run's stage stays fixed even after qualifying or
 * the race happens -- without this, "the latest pre-race run" silently
 * collapses a pre-qualifying prediction and a post-qualifying one into the
 * same slot the moment the second one is made, losing the first.
 * post_race is reserved for the prediction-review reconstruction path (a
 * live replay made after the result is known); runAndStoreSimulation/
 * streamSimulation only ever produce pre_quali or post_quali.
 */
export const predictionStageEnum = pgEnum("prediction_stage", [
  "pre_quali",
  "post_quali",
  "post_race",
]);

export const drivers = pgTable(
  "drivers",
  {
    id: serial("id").primaryKey(),
    externalRef: text("external_ref").notNull(), // Ergast/Jolpica driverId
    name: text("name").notNull(),
    nationality: text("nationality"),
    dateOfBirth: date("date_of_birth"),
    // From OpenF1's drivers endpoint. Stored rather than fetched per request:
    // both change at most once a season, so a lookup every page load would be
    // repeated calls to a rate-limited API for data that never moves.
    driverNumber: integer("driver_number"),
    headshotUrl: text("headshot_url"),
  },
  (t) => [unique().on(t.externalRef)],
);

export const teams = pgTable(
  "teams",
  {
    id: serial("id").primaryKey(),
    externalRef: text("external_ref").notNull(), // Ergast/Jolpica constructorId
    name: text("name").notNull(),
    engineSupplier: text("engine_supplier"),
  },
  (t) => [unique().on(t.externalRef)],
);

export const circuits = pgTable(
  "circuits",
  {
    id: serial("id").primaryKey(),
    externalRef: text("external_ref").notNull(), // Ergast/Jolpica circuitId
    name: text("name").notNull(),
    type: circuitTypeEnum("type"),
    country: text("country"),
  },
  (t) => [unique().on(t.externalRef)],
);

export const races = pgTable(
  "races",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    round: integer("round").notNull(),
    circuitId: integer("circuit_id")
      .notNull()
      .references(() => circuits.id),
    date: date("date").notNull(),
    // Jolpica's schedule endpoint returns `date` (calendar day) and `time`
    // (UTC time-of-day) as separate fields; this combines them into one
    // instant. Nullable because older/malformed entries may lack a time --
    // callers needing "has the race actually started" must treat a null
    // here as unknown, not as "in the past" or "in the future" by default
    // (see isBeforeRaceStart in run-simulation.ts). Exists specifically so
    // "was this prediction made before the race" can be decided against the
    // actual green flag, not midnight UTC of the calendar date, which wrongly
    // classified same-day pre-race runs as post-race.
    startsAt: timestamp("starts_at", { withTimezone: true }),
    // From the calendar endpoint's own "Sprint" field, present ahead of the
    // weekend -- unlike sprint_results (which only exists once the sprint
    // has actually been run), this is known as soon as the calendar is.
    isSprintWeekend: boolean("is_sprint_weekend").notNull().default(false),
  },
  (t) => [unique().on(t.season, t.round)],
);

export const qualifyingResults = pgTable(
  "qualifying_results",
  {
    id: serial("id").primaryKey(),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    position: integer("position"),
    gapToPole: real("gap_to_pole"),
  },
  (t) => [unique().on(t.raceId, t.driverId)],
);

export const raceResults = pgTable(
  "race_results",
  {
    id: serial("id").primaryKey(),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    gridPosition: integer("grid_position"),
    finishPosition: integer("finish_position"),
    status: raceStatusEnum("status"),
    dnfCause: dnfCauseEnum("dnf_cause"),
  },
  (t) => [unique().on(t.raceId, t.driverId)],
);

/**
 * Sprint race classification, kept separate from raceResults rather than a
 * flag on it: a driver has at most one row in each per raceId (the same
 * unique(raceId, driverId) shape), but the two are scored on entirely
 * different points tables and a round either has both or just the main
 * race, never a mix that a shared table's constraints could express cleanly.
 */
export const sprintResults = pgTable(
  "sprint_results",
  {
    id: serial("id").primaryKey(),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    gridPosition: integer("grid_position"),
    finishPosition: integer("finish_position"),
    status: raceStatusEnum("status"),
  },
  (t) => [unique().on(t.raceId, t.driverId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    sessionType: sessionTypeEnum("session_type").notNull(),
    weather: text("weather"),
    openf1SessionKey: integer("openf1_session_key"),
  },
  (t) => [unique().on(t.raceId, t.sessionType)],
);

/**
 * Last-known scheduled start/end time per session, cached from OpenF1's live
 * `/sessions` endpoint. Deliberately separate from the `sessions` table,
 * whose rows mean "this session happened and was ingested" -- a session
 * scheduled for next week has no such row yet, so its timing can't live
 * there without changing that meaning. Written opportunistically whenever
 * /api/session-schedule gets a successful OpenF1 response, read as a
 * fallback when OpenF1 is locked (e.g. another session is live) so
 * schedule-dependent UI (weather forecast, the session tab bar) keeps
 * working with the last times it saw instead of going blank.
 */
export const sessionScheduleCache = pgTable(
  "session_schedule_cache",
  {
    id: serial("id").primaryKey(),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    sessionType: sessionTypeEnum("session_type").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.raceId, t.sessionType)],
);

export const laps = pgTable(
  "laps",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id),
    lapNumber: integer("lap_number").notNull(),
    lapDuration: real("lap_duration"),
    compound: text("compound"),
    isPitInOut: boolean("is_pit_in_out").default(false),
  },
  (t) => [unique().on(t.sessionId, t.driverId, t.lapNumber)],
);

export const stints = pgTable(
  "stints",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id),
    stintNumber: integer("stint_number").notNull(),
    compound: text("compound"),
    tyreAgeAtStart: integer("tyre_age_at_start"),
    lapStart: integer("lap_start"),
    lapEnd: integer("lap_end"),
  },
  (t) => [unique().on(t.sessionId, t.driverId, t.stintNumber)],
);

/**
 * OpenF1's own classified result for a session (from its /session_result
 * endpoint) -- used for qualifying/sprint-qualifying sessions specifically
 * as a pre-race grid source while Jolpica's classified qualifying.json
 * hasn't been published yet (it typically lags OpenF1 by hours). Unlike
 * reconstructing a grid from raw lap times, this is OpenF1's own official
 * position, already correct across the Q1/Q2/Q3 knockout structure -- a
 * driver eliminated in Q1 is correctly ranked below Q3 participants even
 * though their fastest recorded lap might be quicker than some Q3 laps.
 */
export const openf1SessionResults = pgTable(
  "openf1_session_results",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id),
    position: integer("position").notNull(),
  },
  (t) => [unique().on(t.sessionId, t.driverId)],
);

export const driverRatings = pgTable(
  "driver_ratings",
  {
    id: serial("id").primaryKey(),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    basePace: real("base_pace"),
    driverReliability: real("driver_reliability"), // DNF rate, driver-caused only (crashes, spins)
    trackAffinity: real("track_affinity"),
    practicePace: real("practice_pace"),
    // Kalman-filter posterior variance from src/ratings/bayesian (variance
    // of the *estimate*, shrinking with sample size — not the Bayesian pace
    // mean itself, which stays unused; only its uncertainty output is
    // adopted). Feeds per-driver, per-iteration pace-noise scaling.
    paceUncertainty: real("pace_uncertainty"),
    computedAt: timestamp("computed_at").defaultNow(),
  },
  (t) => [unique().on(t.driverId, t.raceId)],
);

export const teamRatings = pgTable(
  "team_ratings",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    carStrength: real("car_strength"), // season-long pace, isolated from driver skill
    carReliability: real("car_reliability"), // DNF rate, car-caused (engine/gearbox/etc.), shared by teammates
    computedAt: timestamp("computed_at").defaultNow(),
  },
  (t) => [unique().on(t.teamId, t.raceId)],
);

export const simulationRuns = pgTable("simulation_runs", {
  id: serial("id").primaryKey(),
  raceId: integer("race_id")
    .notNull()
    .references(() => races.id),
  iterationCount: integer("iteration_count").notNull(),
  status: simulationStatusEnum("status").notNull().default("pending"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  // The two fields below turn this table into an honest prediction log:
  // without them, "the model's prediction for this race" is ambiguous
  // between what it said before the result was known and what re-running it
  // today (after further tuning) says in hindsight.
  //
  // Whether the race hadn't happened yet (by calendar date) at the moment
  // this run was created. A run made the day before the race and one made
  // a month after it, re-simulating for review, both produce a row in this
  // table -- only this flag tells them apart later.
  predictedBeforeRace: boolean("predicted_before_race"),
  // MODEL_VERSION (src/sim/params.ts) at the moment this run was created —
  // a hand-bumped string, not a hash, but enough to tell "this run predates
  // the qualiForm trimmed-mean fix" from "this run postdates it" without
  // guessing from the timestamp alone.
  modelVersion: text("model_version"),
  // Set once the run completes (see predictionStageEnum's own doc comment).
  // Null while a run is still pending/running, and for old rows written
  // before this column existed -- getFrozenPrediction treats a null stage
  // as "pre_quali" for those, since every run before this feature existed
  // was effectively the single undifferentiated "latest pre-race" slot.
  stage: predictionStageEnum("stage"),
});

/**
 * Cache for the "Prediction over time" panel's retroactive fallback (see
 * reconstructStage in src/queries/race-prediction.ts): a finished race that
 * predates predictionStageEnum existing has no real pre_quali/post_quali
 * run recorded, so that panel computes one live, clearly labeled as a
 * retroactive guess rather than a genuine historical prediction. That
 * computation is a full Monte Carlo run and too slow to repeat on every page
 * view, so the result is cached here by (raceId, stage) the first time it's
 * computed. Deliberately a separate table from simulation_runs rather than
 * a row there with some "this one's fake" flag -- other code trusts
 * simulation_runs/predictedBeforeRace as an honest prediction log, and a
 * table that could contain retroactive guesses would be one more thing
 * every future reader of that table has to remember to filter out.
 */
export const retroactivePredictionCache = pgTable(
  "retroactive_prediction_cache",
  {
    id: serial("id").primaryKey(),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    stage: predictionStageEnum("stage").notNull(),
    // Top-3 entries: [{ driverId, driverName, teamName, winPct }, ...].
    entries: jsonb("entries").notNull(),
    computedAt: timestamp("computed_at").defaultNow(),
  },
  (t) => [unique().on(t.raceId, t.stage)],
);

export const simulationResults = pgTable("simulation_results", {
  id: serial("id").primaryKey(),
  simulationRunId: integer("simulation_run_id")
    .notNull()
    .references(() => simulationRuns.id),
  driverId: integer("driver_id")
    .notNull()
    .references(() => drivers.id),
  winPct: real("win_pct"),
  podiumPct: real("podium_pct"),
  pointsPct: real("points_pct"),
});

/**
 * One row per driver per race for the XGBoost overlay's prediction — the
 * same "frozen prediction log" idea as simulation_runs/simulation_results,
 * but for the second model, which had no persistence at all before (every
 * click just returned JSON with nothing saved). A click replaces this
 * race's rows wholesale (see xgboost-model's persist function), so
 * "predictedAt"/"predictedBeforeRace" always describe the most recent
 * click, matching how the Monte Carlo run behaves via getFrozenPrediction.
 */
export const xgboostPredictions = pgTable(
  "xgboost_predictions",
  {
    id: serial("id").primaryKey(),
    raceId: integer("race_id")
      .notNull()
      .references(() => races.id),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id),
    predFinishPosition: real("pred_finish_position"),
    predDnfProb: real("pred_dnf_prob"),
    winProbability: real("win_probability"),
    // Pre-Platt-calibration win probability (renormalized only) -- stored
    // separately from winProbability so the production MC+XGBoost blend
    // (BLEND_ALPHA in params.ts) can read it back later without
    // recomputing XGBoost live. XGBoost's own Platt calibration was found
    // to make 2 of 3 seasons worse than raw (see README), so this is also
    // what the blend was tuned against -- winProbability above stays purely
    // for the standalone XGBoost panel's own display.
    rawWinProbability: real("raw_win_probability"),
    predictedAt: timestamp("predicted_at").defaultNow(),
    predictedBeforeRace: boolean("predicted_before_race"),
    modelVersion: text("model_version"),
  },
  (t) => [unique().on(t.raceId, t.driverId)],
);
