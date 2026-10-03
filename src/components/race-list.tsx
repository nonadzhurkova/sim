import Link from "next/link";
import type { RaceListItem } from "@/queries/races";
import { HudPanel } from "./hud-panel";
import { flagUrlForCountry } from "@/lib/country-flags";

function RaceCard({
  race,
  isCurrent,
  isPast,
}: {
  race: RaceListItem;
  isCurrent: boolean;
  isPast: boolean;
}) {
  const flagUrl = flagUrlForCountry(race.country);
  return (
    <Link
      href={`/race/${race.season}/${race.round}`}
      className={`group relative flex flex-col gap-2 overflow-hidden border px-3 py-3 transition-colors ${
        isCurrent
          ? "border-red-500/70 bg-red-950/30 shadow-[0_0_14px_-4px_rgba(229,53,43,0.5)]"
          : isPast
            ? "border-slate-900 bg-slate-950/20 opacity-50 hover:opacity-90"
            : "border-slate-800/80 bg-slate-950/40 hover:border-red-800/70 hover:bg-red-950/10"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className={`hud-mono text-[11px] ${isPast && !isCurrent ? "text-slate-600" : "text-red-600"}`}>
            R{String(race.round).padStart(2, "0")}
          </span>
          {race.isSprintWeekend && (
            <span className="hud-mono border border-amber-700/60 bg-amber-950/40 px-1 py-px text-[9px] uppercase tracking-wider text-amber-400">
              Sprint
            </span>
          )}
        </span>
        {isCurrent && (
          <span className="hud-mono text-[10px] uppercase tracking-wider text-red-400">● live</span>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        {flagUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={flagUrl}
            alt={race.country ?? ""}
            className={`h-6 w-9 shrink-0 rounded-sm border border-slate-800 object-cover ${isPast && !isCurrent ? "grayscale" : ""}`}
            loading="lazy"
          />
        ) : (
          <span className="h-6 w-9 shrink-0 rounded-sm border border-slate-800 bg-slate-900" />
        )}
        <span
          className={`truncate text-sm leading-tight ${isCurrent ? "font-semibold text-red-300" : isPast ? "text-slate-400" : "text-slate-200"}`}
          title={race.circuitName}
        >
          {race.circuitName}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{race.country ?? ""}</span>
        <span className="hud-mono text-[11px] text-slate-400">{race.date}</span>
      </div>
    </Link>
  );
}

export function RaceList({
  races,
  currentRaceId,
}: {
  races: RaceListItem[];
  currentRaceId: number | undefined;
}) {
  const now = Date.now();
  const upcoming = races.filter((r) => new Date(r.date).getTime() >= now || r.id === currentRaceId);
  const past = races.filter((r) => new Date(r.date).getTime() < now && r.id !== currentRaceId).reverse();

  return (
    <HudPanel title="Season Calendar">
      {upcoming.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {upcoming.map((race) => (
            <RaceCard key={race.id} race={race} isCurrent={race.id === currentRaceId} isPast={false} />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <details className={upcoming.length > 0 ? "mt-5 border-t border-slate-800/60 pt-4" : ""}>
          <summary className="hud-mono cursor-pointer text-[11px] uppercase tracking-widest text-slate-400 hover:text-slate-400">
            Past races ({past.length})
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {past.map((race) => (
              <RaceCard key={race.id} race={race} isCurrent={false} isPast={true} />
            ))}
          </div>
        </details>
      )}
    </HudPanel>
  );
}
