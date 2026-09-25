import type { DriverSessionPace } from "@/queries/session-pace";
import { getTeamColor } from "@/lib/team-colors";
import { HudPanel } from "./hud-panel";

function formatLapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${rest}`;
}

function driverCode(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? name).slice(0, 3).toUpperCase();
}

export function SessionPaceTable({ title, rows }: { title: string; rows: DriverSessionPace[] }) {
  if (rows.length === 0) {
    return (
      <HudPanel title={title}>
        <p className="hud-mono text-xs text-slate-500">NO DATA</p>
      </HudPanel>
    );
  }

  return (
    <HudPanel title={title}>
      <table className="w-full text-sm">
        <thead>
          <tr className="hud-mono text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="py-1 pr-2 font-medium">Pos</th>
            <th className="py-1 pr-2 font-medium">Driver</th>
            <th className="py-1 pr-2 font-medium text-right">Time</th>
            <th className="py-1 font-medium text-right">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const color = getTeamColor(r.teamName);
            const isLeader = r.rank === 1;
            return (
              <tr
                key={r.driverId}
                className="border-t border-slate-800/80"
                style={{ borderLeft: `3px solid ${color}` }}
              >
                <td className="hud-mono py-1.5 pl-2 pr-2 text-slate-400">{r.rank}</td>
                <td className="py-1.5 pr-2">
                  <span className={isLeader ? "font-semibold text-cyan-300" : "text-slate-200"}>
                    {driverCode(r.driverName)}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">{r.teamName ?? ""}</span>
                </td>
                <td
                  className={`hud-mono py-1.5 pr-2 text-right ${isLeader ? "text-cyan-300" : "text-slate-300"}`}
                >
                  {formatLapTime(r.bestLap)}
                </td>
                <td className="hud-mono py-1.5 text-right text-slate-500">
                  {isLeader ? "—" : `+${r.gapToFastest.toFixed(3)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </HudPanel>
  );
}
