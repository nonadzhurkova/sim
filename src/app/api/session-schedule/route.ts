import { db } from "@/db";
import { races } from "@/db/schema";
import { eq } from "drizzle-orm";
import { openF1Fetch } from "@/lib/openf1-client";
import { SESSION_TYPE_MAP } from "@/ingest/openf1";

type OpenF1Session = { session_name: string; date_start: string; date_end: string | null; gmt_offset: string | null };

export type ScheduledSessionType = "fp1" | "fp2" | "fp3" | "sprint_quali" | "sprint" | "q" | "r";

export type ScheduledSession = {
  sessionType: ScheduledSessionType;
  label: string;
  startsAt: string;
  endsAt: string | null;
};

export type SessionScheduleResult =
  | { status: "ok"; sessions: ScheduledSession[] }
  | { status: "locked" }
  | { status: "unreachable" }
  | { status: "not_found" };

const RACE_WEEKEND_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const LABELS: Record<ScheduledSessionType, string> = {
  fp1: "Practice 1",
  fp2: "Practice 2",
  fp3: "Practice 3",
  sprint_quali: "Sprint Qualifying",
  sprint: "Sprint",
  q: "Qualifying",
  r: "Race",
};

function scheduledSessionType(sessionName: string): ScheduledSessionType | null {
  return SESSION_TYPE_MAP[sessionName] ?? null;
}

// A session's live/locked state and start times can change at any moment --
// never serve this from a cache.
export const dynamic = "force-dynamic";

/**
 * The scheduled (not necessarily run yet) session times for one race
 * weekend, straight from OpenF1 -- display-only data, not stored in our own
 * sessions table (which only gets a row once a session has actually
 * happened and been ingested). Matched to the race by date, the same 3-day
 * window src/ingest/openf1.ts and src/ingest/freshness.ts already use.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raceId = Number(searchParams.get("raceId"));
  if (!Number.isInteger(raceId) || raceId < 1) {
    return Response.json({ error: "Invalid raceId" }, { status: 400 });
  }

  const [race] = await db.select({ season: races.season, date: races.date }).from(races).where(eq(races.id, raceId));
  if (!race) {
    return Response.json({ status: "not_found" } satisfies SessionScheduleResult);
  }

  const result = await openF1Fetch<OpenF1Session>(`/sessions?year=${race.season}`);
  if (!result.ok) {
    const status = result.reason === "locked" ? "locked" : result.reason === "empty" ? "not_found" : "unreachable";
    return Response.json({ status } satisfies SessionScheduleResult);
  }

  const raceDate = new Date(race.date).getTime();
  const sessions: ScheduledSession[] = result.data
    .filter((s) => scheduledSessionType(s.session_name) != null && Math.abs(new Date(s.date_start).getTime() - raceDate) <= RACE_WEEKEND_WINDOW_MS)
    .map((s) => {
      const sessionType = scheduledSessionType(s.session_name)!;
      return { sessionType, label: LABELS[sessionType], startsAt: s.date_start, endsAt: s.date_end };
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  if (sessions.length === 0) {
    return Response.json({ status: "not_found" } satisfies SessionScheduleResult);
  }

  return Response.json({ status: "ok", sessions } satisfies SessionScheduleResult);
}
