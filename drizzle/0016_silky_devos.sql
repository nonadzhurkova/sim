CREATE TABLE "openf1_session_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "openf1_session_results_session_id_driver_id_unique" UNIQUE("session_id","driver_id")
);
--> statement-breakpoint
ALTER TABLE "openf1_session_results" ADD CONSTRAINT "openf1_session_results_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openf1_session_results" ADD CONSTRAINT "openf1_session_results_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;