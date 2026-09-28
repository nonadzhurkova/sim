import Link from "next/link";
import type { BasePaceRow } from "@/queries/top-base-pace";
import { HudPanel } from "./hud-panel";
import { getTeamColor } from "@/lib/team-colors";

export function TopBasePacePanel({ drivers }: { drivers: BasePaceRow[] }) {
  const fastest = drivers[0]?.basePace ?? 0;
  const slowest = drivers[drivers.length - 1]?.basePace ?? 0;
  const spread = Math.max(slowest - fastest, 1e-6);

  return (
    <HudPanel title="Drivers' Base Pace — Top 5">
      {drivers.length === 0 ? (
        <p className="hud-mono text-xs text-slate-500">NO RATING DATA YET.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {drivers.map((d, i) => {
            const color = getTeamColor(d.teamName);
            const barPct = 100 - ((d.basePace - fastest) / spread) * 100;
            return (
              <li key={d.driverId}>
                <Link
                  href={`/driver/${d.driverId}`}
                  className="flex items-center gap-3 border-t border-slate-800/60 py-2 transition-colors hover:bg-cyan-950/20 first:border-t-0"
                >
                  <span className="hud-mono w-5 shrink-0 text-base font-bold text-slate-500">{i + 1}</span>
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
                      <span className="hud-mono shrink-0 text-sm font-bold text-cyan-300">
                        {d.basePace.toFixed(3)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="hud-mono truncate text-[10px] text-slate-500">{d.teamName ?? ""}</span>
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
      )}
      <p className="hud-mono mt-2 text-[10px] leading-relaxed text-slate-600">
        FIELD-RELATIVE RACE PACE, SECONDS/LAP. NEGATIVE = FASTER THAN AVERAGE.
      </p>
    </HudPanel>
  );
}
