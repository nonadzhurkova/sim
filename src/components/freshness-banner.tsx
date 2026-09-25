import type { FreshnessResult } from "@/ingest/freshness";
import { ImportButton } from "./import-button";

export function FreshnessBanner({ freshness }: { freshness: FreshnessResult }) {
  const hasNewData = freshness.jolpica.hasNewData || freshness.openf1.hasNewData;
  if (!hasNewData) return null;

  return (
    <div className="flex items-center justify-between gap-4 border border-amber-500/50 bg-amber-950/30 px-4 py-3 shadow-[0_0_15px_-5px_rgba(245,158,11,0.4)]">
      <p className="hud-mono text-xs text-amber-300">
        <span className="mr-2 uppercase tracking-widest text-amber-400">⚠ New Data</span>
        {freshness.season} season
        {freshness.jolpica.hasNewData &&
          ` · ${freshness.jolpica.upstreamRaceCount - freshness.jolpica.storedRaceCount} new race(s)`}
        {freshness.openf1.hasNewData &&
          ` · ${freshness.openf1.upstreamSessionCount - freshness.openf1.storedSessionCount} new session(s)`}
      </p>
      <ImportButton season={freshness.season} />
    </div>
  );
}
