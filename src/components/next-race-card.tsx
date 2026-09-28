import Link from "next/link";
import { HudPanel } from "./hud-panel";
import { getTeamColor } from "@/lib/team-colors";
import { flagUrlForCountry } from "@/lib/country-flags";
import type { NextRaceContender } from "@/queries/next-race-outlook";
import type { RaceListItem } from "@/queries/races";

function pct(v: number): string {
  if (v >= 0.995) return "100";
  if (v > 0 && v < 0.001) return "<0.1";
  return (v * 100).toFixed(1);
}

/**
 * The next/current race, leading the home page — what a returning visitor
 * almost always wants first, ahead of season-wide stats. Shows the top-3
 * win chances when a prediction has already been made for it (see
 * getNextRaceTopContenders); otherwise a plain prompt to go run one, rather
 * than triggering a simulation on every home-page load.
 */
export function NextRaceCard({
  race,
  contenders,
  driverTeamNames,
}: {
  race: RaceListItem;
  contenders: NextRaceContender[] | null;
  /** driverId -> team name, for the accent color next to each contender. */
  driverTeamNames: Map<number, string | null>;
}) {
  const flagUrl = flagUrlForCountry(race.country);
  const isUpcoming = new Date(race.date).getTime() >= Date.now();

  return (
    <HudPanel title={isUpcoming ? "Next Race" : "Current Race"}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {flagUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={flagUrl} alt={race.country ?? ""} className="h-9 w-14 shrink-0 rounded-sm border border-slate-800 object-cover" />
          ) : (
            <span className="h-9 w-14 shrink-0 rounded-sm border border-slate-800 bg-slate-900" />
          )}
          <div>
            <p className="hud-mono text-[11px] text-slate-400">
              R{String(race.round).padStart(2, "0")} · {race.date}
            </p>
            <p className="text-lg font-semibold text-slate-100">{race.circuitName}</p>
          </div>
        </div>
        <Link
          href={`/race/${race.season}/${race.round}`}
          className="hud-mono border border-cyan-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-cyan-400 transition-colors hover:border-cyan-500 hover:text-cyan-300"
        >
          Full Prediction →
        </Link>
      </div>

      {contenders && contenders.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {contenders.map((c, i) => {
            const color = getTeamColor(driverTeamNames.get(c.driverId) ?? null);
            return (
              <div key={c.driverId} className="flex items-center gap-2 border border-slate-800/80 bg-slate-950/40 px-3 py-2">
                <span className="hud-mono text-xs text-slate-400">#{i + 1}</span>
                <span className="h-3 w-[3px] shrink-0" style={{ backgroundColor: color }} />
                <span className="flex-1 truncate text-sm text-slate-200">{c.driverName}</span>
                <span className="hud-mono text-sm text-cyan-300">{pct(c.winPct)}%</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hud-mono mt-4 text-[11px] text-slate-400">
          NO PREDICTION RUN FOR THIS RACE YET — OPEN THE RACE PAGE TO RUN ONE.
        </p>
      )}
    </HudPanel>
  );
}
