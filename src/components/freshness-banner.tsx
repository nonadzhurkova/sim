import type { FreshnessResult } from "@/ingest/freshness";
import { ImportButton } from "./import-button";
import { RelativeTime } from "./relative-time";

/**
 * Home-page status strip for data imports.
 *
 * Shows three things the user otherwise has to guess at: whether there is new
 * data upstream, whether OpenF1 will actually serve it right now, and when the
 * next session will lock it again. OpenF1 blocks all historical access while
 * any F1 session is running, so "import is impossible at the moment" is a
 * normal recurring state that needs saying out loud — previously it looked
 * identical to "everything is up to date".
 */
export function FreshnessBanner({ freshness }: { freshness: FreshnessResult }) {
  const { availability } = freshness.openf1;
  const hasNewData = freshness.jolpica.hasNewData || freshness.openf1.hasNewData;
  const newRaces = freshness.jolpica.upstreamRaceCount - freshness.jolpica.storedRaceCount;
  const newSessions = freshness.openf1.upstreamSessionCount - freshness.openf1.storedSessionCount;

  if (availability.status === "locked") {
    return (
      <div className="border border-red-500/50 bg-red-950/25 px-4 py-3 shadow-[0_0_15px_-5px_rgba(239,68,68,0.4)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="hud-mono text-xs text-red-300">
            <span className="mr-2 uppercase tracking-widest text-red-400">⬤ Import Locked</span>
            {availability.liveSessionName
              ? `${availability.liveSessionName} is live`
              : "A session is live"}{" "}
            — OpenF1 blocks all data access, including past sessions, while F1 is running.
          </p>
          {availability.expectedFreeAt && (
            <p className="hud-mono text-xs text-red-200">
              Unlocks <RelativeTime iso={availability.expectedFreeAt} />
            </p>
          )}
        </div>
        <p className="hud-mono mt-1 text-[11px] text-slate-500">
          Come back after the session ends, then import to pick up everything at once.
        </p>
      </div>
    );
  }

  if (availability.status === "unreachable") {
    return (
      <div className="flex items-center justify-between gap-4 border border-slate-600/50 bg-slate-900/40 px-4 py-3">
        <p className="hud-mono text-xs text-slate-400">
          <span className="mr-2 uppercase tracking-widest text-slate-500">⬤ OpenF1 Unreachable</span>
          Couldn&apos;t reach the timing API — race results can still be imported.
        </p>
        <ImportButton season={freshness.season} />
      </div>
    );
  }

  if (hasNewData) {
    return (
      <div className="border border-amber-500/50 bg-amber-950/30 px-4 py-3 shadow-[0_0_15px_-5px_rgba(245,158,11,0.4)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="hud-mono text-xs text-amber-300">
            <span className="mr-2 uppercase tracking-widest text-amber-400">⚠ New Data</span>
            {freshness.season} season
            {freshness.jolpica.hasNewData && ` · ${newRaces} new race${newRaces === 1 ? "" : "s"}`}
            {freshness.openf1.hasNewData &&
              ` · ${newSessions} new session${newSessions === 1 ? "" : "s"}`}
          </p>
          <ImportButton season={freshness.season} />
        </div>
        {freshness.nextSession && (
          <p className="hud-mono mt-1 text-[11px] text-slate-500">
            Import now — {freshness.nextSession.name}
            {freshness.nextSession.location ? ` at ${freshness.nextSession.location}` : ""} starts{" "}
            <RelativeTime iso={freshness.nextSession.startsAt} />, which locks the API again.
          </p>
        )}
      </div>
    );
  }

  // Up to date and importable: a quiet line rather than nothing, so the state
  // is distinguishable from the API being blocked.
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-cyan-900/40 bg-[#0b1015]/60 px-4 py-2">
      <p className="hud-mono text-[11px] text-slate-500">
        <span className="mr-2 uppercase tracking-widest text-cyan-600">⬤ API Available</span>
        Data is up to date
        {freshness.nextSession && (
          <>
            {" "}
            · {freshness.nextSession.name}
            {freshness.nextSession.location ? ` at ${freshness.nextSession.location}` : ""} starts{" "}
            <RelativeTime iso={freshness.nextSession.startsAt} />
          </>
        )}
      </p>
      <ImportButton season={freshness.season} />
    </div>
  );
}
