CREATE TABLE "xgboost_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"pred_finish_position" real,
	"pred_dnf_prob" real,
	"win_probability" real,
	"predicted_at" timestamp DEFAULT now(),
	"predicted_before_race" boolean,
	"model_version" text,
	CONSTRAINT "xgboost_predictions_race_id_driver_id_unique" UNIQUE("race_id","driver_id")
);
--> statement-breakpoint
ALTER TABLE "xgboost_predictions" ADD CONSTRAINT "xgboost_predictions_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xgboost_predictions" ADD CONSTRAINT "xgboost_predictions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;