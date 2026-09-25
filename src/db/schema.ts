import {
  pgTable,
  serial,
  text,
  integer,
  date,
  real,
  boolean,
  timestamp,
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

export const drivers = pgTable(
  "drivers",
  {
    id: serial("id").primaryKey(),
    externalRef: text("external_ref").notNull(), // Ergast/Jolpica driverId
    name: text("name").notNull(),
    nationality: text("nationality"),
    dateOfBirth: date("date_of_birth"),
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

export const driverRatings = pgTable("driver_ratings", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id")
    .notNull()
    .references(() => drivers.id),
  raceId: integer("race_id")
    .notNull()
    .references(() => races.id),
  basePace: real("base_pace"),
  reliability: real("reliability"),
  trackAffinity: real("track_affinity"),
  practicePace: real("practice_pace"),
  computedAt: timestamp("computed_at").defaultNow(),
});

export const simulationRuns = pgTable("simulation_runs", {
  id: serial("id").primaryKey(),
  raceId: integer("race_id")
    .notNull()
    .references(() => races.id),
  iterationCount: integer("iteration_count").notNull(),
  status: simulationStatusEnum("status").notNull().default("pending"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

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
