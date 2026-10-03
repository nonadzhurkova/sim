import { db } from "@/db";
import { races, sessionScheduleCache } from "@/db/schema";
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

/** Last-known session times from session_schedule_cache, for when OpenF1 can't be reached right now. */
async function readScheduleCache(raceId: number): Promise<ScheduledSession[]> {
  const rows = await db
    .select({
      sessionType: sessionScheduleCache.sessionType,
      startsAt: sessionScheduleCache.startsAt,
      endsAt: sessionScheduleCache.endsAt,
    })
    .from(sessionScheduleCache)
    .where(eq(sessionScheduleCache.raceId, raceId))
    .orderBy(sessionScheduleCache.startsAt);
  return rows.map((r) => ({
    sessionType: r.sessionType as ScheduledSessionType,
    label: LABELS[r.sessionType as ScheduledSessionType],
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt?.toISOString() ?? null,
  }));
}

/** Saves each session's time whenever OpenF1 successfully returns one, so a later lock has something to fall back to. */
async function writeScheduleCache(raceId: number, sessions: ScheduledSession[]) {
  for (const s of sessions) {
    await db
      .insert(sessionScheduleCache)
      .values({ raceId, sessionType: s.sessionType, startsAt: new Date(s.startsAt), endsAt: s.endsAt ? new Date(s.endsAt) : null })
      .onConflictDoUpdate({
        target: [sessionScheduleCache.raceId, sessionScheduleCache.sessionType],
        set: { startsAt: new Date(s.startsAt), endsAt: s.endsAt ? new Date(s.endsAt) : null, updatedAt: new Date() },
      });
  }
}

/**
 * The scheduled (not necessarily run yet) session times for one race
 * weekend, from OpenF1 -- display-only data, not stored in our own sessions
 * table (which only gets a row once a session has actually happened and
 * been ingested). Matched to the race by date, the same 3-day window
 * src/ingest/openf1.ts and src/ingest/freshness.ts already use.
 *
 * Every successful OpenF1 response is saved to session_schedule_cache; when
 * OpenF1 is locked (another session live) or unreachable, this falls back
 * to those last-known times instead of returning nothing -- weather and the
 * session tab bar both depend on session times being available even during
 * a live-session lock, which is exactly when a visitor is most likely to be
 * looking at the page.
 *
 * Factored out of the GET handler so /api/session-weather can reuse the same
 * schedule lookup (session times) without duplicating the OpenF1 call.
 */
export async function fetchSessionSchedule(raceId: number): Promise<SessionScheduleResult> {
  const [race] = await db.select({ season: races.season, date: races.date }).from(races).where(eq(races.id, raceId));
  if (!race) return { status: "not_found" };

  const result = await openF1Fetch<OpenF1Session>(`/sessions?year=${race.season}`);
  if (!result.ok) {
    const cached = await readScheduleCache(raceId);
    if (cached.length > 0) return { status: "ok", sessions: cached };
    const status = result.reason === "locked" ? "locked" : result.reason === "empty" ? "not_found" : "unreachable";
    return { status };
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
    const cached = await readScheduleCache(raceId);
    if (cached.length > 0) return { status: "ok", sessions: cached };
    return { status: "not_found" };
  }

  await writeScheduleCache(raceId, sessions);
  return { status: "ok", sessions };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raceId = Number(searchParams.get("raceId"));
  if (!Number.isInteger(raceId) || raceId < 1) {
    return Response.json({ error: "Invalid raceId" }, { status: 400 });
  }
  return Response.json(await fetchSessionSchedule(raceId));
}
