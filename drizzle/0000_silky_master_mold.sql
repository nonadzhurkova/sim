CREATE TYPE "public"."circuit_type" AS ENUM('street', 'high_speed', 'technical');--> statement-breakpoint
CREATE TYPE "public"."dnf_cause" AS ENUM('car', 'driver', 'other');--> statement-breakpoint
CREATE TYPE "public"."race_status" AS ENUM('finished', 'dnf', 'dsq');--> statement-breakpoint
CREATE TYPE "public"."session_type" AS ENUM('fp1', 'fp2', 'fp3', 'q', 'r');--> statement-breakpoint
CREATE TYPE "public"."simulation_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "circuits" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "circuit_type",
	"country" text
);
--> statement-breakpoint
CREATE TABLE "driver_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"race_id" integer NOT NULL,
	"base_pace" real,
	"reliability" real,
	"track_affinity" real,
	"practice_pace" real,
	"computed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"nationality" text,
	"date_of_birth" date
);
--> statement-breakpoint
CREATE TABLE "laps" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"lap_number" integer NOT NULL,
	"lap_duration" real,
	"compound" text,
	"is_pit_in_out" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "qualifying_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"position" integer,
	"gap_to_pole" real
);
--> statement-breakpoint
CREATE TABLE "race_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"grid_position" integer,
	"finish_position" integer,
	"status" "race_status",
	"dnf_cause" "dnf_cause"
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" serial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"round" integer NOT NULL,
	"circuit_id" integer NOT NULL,
	"date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"session_type" "session_type" NOT NULL,
	"weather" text
);
--> statement-breakpoint
CREATE TABLE "simulation_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"simulation_run_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"win_pct" real,
	"podium_pct" real,
	"points_pct" real
);
--> statement-breakpoint
CREATE TABLE "simulation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"iteration_count" integer NOT NULL,
	"status" "simulation_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "stints" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"stint_number" integer NOT NULL,
	"compound" text,
	"tyre_age_at_start" integer,
	"lap_start" integer,
	"lap_end" integer
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"engine_supplier" text
);
--> statement-breakpoint
ALTER TABLE "driver_ratings" ADD CONSTRAINT "driver_ratings_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_ratings" ADD CONSTRAINT "driver_ratings_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laps" ADD CONSTRAINT "laps_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laps" ADD CONSTRAINT "laps_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifying_results" ADD CONSTRAINT "qualifying_results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifying_results" ADD CONSTRAINT "qualifying_results_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifying_results" ADD CONSTRAINT "qualifying_results_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_circuit_id_circuits_id_fk" FOREIGN KEY ("circuit_id") REFERENCES "public"."circuits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_simulation_run_id_simulation_runs_id_fk" FOREIGN KEY ("simulation_run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stints" ADD CONSTRAINT "stints_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stints" ADD CONSTRAINT "stints_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;