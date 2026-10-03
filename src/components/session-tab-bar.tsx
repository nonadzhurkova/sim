"use client";

import { useEffect, useState } from "react";
import type { ScheduledSessionType, SessionScheduleResult } from "@/app/api/session-schedule/route";

/**
 * Sticky in-page nav mirroring the session weekend -- Race first (most
 * relevant), then Quali/FP3/FP2/FP1 in reverse-chronological order, matching
 * how a visitor thinks about the weekend ("what's the latest"). Each tab
 * anchors to that session's own block in the "Session results" section,
 * except Race which anchors to the prediction/result block at the top of
 * the page. Doubles as the weekend's schedule-at-a-glance (each subtitle is
 * that session's own date/time), replacing a separate schedule panel.
 */
const TABS: { type: ScheduledSessionType | "race-overview"; label: string; anchor: string }[] = [
  { type: "race-overview", label: "Race", anchor: "race" },
  { type: "q", label: "Quali", anchor: "session-q" },
  { type: "fp3", label: "FP3", anchor: "session-fp3" },
  { type: "fp2", label: "FP2", anchor: "session-fp2" },
  { type: "fp1", label: "FP1", anchor: "session-fp1" },
];

type Status = "Live" | "Done" | "Pending";

function statusFor(session: { startsAt: string; endsAt: string | null } | undefined, now: number): Status | null {
  if (!session) return null;
  const started = new Date(session.startsAt).getTime() <= now;
  const ended = session.endsAt != null && new Date(session.endsAt).getTime() <= now;
  if (started && !ended) return "Live";
  if (ended) return "Done";
  return "Pending";
}

const STATUS_EDGE: Record<Status, string> = {
  Live: "#d40000",
  Done: "#2b4a39",
  Pending: "transparent",
};

/** Compact "Sun 4 Oct" -- fits a tab subtitle, unlike LocalDateTime's fuller format. */
function compactDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function SessionTabBar({ raceId, raceDateLabel }: { raceId: number; raceDateLabel: string }) {
  const [result, setResult] = useState<SessionScheduleResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/session-schedule?raceId=${raceId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setResult(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  const now = Date.now();
  const sessions = result?.status === "ok" ? result.sessions : [];

  return (
    <div className="sticky top-0 z-10 border-b border-[#1e212b] bg-[#0b0c10]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] overflow-x-auto px-6 lg:px-10">
        {TABS.map((tab) => {
          const isRace = tab.type === "race-overview";
          const session = isRace ? undefined : sessions.find((s) => s.sessionType === tab.type);
          const status = isRace ? null : statusFor(session, now);
          const subtitle = isRace ? raceDateLabel : session ? compactDate(session.startsAt) : (status ?? "—");
          const edge = isRace ? "#d40000" : status ? STATUS_EDGE[status] : "transparent";
          const dim = !isRace && status === "Pending";
          return (
            <a
              key={tab.anchor}
              href={`#${tab.anchor}`}
              className="flex shrink-0 flex-col gap-0.5 border-b-[3px] px-6 py-3.5"
              style={{ borderBottomColor: edge }}
            >
              <span
                className="font-heading text-xl font-bold uppercase tracking-wide"
                style={{ color: dim ? "#a3a9b8" : "#f2f3f5" }}
              >
                {tab.label}
              </span>
              <span className="hud-mono text-[11px] uppercase tracking-wider text-[#8a91a3]">{subtitle}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
