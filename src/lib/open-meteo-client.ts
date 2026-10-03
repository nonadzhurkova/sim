/**
 * Open-Meteo forecast client -- free, keyless weather API. Unlike OpenF1,
 * Open-Meteo has no documented hard per-second rate limit for this request
 * volume (one call per race-page view), so this skips the queuing/backoff
 * machinery openf1-client.ts needs and just does a plain fetch with a
 * timeout.
 *
 * Forecasts are only meaningful within Open-Meteo's own forecast horizon
 * (16 days); callers should treat a request for a date outside that range
 * as "no forecast yet" rather than retrying.
 */

const FORECAST_HORIZON_DAYS = 16;

export type HourlyForecast = {
  time: string; // ISO, UTC
  temperatureC: number;
  precipitationProbabilityPct: number;
  windSpeedKmh: number;
};

export type OpenMeteoResult =
  | { ok: true; hours: HourlyForecast[] }
  | { ok: false; reason: "too_far_out" | "unreachable" };

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return ms / (24 * 60 * 60 * 1000);
}

/**
 * Hourly forecast for one circuit's coordinates, covering the UTC calendar
 * day the given ISO timestamp falls on. Returns "too_far_out" without
 * calling the API at all when the target date exceeds Open-Meteo's forecast
 * horizon, since that failure mode is predictable ahead of time.
 */
export async function fetchHourlyForecast(
  lat: number,
  lon: number,
  targetIso: string,
): Promise<OpenMeteoResult> {
  if (daysUntil(targetIso) > FORECAST_HORIZON_DAYS) {
    return { ok: false, reason: "too_far_out" };
  }

  const date = targetIso.slice(0, 10); // YYYY-MM-DD, UTC calendar day
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "temperature_2m,precipitation_probability,wind_speed_10m",
    start_date: date,
    end_date: date,
    timezone: "UTC",
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const data = await res.json();
    const times: string[] = data.hourly?.time ?? [];
    const temps: number[] = data.hourly?.temperature_2m ?? [];
    const precip: number[] = data.hourly?.precipitation_probability ?? [];
    const wind: number[] = data.hourly?.wind_speed_10m ?? [];
    if (times.length === 0) return { ok: false, reason: "unreachable" };

    const hours: HourlyForecast[] = times.map((time, i) => ({
      time,
      temperatureC: temps[i],
      precipitationProbabilityPct: precip[i],
      windSpeedKmh: wind[i],
    }));
    return { ok: true, hours };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/** The forecast hour closest to a given instant, from an already-fetched hourly series. */
export function closestHour(hours: HourlyForecast[], targetIso: string): HourlyForecast | null {
  if (hours.length === 0) return null;
  const targetMs = new Date(targetIso).getTime();
  return hours.reduce((best, h) => {
    const bestDelta = Math.abs(new Date(best.time).getTime() - targetMs);
    const delta = Math.abs(new Date(h.time).getTime() - targetMs);
    return delta < bestDelta ? h : best;
  });
}
