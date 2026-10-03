CREATE TABLE "grid_penalties" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"places_offset" integer NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "grid_penalties_race_id_driver_id_unique" UNIQUE("race_id","driver_id")
);
--> statement-breakpoint
ALTER TABLE "grid_penalties" ADD CONSTRAINT "grid_penalties_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_penalties" ADD CONSTRAINT "grid_penalties_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;