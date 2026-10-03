import { db } from "@/db";
import { races, circuits } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fetchSessionSchedule, type ScheduledSessionType } from "../session-schedule/route";
import { CIRCUIT_COORDINATES } from "@/lib/circuit-coordinates";
import { fetchHourlyForecast, closestHour } from "@/lib/open-meteo-client";

export type SessionForecast = {
  sessionType: ScheduledSessionType;
  temperatureC: number;
  precipitationProbabilityPct: number;
  windSpeedKmh: number;
};

export type SessionWeatherResult =
  | { status: "ok"; forecasts: SessionForecast[] }
  | { status: "too_far_out" }
  | { status: "no_coordinates" }
  | { status: "unreachable" }
  | { status: "locked" }
  | { status: "not_found" };

// A session's own schedule can shift and a forecast updates continuously --
// never serve either from a cache.
export const dynamic = "force-dynamic";

/**
 * Forecast (temperature, rain chance, wind) for each not-yet-run session of
 * a race weekend, from Open-Meteo. Scoped to upcoming sessions only --
 * sessions that have already happened have real recorded weather in
 * sessions.weather (from OpenF1's actual rainfall sensor), which this
 * deliberately doesn't duplicate or override.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raceId = Number(searchParams.get("raceId"));
  if (!Number.isInteger(raceId) || raceId < 1) {
    return Response.json({ error: "Invalid raceId" }, { status: 400 });
  }

  const [race] = await db
    .select({ circuitExternalRef: circuits.externalRef })
    .from(races)
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .where(eq(races.id, raceId));
  if (!race) {
    return Response.json({ status: "not_found" } satisfies SessionWeatherResult);
  }

  const coords = CIRCUIT_COORDINATES[race.circuitExternalRef];
  if (!coords) {
    return Response.json({ status: "no_coordinates" } satisfies SessionWeatherResult);
  }

  const schedule = await fetchSessionSchedule(raceId);
  if (schedule.status !== "ok") {
    return Response.json({ status: schedule.status } satisfies SessionWeatherResult);
  }

  // "Upcoming" here means "hasn't ended yet", not "hasn't started yet" --
  // a session currently in progress still gets a forecast chip (its own
  // conditions are exactly what a visitor watching it live wants to see),
  // only a session that's actually finished is excluded.
  const now = Date.now();
  const upcoming = schedule.sessions.filter((s) => s.endsAt == null || new Date(s.endsAt).getTime() > now);
  if (upcoming.length === 0) {
    return Response.json({ status: "ok", forecasts: [] } satisfies SessionWeatherResult);
  }

  // One forecast fetch per distinct UTC calendar day among the upcoming
  // sessions, rather than one per session -- a weekend spans at most 3 days,
  // and Open-Meteo's hourly response for a day already covers every session
  // that falls on it.
  const dayKeys = [...new Set(upcoming.map((s) => s.startsAt.slice(0, 10)))];
  const forecastsByDay = new Map(
    await Promise.all(
      dayKeys.map(async (day) => {
        const result = await fetchHourlyForecast(coords.lat, coords.lon, `${day}T12:00:00Z`);
        return [day, result] as const;
      }),
    ),
  );

  // If every day is out of range, surface that distinctly from a real
  // network failure so the UI can say "forecast opens up closer to race
  // week" instead of "couldn't reach the weather service".
  const results = [...forecastsByDay.values()];
  if (results.length > 0 && results.every((r) => !r.ok && r.reason === "too_far_out")) {
    return Response.json({ status: "too_far_out" } satisfies SessionWeatherResult);
  }

  const forecasts: SessionForecast[] = [];
  for (const session of upcoming) {
    const day = forecastsByDay.get(session.startsAt.slice(0, 10));
    if (!day?.ok) continue;
    const hour = closestHour(day.hours, session.startsAt);
    if (!hour) continue;
    forecasts.push({
      sessionType: session.sessionType,
      temperatureC: hour.temperatureC,
      precipitationProbabilityPct: hour.precipitationProbabilityPct,
      windSpeedKmh: hour.windSpeedKmh,
    });
  }

  return Response.json({ status: "ok", forecasts } satisfies SessionWeatherResult);
}
