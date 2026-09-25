import type { CarPerformanceRow } from "@/queries/car-performance";
import { getTeamColor } from "@/lib/team-colors";
import { HudPanel } from "./hud-panel";

const TRACK_MAX_SECONDS = 1.5; // horizontal scale cap, matches the broadcast graphic's "0-3s" style axis

function TrendArrow({ trend, positionsChanged }: { trend: CarPerformanceRow["trend"]; positionsChanged: number | null }) {
  if (trend == null || positionsChanged == null) return <span className="hud-mono w-6 text-xs text-slate-600">—</span>;
  if (trend === "same") return <span className="hud-mono w-6 text-xs text-slate-500">–</span>;
  const isUp = trend === "up";
  return (
    <span className={`hud-mono flex w-6 items-center gap-0.5 text-xs ${isUp ? "text-green-400" : "text-red-400"}`}>
      {isUp ? "▲" : "▼"}
      {Math.abs(positionsChanged)}
    </span>
  );
}

export function CarPerformancePanel({
  rows,
  seasonLabel,
}: {
  rows: CarPerformanceRow[];
  seasonLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <HudPanel title={`Car Performance — ${seasonLabel}`}>
        <p className="hud-mono text-xs text-slate-500">NO TEAM RATING DATA YET</p>
      </HudPanel>
    );
  }

  return (
    <HudPanel title={`Car Performance — ${seasonLabel}`}>
      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const color = getTeamColor(r.teamName);
          const isLeader = r.rank === 1;
          const widthPct = Math.min(100, (r.gapToLeader / TRACK_MAX_SECONDS) * 100);
          return (
            <div key={r.teamId} className="flex items-center gap-3">
              <div className="w-32 shrink-0 truncate text-sm font-semibold text-slate-200">{r.teamName}</div>
              <TrendArrow trend={r.trend} positionsChanged={r.positionsChanged} />
              <div className="relative h-6 flex-1 overflow-hidden bg-slate-900/60">
                <div
                  className="hud-bar-fill absolute left-0 top-0 flex h-full items-center rounded-sm px-2"
                  style={{
                    width: `${Math.max(widthPct, 4)}%`,
                    backgroundColor: color,
                    opacity: 0.85,
                    boxShadow: isLeader ? `0 0 10px 1px ${color}` : undefined,
                  }}
                >
                  <span className="hud-mono truncate text-[10px] font-bold text-black/70">
                    {isLeader ? "FASTEST" : `-${r.gapToLeader.toFixed(2)}s`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </HudPanel>
  );
}
