"use client";

import Link from "next/link";
import { useState } from "react";
import type { DriverStanding, TeamStanding } from "@/queries/standings";
import { HudPanel } from "./hud-panel";
import { TeamBadge } from "./team-badge";
import { getTeamColor } from "@/lib/team-colors";

/** Movement since the previous round. */
function PositionChange({ change }: { change: number | null }) {
  if (change == null) return <span className="hud-mono text-[10px] text-slate-700">—</span>;
  if (change === 0) return <span className="hud-mono text-[10px] text-slate-600">–</span>;
  const up = change > 0;
  return (
    <span className={`hud-mono text-[10px] ${up ? "text-green-400" : "text-red-400"}`}>
      {up ? "▲" : "▼"}
      {Math.abs(change)}
    </span>
  );
}

/**
 * Cumulative points through the season, one line per entrant.
 *
 * A standings table says who leads; this says how the lead was built — whether
 * someone pulled away steadily or the gap opened in a couple of races.
 */
function ProgressionChart({
  series,
}: {
  series: { label: string; color: string; points: { round: number; cumulative: number }[] }[];
}) {
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  if (series.length === 0 || series[0].points.length < 2) return null;

  const W = 900;
  const H = 260;
  const PAD_L = 42;
  const PAD_B = 22;
  const PAD_T = 10;
  const rounds = series[0].points.map((p) => p.round);
  const maxPoints = Math.max(...series.flatMap((s) => s.points.map((p) => p.cumulative)), 1);
  const x = (round: number) =>
    PAD_L + ((round - rounds[0]) / Math.max(1, rounds[rounds.length - 1] - rounds[0])) * (W - PAD_L - 8);
  const y = (points: number) => H - PAD_B - (points / maxPoints) * (H - PAD_B - PAD_T);

  // Round the axis to something readable rather than the raw maximum.
  const step = maxPoints > 300 ? 100 : maxPoints > 120 ? 50 : 25;
  const gridLines: number[] = [];
  for (let v = 0; v <= maxPoints; v += step) gridLines.push(v);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {gridLines.map((v) => (
          <g key={v}>
            <line x1={PAD_L} y1={y(v)} x2={W - 8} y2={y(v)} stroke="#1e293b" strokeWidth="1" />
            <text x={4} y={y(v) + 4} fill="#475569" fontSize="10" className="hud-mono">
              {v}
            </text>
          </g>
        ))}
        {rounds.map((r) => (
          <text
            key={r}
            x={x(r)}
            y={H - 6}
            fill="#475569"
            fontSize="9"
            textAnchor="middle"
            className="hud-mono"
          >
            {r}
          </text>
        ))}
        {series.map((s) => {
          const dimmed = hoverLabel != null && hoverLabel !== s.label;
          return (
            <polyline
              key={s.label}
              points={s.points.map((p) => `${x(p.round)},${y(p.cumulative)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={hoverLabel === s.label ? 3 : 2}
              opacity={dimmed ? 0.18 : 0.95}
              onMouseEnter={() => setHoverLabel(s.label)}
              onMouseLeave={() => setHoverLabel(null)}
              style={{ cursor: "pointer" }}
            />
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <button
            key={s.label}
            onMouseEnter={() => setHoverLabel(s.label)}
            onMouseLeave={() => setHoverLabel(null)}
            className="hud-mono text-[10px] transition-opacity"
            style={{
              color: s.color,
              opacity: hoverLabel != null && hoverLabel !== s.label ? 0.35 : 1,
            }}
          >
            ━ {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const CHART_ENTRANTS = 8;

export function StandingsTables({
  drivers,
  teams,
  season,
  roundsScored,
}: {
  drivers: DriverStanding[];
  teams: TeamStanding[];
  season: number;
  roundsScored: number;
}) {
  const [tab, setTab] = useState<"drivers" | "teams">("drivers");

  const driverSeries = drivers.slice(0, CHART_ENTRANTS).map((d) => ({
    label: d.driverName.split(/\s+/).pop() ?? d.driverName,
    color: getTeamColor(d.teamName),
    points: d.pointsByRound,
  }));
  const teamSeries = teams.slice(0, CHART_ENTRANTS).map((t) => ({
    label: t.teamName,
    color: getTeamColor(t.teamName),
    points: t.pointsByRound,
  }));

  const leader = tab === "drivers" ? drivers[0]?.points ?? 0 : teams[0]?.points ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["drivers", "teams"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`hud-mono border px-3 py-1.5 text-[11px] uppercase tracking-widest transition-colors ${
                tab === t
                  ? "border-cyan-500 bg-cyan-950/60 text-cyan-300"
                  : "border-slate-800 text-slate-500 hover:border-slate-700"
              }`}
            >
              {t === "drivers" ? "Drivers" : "Constructors"}
            </button>
          ))}
        </div>
        <p className="hud-mono text-[10px] uppercase tracking-wider text-slate-500">
          After round {roundsScored}
        </p>
      </div>

      <HudPanel title={`${season} points progression`}>
        <ProgressionChart series={tab === "drivers" ? driverSeries : teamSeries} />
        <p className="hud-mono mt-2 text-[9px] text-slate-600">
          TOP {CHART_ENTRANTS} SHOWN · HOVER A LINE TO ISOLATE IT
        </p>
      </HudPanel>

      <HudPanel title={tab === "drivers" ? "Drivers' Championship" : "Constructors' Championship"}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-2 font-medium">Pos</th>
                <th className="py-2 pr-2 font-medium" />
                <th className="py-2 pr-3 font-medium">
                  {tab === "drivers" ? "Driver" : "Constructor"}
                </th>
                <th className="py-2 pr-3 font-medium">
                  {tab === "drivers" ? "Team" : "Drivers"}
                </th>
                <th className="py-2 pr-3 font-medium text-right">Wins</th>
                <th className="py-2 pr-3 font-medium text-right">Podiums</th>
                <th className="py-2 pr-3 font-medium text-right">Points</th>
                <th className="py-2 font-medium">Gap</th>
              </tr>
            </thead>
            <tbody>
              {(tab === "drivers" ? drivers : teams).map((row) => {
                const isDriver = "driverId" in row;
                const teamName = isDriver ? (row as DriverStanding).teamName : (row as TeamStanding).teamName;
                const color = getTeamColor(teamName);
                const barPct = leader > 0 ? (row.points / leader) * 100 : 0;
                return (
                  <tr
                    key={isDriver ? `d${(row as DriverStanding).driverId}` : `t${(row as TeamStanding).teamId}`}
                    className="border-t border-slate-800/60"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <td className="hud-mono py-2 pl-2 pr-2 font-semibold text-slate-300">
                      {row.position}
                    </td>
                    <td className="py-2 pr-2">
                      <PositionChange change={row.positionChange} />
                    </td>
                    <td className="py-2 pr-3">
                      {isDriver ? (
                        <Link
                          href={`/driver/${(row as DriverStanding).driverId}`}
                          className="flex items-center gap-2 text-slate-100 hover:text-cyan-300"
                        >
                          {(row as DriverStanding).headshotUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={(row as DriverStanding).headshotUrl as string}
                              alt=""
                              className="rounded-full border bg-slate-950 object-cover"
                              style={{ borderColor: color, height: 26, width: 26 }}
                            />
                          ) : null}
                          <span className="font-medium">{row.driverName}</span>
                        </Link>
                      ) : (
                        <Link
                          href={`/team/${(row as TeamStanding).teamId}?season=${season}`}
                          className="flex items-center gap-2 font-medium text-slate-100 hover:text-cyan-300"
                        >
                          <TeamBadge teamName={teamName} size={16} />
                          {teamName}
                        </Link>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {isDriver ? (
                        <span className="flex items-center gap-1.5">
                          <TeamBadge teamName={teamName} size={12} />
                          <span className="hud-mono text-[10px] text-slate-500">{teamName}</span>
                        </span>
                      ) : (
                        <span className="hud-mono text-[10px] text-slate-500">
                          {(row as TeamStanding).driverNames
                            .map((n) => n.split(/\s+/).pop())
                            .join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="hud-mono py-2 pr-3 text-right text-yellow-300">
                      {row.wins || "—"}
                    </td>
                    <td className="hud-mono py-2 pr-3 text-right text-slate-300">
                      {row.podiums || "—"}
                    </td>
                    <td className="hud-mono py-2 pr-3 text-right text-base font-bold text-cyan-300">
                      {row.points}
                    </td>
                    <td className="py-2" style={{ minWidth: 140 }}>
                      <div className="flex items-center gap-2">
                        <div className="relative h-2 flex-1 overflow-hidden bg-slate-900/60">
                          <div
                            className="hud-bar-fill h-full"
                            style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.85 }}
                          />
                        </div>
                        <span className="hud-mono w-10 text-right text-[10px] text-slate-600">
                          {row.position === 1 ? "—" : `-${leader - row.points}`}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </HudPanel>
    </div>
  );
}
