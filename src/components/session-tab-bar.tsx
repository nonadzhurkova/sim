"use client";

import { useEffect, useState } from "react";
import type { ScheduledSessionType, ScheduledSession, SessionScheduleResult } from "@/app/api/session-schedule/route";
import type { SessionForecast, SessionWeatherResult } from "@/app/api/session-weather/route";

/**
 * Sticky in-page nav for the weekend's sessions, read left-to-right in
 * chronological order and grouped under a day header (Fri/Sat/Sun) --
 * replaces an earlier reverse-chronological, ungrouped version that read
 * backwards and mixed two different date formats. Each tab anchors to that
 * session's own block further down the page.
 */
const TAB_ORDER: { type: ScheduledSessionType; label: string; anchor: string }[] = [
  { type: "fp1", label: "FP1", anchor: "session-fp1" },
  { type: "fp2", label: "FP2", anchor: "session-fp2" },
  { type: "fp3", label: "FP3", anchor: "session-fp3" },
  { type: "sprint_quali", label: "Sprint Quali", anchor: "session-sprint_quali" },
  { type: "sprint", label: "Sprint", anchor: "session-sprint" },
  { type: "q", label: "Quali", anchor: "session-q" },
  { type: "r", label: "Race", anchor: "race" },
];

type Status = "done" | "next" | "upcoming";

function statusFor(session: ScheduledSession, now: number, nextSessionType: ScheduledSessionType | null): Status {
  const ended = session.endsAt != null && new Date(session.endsAt).getTime() <= now;
  if (ended) return "done";
  if (session.sessionType === nextSessionType) return "next";
  return "upcoming";
}

/** "Fri 2 Oct" -- the day-group header, computed once per distinct calendar day. */
function dayHeader(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** "12:30 local" -- the tab's own time-of-day line. */
function timeLabel(iso: string): string {
  return `${new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} local`;
}

function ThermometerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0">
      <path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z" />
    </svg>
  );
}

function RaindropIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
      <path d="M12 2s7 7.6 7 12.5A7 7 0 0 1 5 14.5C5 9.6 12 2 12 2z" />
    </svg>
  );
}

/** Rain-chance color: grey when unlikely, light blue in the middle, strong blue once it's a real factor. */
function rainColor(pct: number): string {
  if (pct >= 60) return "#4da3ff";
  if (pct >= 30) return "#9ccaff";
  return "#8a91a3";
}

function WeatherLine({
  forecast,
  actualWeather,
}: {
  forecast: SessionForecast | null;
  /** "dry" | "wet" | null -- real recorded weather, shown instead of a forecast once a session has actually happened. */
  actualWeather: string | null | undefined;
}) {
  if (actualWeather != null) {
    const isWet = actualWeather === "wet";
    return (
      <div className="hud-mono flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1 text-[#8a91a3]">
          <RaindropIcon />
          <span style={{ color: isWet ? "#4da3ff" : "#8a91a3" }}>{isWet ? "Wet" : "Dry"}</span>
        </span>
      </div>
    );
  }
  if (!forecast) return null;
  return (
    <div className="hud-mono flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1 text-[#f2f3f5]">
        <ThermometerIcon />
        {Math.round(forecast.temperatureC)}°
      </span>
      <span className="flex items-center gap-1" style={{ color: rainColor(forecast.precipitationProbabilityPct) }}>
        <RaindropIcon />
        {Math.round(forecast.precipitationProbabilityPct)}%
      </span>
    </div>
  );
}

export function SessionTabBar({
  raceId,
  weatherBySession,
}: {
  raceId: number;
  /** Real recorded weather for sessions that have already happened (sessions.weather); forecast covers the rest. */
  weatherBySession: Partial<Record<ScheduledSessionType, string | null>>;
}) {
  const [schedule, setSchedule] = useState<SessionScheduleResult | null>(null);
  const [weather, setWeather] = useState<SessionWeatherResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/session-schedule?raceId=${raceId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setSchedule(data);
      })
      .catch(() => {});
    fetch(`/api/session-weather?raceId=${raceId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setWeather(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  const now = Date.now();
  const sessions = schedule?.status === "ok" ? schedule.sessions : [];
  if (sessions.length === 0) return null;

  // The earliest session that hasn't ended yet -- the one tab marked "Next".
  const nextSession = sessions.find((s) => s.endsAt == null || new Date(s.endsAt).getTime() > now) ?? null;

  // Group sessions by their own UTC calendar day, in chronological order,
  // following TAB_ORDER for session-type ordering within a day.
  const byType = new Map(sessions.map((s) => [s.sessionType, s] as const));
  const ordered = TAB_ORDER.filter((t) => byType.has(t.type));
  const days = new Map<string, typeof ordered>();
  for (const tab of ordered) {
    const session = byType.get(tab.type)!;
    const dayKey = session.startsAt.slice(0, 10);
    if (!days.has(dayKey)) days.set(dayKey, []);
    days.get(dayKey)!.push(tab);
  }

  return (
    <div className="sticky top-0 z-10 border-b border-[#1e212b] bg-[#0b0c10]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] overflow-x-auto px-6 lg:px-10">
        {[...days.entries()].map(([dayKey, tabs]) => (
          <div key={dayKey} className="flex shrink-0 flex-col border-r border-[#1e212b] last:border-r-0">
            <div className="hud-mono px-4 pt-2 text-[10px] uppercase tracking-[0.15em] text-[#5a6070]">
              {dayHeader(tabs[0] ? byType.get(tabs[0].type)!.startsAt : dayKey)}
            </div>
            <div className="flex">
              {tabs.map((tab) => {
                const session = byType.get(tab.type)!;
                const status = statusFor(session, now, nextSession?.sessionType ?? null);
                const isRace = tab.type === "r";
                const forecast = weather?.status === "ok" ? (weather.forecasts.find((f) => f.sessionType === tab.type) ?? null) : null;
                const actualWeather = weatherBySession[tab.type];
                const edge = status === "next" || isRace ? "#d40000" : "transparent";
                const dim = status === "upcoming" && !isRace;

                return (
                  <a
                    key={tab.anchor}
                    href={`#${tab.anchor}`}
                    className="flex min-w-[132px] shrink-0 flex-col gap-1.5 px-4 pb-3.5 pt-2"
                    style={{ borderBottom: `3px solid ${edge}` }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="font-heading font-bold uppercase tracking-wide"
                        style={{ fontSize: isRace ? 26 : 22, color: dim ? "#8a91a3" : "#f2f3f5" }}
                      >
                        {tab.label}
                      </span>
                      {status === "done" && (
                        <span className="hud-mono rounded-sm border border-[#22252e] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[#5a6070]">
                          Done
                        </span>
                      )}
                      {status === "next" && (
                        <span className="hud-mono rounded-sm border border-red-500 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-red-500">
                          Next
                        </span>
                      )}
                    </div>
                    <span className="hud-mono text-[11px] text-[#8a91a3]">{timeLabel(session.startsAt)}</span>
                    <WeatherLine forecast={forecast} actualWeather={actualWeather} />
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
