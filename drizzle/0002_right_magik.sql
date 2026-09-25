CREATE TABLE "team_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"race_id" integer NOT NULL,
	"car_strength" real,
	"car_reliability" real,
	"computed_at" timestamp DEFAULT now(),
	CONSTRAINT "team_ratings_team_id_race_id_unique" UNIQUE("team_id","race_id")
);
--> statement-breakpoint
ALTER TABLE "driver_ratings" ADD COLUMN "driver_reliability" real;--> statement-breakpoint
ALTER TABLE "team_ratings" ADD CONSTRAINT "team_ratings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_ratings" ADD CONSTRAINT "team_ratings_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_ratings" ADD CONSTRAINT "driver_ratings_driver_id_race_id_unique" UNIQUE("driver_id","race_id");