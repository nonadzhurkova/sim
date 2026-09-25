import type { RaceWeekendSnapshot } from "@/queries/comparison";
import { HudPanel } from "./hud-panel";
import { getTeamColor } from "@/lib/team-colors";

export function RatingsPanel({ snapshot }: { snapshot: RaceWeekendSnapshot }) {
  const sortedDrivers = [...snapshot.driverRatings].sort(
    (a, b) => (a.basePace ?? Infinity) - (b.basePace ?? Infinity),
  );
  const sortedTeams = [...snapshot.teamRatings].sort(
    (a, b) => (a.carStrength ?? Infinity) - (b.carStrength ?? Infinity),
  );

  if (sortedDrivers.length === 0 && sortedTeams.length === 0) {
    return (
      <HudPanel title="Ratings">
        <p className="hud-mono text-xs text-slate-500">NO RATING HISTORY YET (FIRST RACE OF SEASON)</p>
      </HudPanel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <HudPanel title="Driver Base Pace">
        <ul className="hud-mono text-xs">
          {sortedDrivers.map((d, i) => (
            <li
              key={d.driverId}
              className="flex items-center justify-between border-t border-slate-800/80 py-1.5 first:border-t-0"
            >
              <span className="flex items-center gap-2">
                <span className="text-slate-600">{i + 1}</span>
                <span className="text-slate-200">{d.driverName}</span>
              </span>
              <span className={d.basePace != null && d.basePace < 0 ? "text-cyan-300" : "text-slate-400"}>
                {d.basePace != null ? d.basePace.toFixed(3) : "—"}
              </span>
            </li>
          ))}
        </ul>
      </HudPanel>
      <HudPanel title="Team Car Strength">
        <ul className="hud-mono text-xs">
          {sortedTeams.map((t, i) => (
            <li
              key={t.teamId}
              className="flex items-center justify-between border-t border-slate-800/80 py-1.5 first:border-t-0"
              style={{ borderLeft: `3px solid ${getTeamColor(t.teamName)}` }}
            >
              <span className="flex items-center gap-2 pl-2">
                <span className="text-slate-600">{i + 1}</span>
                <span className="text-slate-200">{t.teamName}</span>
              </span>
              <span className={t.carStrength != null && t.carStrength < 0 ? "text-cyan-300" : "text-slate-400"}>
                {t.carStrength != null ? t.carStrength.toFixed(3) : "—"}
              </span>
            </li>
          ))}
        </ul>
      </HudPanel>
    </div>
  );
}
