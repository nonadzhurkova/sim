CREATE TABLE "retroactive_prediction_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"stage" "prediction_stage" NOT NULL,
	"entries" jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now(),
	CONSTRAINT "retroactive_prediction_cache_race_id_stage_unique" UNIQUE("race_id","stage")
);
--> statement-breakpoint
ALTER TABLE "retroactive_prediction_cache" ADD CONSTRAINT "retroactive_prediction_cache_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;