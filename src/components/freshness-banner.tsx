import type { FreshnessResult } from "@/ingest/freshness";
import { ImportButton } from "./import-button";

export function FreshnessBanner({ freshness }: { freshness: FreshnessResult }) {
  const hasNewData = freshness.jolpica.hasNewData || freshness.openf1.hasNewData;
  if (!hasNewData) return null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm text-amber-900">
        New data is available for the {freshness.season} season
        {freshness.jolpica.hasNewData &&
          ` (${freshness.jolpica.upstreamRaceCount - freshness.jolpica.storedRaceCount} new race${freshness.jolpica.upstreamRaceCount - freshness.jolpica.storedRaceCount === 1 ? "" : "s"})`}
        {freshness.openf1.hasNewData &&
          ` (${freshness.openf1.upstreamSessionCount - freshness.openf1.storedSessionCount} new session${freshness.openf1.upstreamSessionCount - freshness.openf1.storedSessionCount === 1 ? "" : "s"})`}
        .
      </p>
      <ImportButton season={freshness.season} />
    </div>
  );
}
