"use client";

import { useState } from "react";
import type { DriverSessionPace } from "@/queries/session-pace";
import { getTeamColor } from "@/lib/team-colors";
import { HudPanel } from "./hud-panel";
import { TeamBadge } from "./team-badge";

const INITIAL_ROW_COUNT = 10;

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
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) {
    return (
      <HudPanel title={title}>
        <p className="hud-mono text-xs text-slate-500">NO DATA</p>
      </HudPanel>
    );
  }

  const visibleRows = expanded ? rows : rows.slice(0, INITIAL_ROW_COUNT);
  const hiddenCount = rows.length - INITIAL_ROW_COUNT;

  return (
    <HudPanel title={title}>
      <table className="w-full text-sm">
        <thead>
          <tr className="hud-mono text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="py-1 pr-2 font-medium">Pos</th>
            <th className="py-1 pr-2 font-medium">Driver</th>
            <th className="py-1 font-medium text-right">Gap</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => {
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
                  {/* Team badge replaces the written team name: it identifies
                      the constructor in far less width, which keeps each row
                      on one line even in the narrow multi-column layout. The
                      leader's absolute lap time is in the title attribute, so
                      dropping the Time column loses nothing recoverable. */}
                  <span className="flex items-center gap-2">
                    <TeamBadge teamName={r.teamName} size={14} />
                    <span
                      className={isLeader ? "font-semibold text-cyan-300" : "text-slate-200"}
                      title={`${r.driverName} · ${r.teamName ?? "Unknown team"} · ${formatLapTime(r.bestLap)}`}
                    >
                      {driverCode(r.driverName)}
                    </span>
                  </span>
                </td>
                <td
                  className={`hud-mono py-1.5 text-right ${isLeader ? "text-cyan-300" : "text-slate-400"}`}
                >
                  {isLeader ? formatLapTime(r.bestLap) : `+${r.gapToFastest.toFixed(3)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > INITIAL_ROW_COUNT && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="hud-mono mt-2 w-full border-t border-slate-800/80 pt-2 text-center text-[11px] uppercase tracking-wider text-cyan-500 hover:text-cyan-300"
        >
          {expanded ? "Show less ▴" : `+${hiddenCount} more ▾`}
        </button>
      )}
    </HudPanel>
  );
}
