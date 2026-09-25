"use client";

import { useState } from "react";
import { HudPanel } from "./hud-panel";
import { TeamBadge } from "./team-badge";
import { getTeamColor } from "@/lib/team-colors";
import {
  PhaseDeltaChart,
  DeltaTraceChart,
  SpeedTraceChart,
  SectorBars,
  type PhaseDelta,
} from "./telemetry-charts";

type DriverSummary = {
  driverNumber: number;
  acronym: string;
  fullName: string;
  teamName: string | null;
  isTargetTeam: boolean;
  bestLap: number;
  bestSectors: [number | null, number | null, number | null];
  theoreticalBest: number | null;
  speedTrap: number | null;
  i1Speed: number | null;
  i2Speed: number | null;
  rank: number;
};

type RivalComparison = {
  rival: DriverSummary;
  lapDelta: number;
  sectors: { sector: 1 | 2 | 3; targetTime: number; rivalTime: number; delta: number }[];
  speedTrapDelta: number | null;
  worstSector: 1 | 2 | 3 | null;
  diagnosis: "engine" | "cornering" | "mixed" | "ahead";
};

type SessionAnalysis = {
  sessionType: "fp1" | "fp2" | "fp3" | "q" | "r";
  drivers: DriverSummary[];
  teamDrivers: DriverSummary[];
  leadDriver: DriverSummary | null;
  rivalsAhead: RivalComparison[];
};

type Report = {
  teamName: string;
  season: number;
  round: number;
  sessions: SessionAnalysis[];
  unavailableReason: string | null;
};

type LapComparison = {
  target: { acronym: string; teamName: string | null; lapDuration: number; topSpeed: number; fullThrottlePct: number; points: { speed: number }[] };
  rival: { acronym: string; teamName: string | null; lapDuration: number; topSpeed: number; fullThrottlePct: number; points: { speed: number }[] };
  deltaTrace: { distancePct: number; delta: number }[];
  phaseDeltas: PhaseDelta[];
  totalDelta: number;
};

const SESSION_LABELS: Record<string, string> = {
  fp1: "FP1",
  fp2: "FP2",
  fp3: "FP3",
  q: "Qualifying",
  r: "Race",
};

