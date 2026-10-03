"use client";

import { useEffect, useState } from "react";
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
 *
 * Fetched client-side on mount rather than passed in from the server render:
 * checkFreshness() makes two live upstream HTTP calls (Jolpica + OpenF1),
 * which used to block the whole home page's initial render on external API
 * latency. This loads in after the page is already visible instead.
 */
export function FreshnessBanner({ season }: { season: number }) {
  const [freshness, setFreshness] = useState<FreshnessResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      // no-store: this must reflect OpenF1's live lock state, which can flip
      // within minutes (a session starting/ending) -- a cached response here
      // would keep showing "locked" long after the API actually freed up.
      const res = await fetch(`/api/freshness?season=${season}`, { cache: "no-store" });
      if (res.ok) setFreshness(await res.json());
    } catch {
      // Leave whatever was last shown in place rather than clearing it.
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const refreshButton = (
    <button
      onClick={handleRefresh}
      disabled={refreshing}
      title="Re-check for new data"
      className="hud-mono shrink-0 border border-slate-600/60 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-400 transition-colors hover:border-red-600 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {refreshing ? "..." : "⟳ Refresh"}
    </button>
  );

  if (!freshness) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border border-red-900/40 bg-[#12141a]/60 px-4 py-2">
        <p className="hud-mono text-[11px] text-slate-400">
          <span className="mr-2 uppercase tracking-widest text-red-600">⬤ Checking...</span>
          Checking for new data
        </p>
      </div>
    );
  }

  const { availability } = freshness.openf1;
  const hasNewData = freshness.jolpica.hasNewData || freshness.openf1.hasNewData;
  const newRaces = freshness.jolpica.upstreamRaceCount - freshness.jolpica.storedRaceCount;
  const newSessions = freshness.openf1.upstreamSessionCount - freshness.openf1.storedSessionCount;

  if (availability.status === "locked") {
    return (
      <div className="border border-red-500/50 bg-red-950/25 px-4 py-3 shadow-[0_0_15px_-5px_rgba(212,0,0,0.4)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="hud-mono text-xs text-red-300">
            <span className="mr-2 uppercase tracking-widest text-red-400">⬤ Import Locked</span>
            {availability.liveSessionName
              ? `${availability.liveSessionName} is live`
              : "A session is live"}{" "}
            — OpenF1 blocks all data access, including past sessions, while F1 is running.
          </p>
          <div className="flex items-center gap-3">
            {availability.expectedFreeAt && (
              <p className="hud-mono text-xs text-red-200">
                Unlocks <RelativeTime iso={availability.expectedFreeAt} />
              </p>
            )}
            {refreshButton}
          </div>
        </div>
        <p className="hud-mono mt-1 text-[11px] text-slate-400">
          Come back after the session ends, then import to pick up everything at once.
        </p>
      </div>
    );
  }

  if (availability.status === "unreachable") {
    return (
      <div className="flex items-center justify-between gap-4 border border-slate-600/50 bg-slate-900/40 px-4 py-3">
        <p className="hud-mono text-xs text-slate-400">
          <span className="mr-2 uppercase tracking-widest text-slate-400">⬤ OpenF1 Unreachable</span>
          Couldn&apos;t reach the timing API — race results can still be imported.
        </p>
        <div className="flex items-center gap-3">
          {refreshButton}
          <ImportButton season={freshness.season} />
        </div>
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
          <div className="flex items-center gap-3">
            {refreshButton}
            <ImportButton season={freshness.season} />
          </div>
        </div>
        {freshness.nextSession && (
          <p className="hud-mono mt-1 text-[11px] text-slate-400">
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
    <div className="flex flex-wrap items-center justify-between gap-3 border border-red-900/40 bg-[#12141a]/60 px-4 py-2">
      <p className="hud-mono text-[11px] text-slate-400">
        <span className="mr-2 uppercase tracking-widest text-red-600">⬤ API Available</span>
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
      <div className="flex items-center gap-3">
        {refreshButton}
        <ImportButton season={freshness.season} />
      </div>
    </div>
  );
}
