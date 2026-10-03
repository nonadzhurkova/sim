CREATE TYPE "public"."prediction_stage" AS ENUM('pre_quali', 'post_quali', 'post_race');--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN "stage" "prediction_stage";