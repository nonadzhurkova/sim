import { db } from "@/db";
import { races, sessions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { SESSION_TYPE_MAP } from "./openf1";

const JOLPICA_BASE_URL = "https://api.jolpi.ca/ergast/f1";
const OPENF1_BASE_URL = "https://api.openf1.org/v1";

/**
 * Whether OpenF1 will actually serve data right now.
 *
 * OpenF1 restricts *all* historical access (not just live timing) to paying
 * users whenever any F1 session is running, returning an error object instead
 * of an array. That happens every race weekend, so "can't import" is a normal
 * recurring state rather than a fault — but it is indistinguishable from
 * "nothing new to import" unless it's reported separately, which is what this
 * exists to do.
 */
export type OpenF1Availability =
  | { status: "available" }
  | { status: "locked"; liveSessionName: string | null; expectedFreeAt: string | null }
  | { status: "unreachable" };

export type FreshnessResult = {
  season: number;
  jolpica: { upstreamRaceCount: number; storedRaceCount: number; hasNewData: boolean };
  openf1: {
    upstreamSessionCount: number;
    storedSessionCount: number;
    hasNewData: boolean;
    availability: OpenF1Availability;
  };
  /** The next session due to start, whether or not the API is locked. */
  nextSession: { name: string; startsAt: string; location: string | null } | null;
};

/**
 * Lightweight check for the home page banner: fetches only counts from
 * upstream APIs (no full ingestion) and compares to what's stored.
 */
export async function checkFreshness(season: number): Promise<FreshnessResult> {
  const [jolpica, openf1, nextSession] = await Promise.all([
    checkJolpicaFreshness(season),
    checkOpenF1Freshness(season),
    findNextSession(season),
  ]);
  return { season, jolpica, openf1, nextSession };
}

/**
 * The next session scheduled to start, from the stored schedule where
 * possible. Used to tell the user when OpenF1 is likely to lock again, so a
 * successful import isn't attempted moments before a session begins.
 */
async function findNextSession(
  season: number,
): Promise<FreshnessResult["nextSession"]> {
  try {
    const res = await fetch(`${OPENF1_BASE_URL}/sessions?year=${season}`);
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    const now = Date.now();
    const upcoming = (data as { session_name: string; date_start: string; location: string | null }[])
      .filter((s) => s.date_start && new Date(s.date_start).getTime() > now)
      .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
    const next = upcoming[0];
    if (!next) return null;
    return { name: next.session_name, startsAt: next.date_start, location: next.location ?? null };
  } catch {
    return null;
  }
}

async function checkJolpicaFreshness(season: number) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(races)
    .where(eq(races.season, season));
  const storedRaceCount = Number(count);

  try {
    const res = await fetch(`${JOLPICA_BASE_URL}/${season}.json?limit=1`);
    const data = (await res.json()) as { MRData?: { total?: string } };
    const upstreamRaceCount = parseInt(data.MRData?.total ?? "", 10);
    if (!Number.isFinite(upstreamRaceCount)) {
      return { upstreamRaceCount: storedRaceCount, storedRaceCount, hasNewData: false };
    }
    return { upstreamRaceCount, storedRaceCount, hasNewData: upstreamRaceCount > storedRaceCount };
  } catch {
    return { upstreamRaceCount: storedRaceCount, storedRaceCount, hasNewData: false };
  }
}

async function checkOpenF1Freshness(
  season: number,
): Promise<FreshnessResult["openf1"]> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessions)
    .innerJoin(races, eq(sessions.raceId, races.id))
    .where(eq(races.season, season));
  const storedSessionCount = Number(count);

  try {
    const res = await fetch(`${OPENF1_BASE_URL}/sessions?year=${season}`);
    const data = await res.json();
    // OpenF1 returns an error object (not an array) when a live session is
    // in progress, restricting historical access to authenticated users.
    if (!Array.isArray(data)) {
      const live = await findLiveSession();
      return {
        upstreamSessionCount: storedSessionCount,
        storedSessionCount,
        hasNewData: false,
        availability: {
          status: "locked",
          liveSessionName: live?.name ?? null,
          expectedFreeAt: live?.endsAt ?? null,
        },
      };
    }
    // Only sessions that have actually started count toward "available to
    // import" — comparing against the whole season's schedule (including
    // rounds months away) made every in-progress season look permanently
    // behind, since upstream lists the full calendar up front. A small grace
    // window covers a session that started moments ago but whose data OpenF1
    // hasn't finished publishing yet.
    const now = Date.now();
    const GRACE_MS = 5 * 60 * 1000;
    const upstreamSessionCount = (
      data as { session_name: string; date_start: string }[]
    ).filter(
      (s) =>
        s.session_name in SESSION_TYPE_MAP &&
        new Date(s.date_start).getTime() < now - GRACE_MS,
    ).length;
    return {
      upstreamSessionCount,
      storedSessionCount,
      hasNewData: upstreamSessionCount > storedSessionCount,
      availability: { status: "available" },
    };
  } catch {
    return {
      upstreamSessionCount: storedSessionCount,
      storedSessionCount,
      hasNewData: false,
      availability: { status: "unreachable" },
    };
  }
}

/**
 * Which session is currently blocking access, and when it is due to end.
 *
 * `session_key=latest` keeps working while the API is locked — it is the live
 * session's own metadata — so it can say what is running and until when, which
 * is the one thing worth knowing when an import is blocked.
 */
async function findLiveSession(): Promise<{ name: string; endsAt: string | null } | null> {
  try {
    const res = await fetch(`${OPENF1_BASE_URL}/sessions?session_key=latest`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const s = data[0] as { session_name?: string; date_end?: string; location?: string };
    if (!s.session_name) return null;
    return {
      name: s.location ? `${s.location} ${s.session_name}` : s.session_name,
      endsAt: s.date_end ?? null,
    };
  } catch {
    return null;
  }
}
