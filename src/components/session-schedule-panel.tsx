"use client";

import { useEffect, useState } from "react";
import { HudPanel } from "./hud-panel";
import { RelativeTime } from "./relative-time";
import { LocalDateTime } from "./local-date-time";
import type { ScheduledSession, SessionScheduleResult } from "@/app/api/session-schedule/route";

// Practice-style sessions (including sprint qualifying, which sets a grid
// rather than scoring points itself) on one row; the two competitive,
// points-scoring sessions -- qualifying and the race, plus the sprint race
// itself on a sprint weekend -- on another.
const PRACTICE_ROW_TYPES = new Set(["fp1", "fp2", "fp3", "sprint_quali"]);

function SessionCard({ session, now }: { session: ScheduledSession; now: number }) {
  const started = new Date(session.startsAt).getTime() <= now;
  const ended = session.endsAt != null && new Date(session.endsAt).getTime() <= now;
  const isLive = started && !ended;

  return (
    <div
      className={`flex flex-col gap-1.5 border px-3 py-2.5 ${
        isLive
          ? "border-cyan-500/70 bg-cyan-950/30 shadow-[0_0_14px_-4px_rgba(34,211,238,0.5)]"
          : ended
            ? "border-slate-900 bg-slate-950/20 opacity-60"
            : "border-slate-800/80 bg-slate-950/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm ${isLive ? "font-semibold text-cyan-300" : ended ? "text-slate-500" : "text-slate-200"}`}>
          {session.label}
        </span>
        {isLive && <span className="hud-mono text-[10px] uppercase tracking-wider text-cyan-400">● live</span>}
      </div>
      <div className="hud-mono flex flex-col text-[11px] text-slate-500">
        <LocalDateTime iso={ended ? session.endsAt! : session.startsAt} />
        <span>
          {ended ? (
            <>
              ended <RelativeTime iso={session.endsAt!} />
            </>
          ) : (
            <RelativeTime iso={session.startsAt} />
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * Weekend session schedule (FP1-FP3, Qualifying, Race) with live "starts in"
 * / "started" timing, fetched from OpenF1 -- see the API route for why this
 * isn't read from our own sessions table (which only has a row once a
 * session has actually run).
 *
 * Practice/sprint sessions get one row of cards, qualifying + race a second
 * row -- the two rows read as "practice" vs. "what actually counts".
 */
export function SessionSchedulePanel({ raceId }: { raceId: number }) {
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

  if (!result || result.status === "not_found") return null;

  if (result.status === "locked") {
    return (
      <HudPanel title="Weekend Schedule">
        <p className="hud-mono text-[11px] text-slate-500">
          Schedule hidden while a session is live — OpenF1 blocks all access until it ends.
        </p>
      </HudPanel>
    );
  }

  if (result.status === "unreachable") {
    return (
      <HudPanel title="Weekend Schedule">
        <p className="hud-mono text-[11px] text-slate-500">Couldn&apos;t reach the timing API.</p>
      </HudPanel>
    );
  }

  const now = Date.now();
  const practiceRow = result.sessions.filter((s) => PRACTICE_ROW_TYPES.has(s.sessionType));
  const competitiveRow = result.sessions.filter((s) => !PRACTICE_ROW_TYPES.has(s.sessionType));

  return (
    <HudPanel title="Weekend Schedule">
      <div className="flex flex-col gap-3">
        {practiceRow.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {practiceRow.map((s) => (
              <SessionCard key={s.sessionType} session={s} now={now} />
            ))}
          </div>
        )}
        {competitiveRow.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {competitiveRow.map((s) => (
              <SessionCard key={s.sessionType} session={s} now={now} />
            ))}
          </div>
        )}
      </div>
    </HudPanel>
  );
}
