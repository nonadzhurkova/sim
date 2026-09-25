"use client";

import Link from "next/link";
import { useState } from "react";
import type { SeasonProjection } from "@/sim/season";
import { HudPanel } from "./hud-panel";
import { TeamBadge } from "./team-badge";
import { getTeamColor } from "@/lib/team-colors";
import { AnimatedNumber } from "./animated-number";

/**
 * Championship title odds for the current season.
 *
 * Each simulated season plays out every remaining race in sequence rather
 * than averaging independent race simulations — a title race depends on
 * correlated results (a fast car keeps winning), so independent races would
 * make a big points lead look far less safe than it is.
 */

function pct(v: number): string {
  if (v >= 0.9995) return "100";
  if (v > 0 && v < 0.001) return "<0.1";
  return (v * 100).toFixed(1);
}

function OddsRow({
  index,
  name,
  teamName,
  headshotUrl,
  currentPoints,
  projectedPoints,
  titlePct,
  positionPct,
  href,
}: {
  index: number;
  name: string;
  teamName: string | null;
  headshotUrl: string | null;
  currentPoints: number;
  projectedPoints: number;
  titlePct: number;
  positionPct: number[];
  href: string;
}) {
  const color = getTeamColor(teamName);
  const medal = ["text-yellow-300", "text-slate-300", "text-amber-600"][index] ?? "text-slate-500";
  const gain = Math.round(projectedPoints - currentPoints);

  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-t border-slate-800/60 py-2.5 transition-colors hover:bg-cyan-950/20"
    >
      <span className={`hud-mono w-5 shrink-0 text-base font-bold ${medal}`}>{index + 1}</span>
      {headshotUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={headshotUrl}
          alt=""
          className="shrink-0 rounded-full border bg-slate-950 object-cover"
          style={{ borderColor: color, height: 34, width: 34 }}
        />
      ) : (
        <TeamBadge teamName={teamName} size={22} className="shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-100">{name}</div>
        {/* Current and projected points side by side, at a readable size —
            the projected total is the substance of the prediction, not a
            footnote to the percentage. */}
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="hud-mono text-sm font-bold text-slate-300">{currentPoints}</span>
          <span className="hud-mono text-[10px] text-slate-600">now</span>
          <span className="text-slate-700">→</span>
          <span className="hud-mono text-sm font-bold" style={{ color }}>
            <AnimatedNumber value={projectedPoints} />
          </span>
          <span className="hud-mono text-[10px] text-slate-600">
            projected{gain > 0 ? ` (+${gain})` : ""}
          </span>
        </div>
      </div>

      {/* Stacked distribution across final championship positions. Once a
          title is effectively decided the single win probability stops being
          informative — this keeps showing where the real uncertainty is, e.g.
          who takes 2nd, 3rd or 4th. Segments transition their own width, so a
          shift in the odds visibly redistributes across the bar rather than
          just changing the number beside it. */}
      <div className="hidden w-32 shrink-0 items-center gap-2 md:flex lg:w-44">
        <div className="relative flex h-2.5 flex-1 overflow-hidden bg-slate-900/60">
          {positionPct.map((p, i) => (
            <div
              key={i}
              title={`P${i + 1}: ${pct(p)}%`}
              className="h-full transition-[width] duration-500 ease-out"
              style={{
                width: `${p * 100}%`,
                backgroundColor: color,
                // Later positions fade, so the bar reads as a gradient from
                // "wins the title" to "finishes further back".
                opacity: p > 0 ? 1 - i * 0.15 : 0,
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex w-16 shrink-0 items-center justify-end">
        <span className="hud-mono text-base font-bold text-cyan-300">
          <AnimatedNumber value={titlePct * 100} decimals={1} suffix="%" />
        </span>
      </div>
    </Link>
  );
}

export function TitleOddsPanel({ season }: { season: number }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [projection, setProjection] = useState<SeasonProjection | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);

  async function run() {
    setState("loading");
    setError(null);
    setProgress(null);
    try {
      const res = await fetch(`/api/season-projection?season=${season}`);
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }

      // NDJSON: one event per line, so partial odds can be rendered as the
      // simulation converges rather than after 40 seconds of nothing.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "progress") {
            setProjection(event.projection);
            setProgress({ completed: event.completed, total: event.total });
          } else if (event.type === "done") {
            setProjection(event.projection);
            setProgress(null);
            setState("done");
          } else if (event.type === "error") {
            setError(event.error);
            setState("error");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Projection failed");
      setState("error");
    }
  }

  // Not run yet, and nothing streamed back so far. Once partial results start
  // arriving the table below renders them live instead of this prompt.
  if (!projection) {
    return (
      <HudPanel title={`${season} Championship Prediction`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="hud-mono max-w-2xl text-[11px] leading-relaxed text-slate-500">
            SIMULATES EVERY REMAINING RACE OF THE SEASON AND ROLLS THE POINTS ONTO THE CURRENT
            STANDINGS, GIVING DRIVERS&apos; AND CONSTRUCTORS&apos; TITLE ODDS.
          </p>
          <button
            onClick={run}
            disabled={state === "loading"}
            className="hud-mono shrink-0 border border-cyan-500 bg-cyan-950/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-cyan-300 shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] transition-colors hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === "loading" ? "Simulating..." : "Predict Champions"}
          </button>
        </div>
        {state === "loading" && (
          <p className="hud-mono mt-3 text-xs text-cyan-400">
            RUNNING THE REST OF THE SEASON<span className="hud-ellipsis" />
          </p>
        )}
        {state === "error" && <p className="hud-mono mt-3 text-[11px] text-red-400">{error}</p>}
      </HudPanel>
    );
  }

  if (projection.complete) {
    return (
      <HudPanel title={`${projection.season} Championship — final`}>
        <p className="hud-mono text-xs text-slate-500">
          SEASON COMPLETE ·{" "}
          <span className="text-yellow-300">{projection.drivers[0]?.name}</span> and{" "}
          <span className="text-yellow-300">{projection.teams[0]?.name}</span> took the titles.
        </p>
      </HudPanel>
    );
  }

  const header = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="hud-mono text-[10px] uppercase tracking-wider text-slate-600">
          {projection.iterations === 0
            ? "current standings · simulation starting"
            : `${projection.iterations
                .toString()
                .replace(/\B(?=(\d{3})+(?!\d))/g, ",")} simulated seasons from the standings after round ${projection.roundsScored}`}
        </p>
        {state === "loading" ? (
          <span className="hud-mono text-[10px] uppercase tracking-wider text-cyan-400">
            {projection.iterations === 0 ? "loading races" : "converging"}
            <span className="hud-ellipsis" />
          </span>
        ) : (
          <button
            onClick={run}
            className="hud-mono border border-slate-700 px-2 py-1 text-[9px] uppercase tracking-wider text-slate-400 transition-colors hover:border-cyan-600 hover:text-cyan-300"
          >
            Re-run
          </button>
        )}
      </div>
      {progress && (
        <div className="relative mt-2 h-1 overflow-hidden bg-slate-900/80">
          <div
            className="h-full bg-cyan-400 shadow-[0_0_8px_0_rgba(34,211,238,0.7)] transition-[width] duration-200 ease-linear"
            style={{ width: `${(progress.completed / progress.total) * 100}%` }}
          />
        </div>
      )}
    </>
  );

  // Side by side inside one panel, but each half keeps its own heading and a
  // solid divider between them — close together read as one flat list, and a
  // driver's row lined up against an unrelated constructor's row looked like
  // that driver raced for that team.
  return (
    <HudPanel
      title={`${projection.season} Championship Prediction — ${projection.racesRemaining} races left`}
    >
      {header}

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-0">
        <div className="lg:pr-6">
          <p className="hud-mono text-xs font-bold uppercase tracking-widest text-cyan-400">
            {"//"} Drivers&apos; Championship
          </p>
          <div className="mt-2">
            {projection.drivers.slice(0, 6).map((d, i) => (
              <OddsRow
                key={d.id}
                index={i}
                name={d.name}
                teamName={d.teamName}
                headshotUrl={d.headshotUrl}
                currentPoints={d.currentPoints}
                projectedPoints={d.projectedPoints}
                titlePct={d.titlePct}
                positionPct={d.positionPct}
                href={`/driver/${d.id}`}
              />
            ))}
          </div>
        </div>

        <div className="border-t border-slate-800 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="hud-mono text-xs font-bold uppercase tracking-widest text-cyan-400">
            {"//"} Constructors&apos; Championship
          </p>
          <div className="mt-2">
            {projection.teams.slice(0, 6).map((t, i) => (
              <OddsRow
                key={t.id}
                index={i}
                name={t.name}
                teamName={t.teamName}
                headshotUrl={null}
                currentPoints={t.currentPoints}
                projectedPoints={t.projectedPoints}
                titlePct={t.titlePct}
                positionPct={t.positionPct}
                href={`/team/${t.id}?season=${projection.season}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/60 pt-3">
        <p className="hud-mono text-[9px] text-slate-600">
          BAR SHOWS THE FULL SPREAD OF FINISHING POSITIONS — HOVER A SEGMENT FOR THE ODDS OF
          EACH. THE FIGURE ON THE RIGHT IS THE TITLE CHANCE.
        </p>
        <Link
          href="/standings"
          className="hud-mono shrink-0 text-[10px] uppercase tracking-wider text-cyan-500 hover:text-cyan-300"
        >
          Full standings →
        </Link>
      </div>
    </HudPanel>
  );
}
