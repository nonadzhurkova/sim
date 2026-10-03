"use client";

import { useEffect, useState } from "react";
import type { SessionWeatherResult } from "@/app/api/session-weather/route";
import type { ScheduledSessionType } from "@/app/api/session-schedule/route";
import { ForecastChip } from "./forecast-chip";

/**
 * The "not run yet" session list, each name paired with its own forecast
 * chip once the weekend's forecasts load. A client component (not a render
 * prop handed in from the server-rendered page) because a function can't
 * cross the server/client boundary as a prop -- this owns the whole row
 * instead, taking only serializable data from its server-component caller.
 */
export function SessionWeatherChips({
  raceId,
  sessions,
}: {
  raceId: number;
  sessions: { type: ScheduledSessionType; label: string }[];
}) {
  const [result, setResult] = useState<SessionWeatherResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/session-weather?raceId=${raceId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setResult(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  return (
    <>
      {sessions.map(({ type, label }) => {
        const forecast =
          result?.status === "ok" ? (result.forecasts.find((f) => f.sessionType === type) ?? null) : null;
        return (
          <span key={type} id={`session-${type}`} className="scroll-mt-24 flex items-center gap-2">
            <span className="text-sm font-semibold">{label}</span>
            {forecast && <ForecastChip forecast={forecast} />}
          </span>
        );
      })}
    </>
  );
}
