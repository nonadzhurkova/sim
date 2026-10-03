import Link from "next/link";
import type { DriverStanding } from "@/queries/standings";
import { HudPanel } from "./hud-panel";
import { getTeamColor } from "@/lib/team-colors";

const MEDAL_COLORS = ["text-yellow-300", "text-slate-300", "text-amber-600"];

export function TopDriversPanel({ drivers, season }: { drivers: DriverStanding[]; season: number }) {
  const top5 = drivers.slice(0, 5);
  const leaderPoints = top5[0]?.points ?? 0;

  return (
    <HudPanel title="Drivers' Championship — Top 5">
      {top5.length === 0 ? (
        <p className="hud-mono text-xs text-slate-400">NO STANDINGS DATA FOR {season} YET.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {top5.map((d, i) => {
              const color = getTeamColor(d.teamName);
              const barPct = leaderPoints > 0 ? (d.points / leaderPoints) * 100 : 0;
              return (
                <li key={d.driverId}>
                  <Link
                    href={`/driver/${d.driverId}`}
                    className="flex items-center gap-3 border-t border-slate-800/60 py-2 transition-colors hover:bg-red-950/20 first:border-t-0"
                  >
                    <span className={`hud-mono w-5 shrink-0 text-base font-bold ${MEDAL_COLORS[i] ?? "text-slate-400"}`}>
                      {i + 1}
                    </span>
                    {d.headshotUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.headshotUrl}
                        alt=""
                        className="shrink-0 rounded-full border bg-slate-950 object-cover"
                        style={{ borderColor: color, height: 34, width: 34 }}
                      />
                    ) : (
                      <span
                        className="flex shrink-0 items-center justify-center rounded-full border bg-slate-950 text-xs font-bold text-slate-400"
                        style={{ borderColor: color, height: 34, width: 34 }}
                      >
                        {d.driverName
                          .split(/\s+/)
                          .map((p) => p[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">{d.driverName}</span>
                        <span className="hud-mono shrink-0 text-sm font-bold text-red-300">{d.points}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="hud-mono truncate text-[10px] text-slate-400">{d.teamName}</span>
                        <div className="relative h-1.5 flex-1 overflow-hidden bg-slate-900/60">
                          <div
                            className="hud-bar-fill h-full"
                            style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.85 }}
                          />
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            href={`/standings?season=${season}`}
            className="hud-mono mt-2 block w-full border-t border-slate-800/80 pt-2 text-center text-[11px] uppercase tracking-wider text-red-500 hover:text-red-300"
          >
            Full standings →
          </Link>
        </>
      )}
    </HudPanel>
  );
}
