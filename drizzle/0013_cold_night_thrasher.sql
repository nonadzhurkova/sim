CREATE TABLE "session_schedule_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"session_type" "session_type" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_schedule_cache_race_id_session_type_unique" UNIQUE("race_id","session_type")
);
--> statement-breakpoint
ALTER TABLE "session_schedule_cache" ADD CONSTRAINT "session_schedule_cache_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;