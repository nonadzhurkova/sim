ALTER TABLE "circuits" ADD COLUMN "external_ref" text NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "external_ref" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "openf1_session_key" integer;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "external_ref" text NOT NULL;--> statement-breakpoint
ALTER TABLE "circuits" ADD CONSTRAINT "circuits_external_ref_unique" UNIQUE("external_ref");--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_external_ref_unique" UNIQUE("external_ref");--> statement-breakpoint
ALTER TABLE "laps" ADD CONSTRAINT "laps_session_id_driver_id_lap_number_unique" UNIQUE("session_id","driver_id","lap_number");--> statement-breakpoint
ALTER TABLE "qualifying_results" ADD CONSTRAINT "qualifying_results_race_id_driver_id_unique" UNIQUE("race_id","driver_id");--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_race_id_driver_id_unique" UNIQUE("race_id","driver_id");--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_season_round_unique" UNIQUE("season","round");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_race_id_session_type_unique" UNIQUE("race_id","session_type");--> statement-breakpoint
ALTER TABLE "stints" ADD CONSTRAINT "stints_session_id_driver_id_stint_number_unique" UNIQUE("session_id","driver_id","stint_number");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_external_ref_unique" UNIQUE("external_ref");