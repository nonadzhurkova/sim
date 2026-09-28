CREATE TABLE "sprint_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"grid_position" integer,
	"finish_position" integer,
	"status" "race_status",
	CONSTRAINT "sprint_results_race_id_driver_id_unique" UNIQUE("race_id","driver_id")
);
--> statement-breakpoint
ALTER TABLE "sprint_results" ADD CONSTRAINT "sprint_results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_results" ADD CONSTRAINT "sprint_results_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_results" ADD CONSTRAINT "sprint_results_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;