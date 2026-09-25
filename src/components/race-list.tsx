import Link from "next/link";
import type { RaceListItem } from "@/queries/races";
import { HudPanel } from "./hud-panel";

export function RaceList({
  races,
  currentRaceId,
}: {
  races: RaceListItem[];
  currentRaceId: number | undefined;
}) {
  return (
    <HudPanel title="Season Calendar">
      <ul className="divide-y divide-slate-800/80">
        {races.map((race) => {
          const isCurrent = race.id === currentRaceId;
          return (
            <li key={race.id}>
              <Link
                href={`/race/${race.season}/${race.round}`}
                className={`flex items-center justify-between px-2 py-2 text-sm transition-colors hover:bg-cyan-950/30 ${
                  isCurrent ? "bg-cyan-950/40" : ""
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <span className="hud-mono text-xs text-cyan-600">
                    R{String(race.round).padStart(2, "0")}
                  </span>
                  <span className={isCurrent ? "font-semibold text-cyan-300" : "text-slate-200"}>
                    {race.circuitName}
                  </span>
                  {race.country && <span className="text-slate-500">({race.country})</span>}
                  {isCurrent && (
                    <span className="hud-mono text-[10px] uppercase tracking-wider text-cyan-400">
                      ● live
                    </span>
                  )}
                </span>
                <span className="hud-mono text-xs text-slate-500">{race.date}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </HudPanel>
  );
}