const DIAGNOSIS_TEXT: Record<RivalComparison["diagnosis"], { label: string; className: string }> = {
  engine: { label: "Engine / drag deficit", className: "text-red-400" },
  cornering: { label: "Cornering deficit", className: "text-amber-400" },
  mixed: { label: "Mixed — engine and corners", className: "text-orange-400" },
  ahead: { label: "Ahead", className: "text-green-400" },
};

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const rest = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${m}:${rest}`;
}

export function TeamAnalysisPanel({ raceId, team }: { raceId: number; team: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<string | null>(null);

  // Deep-dive telemetry for one chosen rival, fetched separately because it
  // pulls full-rate car data and is much heavier than the summary.
  const [lapState, setLapState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [lapComparison, setLapComparison] = useState<LapComparison | null>(null);
  const [lapError, setLapError] = useState<string | null>(null);
  const [activeRival, setActiveRival] = useState<number | null>(null);

  async function analyse() {
    setState("loading");
    setError(null);
    setLapComparison(null);
    setLapState("idle");
    setActiveRival(null);
    try {
      const res = await fetch(
        `/api/team-analysis?raceId=${raceId}&team=${encodeURIComponent(team)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }
      setReport(data);
      setActiveSession(data.sessions[0]?.sessionType ?? null);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setState("error");
    }
  }

  async function loadLapComparison(sessionType: string, targetNum: number, rivalNum: number) {
    setActiveRival(rivalNum);
    setLapState("loading");
    setLapError(null);
    try {
      const res = await fetch(
        `/api/lap-compare?raceId=${raceId}&session=${sessionType}&target=${targetNum}&rival=${rivalNum}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setLapError(data.error ?? `Request failed (${res.status})`);
        setLapState("error");
        return;
      }
      setLapComparison(data);
      setLapState("done");
    } catch (err) {
      setLapError(err instanceof Error ? err.message : "Telemetry failed");
      setLapState("error");
    }
  }

  const session = report?.sessions.find((s) => s.sessionType === activeSession) ?? null;
  const accent = getTeamColor(team);

  return (
    <HudPanel title={`${team} — Telemetry Analysis`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="hud-mono text-[11px] leading-relaxed text-slate-500">
          PULLS LIVE TIMING FROM OPENF1 AND COMPARES {team.toUpperCase()} AGAINST EVERY CAR
          AHEAD — SECTOR BY SECTOR, AND BY WHAT THE CAR IS DOING (STRAIGHTS, BRAKING,
          MID-CORNER, EXIT). NOTHING IS STORED.
        </p>
        <button
          onClick={analyse}
          disabled={state === "loading"}
          className="hud-mono shrink-0 border px-4 py-2 text-[11px] font-semibold uppercase tracking-widest shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: accent, color: accent }}
        >
          {state === "loading" ? "Analysing..." : state === "done" ? "Refresh" : "Run Analysis"}
        </button>
      </div>

      {state === "loading" && (
        <p className="hud-mono mt-3 text-xs text-cyan-400">
          FETCHING SESSION TIMING<span className="hud-ellipsis" />
        </p>
      )}
      {state === "error" && <p className="hud-mono mt-3 text-[11px] text-red-400">{error}</p>}

      {state === "done" && report && (
        <>
          {report.unavailableReason && (
            <p className="hud-mono mt-3 text-[11px] text-amber-400">
              ⚠ {report.unavailableReason}
            </p>
          )}

          {report.sessions.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {report.sessions.map((s) => (
                <button
                  key={s.sessionType}
                  onClick={() => {
                    setActiveSession(s.sessionType);
                    setLapComparison(null);
                    setLapState("idle");
                    setActiveRival(null);
                  }}
                  className={`hud-mono border px-3 py-1 text-[10px] uppercase tracking-widest transition-colors ${
                    activeSession === s.sessionType
                      ? "border-cyan-500 bg-cyan-950/60 text-cyan-300"
                      : "border-slate-800 text-slate-500 hover:border-slate-700"
                  }`}
                >
                  {SESSION_LABELS[s.sessionType] ?? s.sessionType}
                </button>
              ))}
            </div>
          )}

          {session && (
            <div className="mt-5">
              {/* team's own drivers */}
              <div className="flex flex-wrap gap-3">
                {session.teamDrivers.map((d) => (
                  <div
                    key={d.driverNumber}
                    className="flex items-center gap-3 border border-slate-800 bg-slate-900/40 px-3 py-2"
                    style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
                  >
                    <TeamBadge teamName={d.teamName} size={18} />
                    <div>
                      <div className="text-sm font-semibold text-slate-100">
                        {d.acronym}{" "}
                        <span className="hud-mono text-[10px] text-slate-500">P{d.rank}</span>
                      </div>
                      <div className="hud-mono text-[11px] text-cyan-300">{fmt(d.bestLap)}</div>
                    </div>
                    <div className="hud-mono border-l border-slate-800 pl-3 text-[10px] text-slate-500">
                      <div>TRAP {d.speedTrap ?? "—"} km/h</div>
                      {d.theoreticalBest != null && (
                        <div>IDEAL {fmt(d.theoreticalBest)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {session.teamDrivers.length === 0 && (
                <p className="hud-mono text-xs text-slate-500">
                  NO {team.toUpperCase()} DATA IN THIS SESSION.
                </p>
              )}

              {/* rivals ahead */}
              {session.leadDriver && session.rivalsAhead.length === 0 && (
                <p className="hud-mono mt-4 text-xs text-green-400">
                  ✓ {session.leadDriver.acronym} WAS FASTEST — NO CAR AHEAD TO COMPARE.
                </p>
              )}

              {session.rivalsAhead.length > 0 && session.leadDriver && (
                <div className="mt-5">
                  <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
                    {"//"} {session.leadDriver.acronym} vs cars ahead
                  </p>
                  <div className="mt-3 flex flex-col gap-3">
                    {session.rivalsAhead.map((c) => {
                      const d = DIAGNOSIS_TEXT[c.diagnosis];
                      const isOpen = activeRival === c.rival.driverNumber;
                      return (
                        <div key={c.rival.driverNumber} className="border border-slate-800/80">
                          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/40 px-3 py-2">
                            <div className="flex items-center gap-2">
                              <TeamBadge teamName={c.rival.teamName} size={16} />
                              <span className="text-sm font-semibold text-slate-100">
                                {c.rival.acronym}
                              </span>
                              <span className="hud-mono text-[10px] text-slate-500">
                                {c.rival.teamName}
                              </span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="hud-mono text-sm font-semibold text-red-400">
                                +{c.lapDelta.toFixed(3)}s
                              </span>
                              <span className={`hud-mono text-[10px] uppercase ${d.className}`}>
                                {d.label}
                              </span>
                              <span className="hud-mono text-[10px] text-slate-500">
                                TRAP{" "}
                                {c.speedTrapDelta != null
                                  ? `${c.speedTrapDelta >= 0 ? "+" : ""}${c.speedTrapDelta} km/h`
                                  : "—"}
                              </span>
                              <button
                                onClick={() =>
                                  isOpen
                                    ? setActiveRival(null)
                                    : loadLapComparison(
                                        session.sessionType,
                                        session.leadDriver!.driverNumber,
                                        c.rival.driverNumber,
                                      )
                                }
                                className="hud-mono border border-cyan-800 px-2 py-1 text-[10px] uppercase tracking-wider text-cyan-400 hover:border-cyan-500 hover:text-cyan-300"
                              >
                                {isOpen ? "Hide ▴" : "Telemetry ▾"}
                              </button>
                            </div>
                          </div>

                          <div className="px-3 py-3">
                            <SectorBars sectors={c.sectors} />
                          </div>

                          {isOpen && (
                            <div className="border-t border-slate-800/80 px-3 py-4">
                              {lapState === "loading" && (
                                <p className="hud-mono text-xs text-cyan-400">
                                  PULLING FULL-RATE TELEMETRY<span className="hud-ellipsis" />
                                </p>
                              )}
                              {lapState === "error" && (
                                <p className="hud-mono text-[11px] text-red-400">{lapError}</p>
                              )}
                              {lapState === "done" && lapComparison && (
                                <div className="flex flex-col gap-6">
                                  <PhaseDeltaChart
                                    phases={lapComparison.phaseDeltas}
                                    targetLabel={lapComparison.target.acronym}
                                    rivalLabel={lapComparison.rival.acronym}
                                  />
                                  <DeltaTraceChart
                                    trace={lapComparison.deltaTrace}
                                    targetLabel={lapComparison.target.acronym}
                                    rivalLabel={lapComparison.rival.acronym}
                                  />
                                  <SpeedTraceChart
                                    target={lapComparison.target}
                                    rival={lapComparison.rival}
                                  />
                                  <div className="hud-mono grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-4">
                                    <Stat
                                      label="Top speed"
                                      a={`${lapComparison.target.topSpeed}`}
                                      b={`${lapComparison.rival.topSpeed}`}
                                      unit="km/h"
                                    />
                                    <Stat
                                      label="Full throttle"
                                      a={lapComparison.target.fullThrottlePct.toFixed(0)}
                                      b={lapComparison.rival.fullThrottlePct.toFixed(0)}
                                      unit="%"
                                    />
                                    <Stat
                                      label="Lap time"
                                      a={lapComparison.target.lapDuration.toFixed(3)}
                                      b={lapComparison.rival.lapDuration.toFixed(3)}
                                      unit="s"
                                    />
                                    <div>
                                      <div className="text-[9px] uppercase tracking-wider text-slate-600">
                                        Total delta
                                      </div>
                                      <div className="text-sm font-semibold text-red-400">
                                        +{lapComparison.totalDelta.toFixed(3)}s
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </HudPanel>
  );
}

function Stat({ label, a, b, unit }: { label: string; a: string; b: string; unit: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="text-slate-200">
        {a}
        <span className="text-slate-600"> v {b}</span>{" "}
        <span className="text-[9px] text-slate-600">{unit}</span>
      </div>
    </div>
  );
}
