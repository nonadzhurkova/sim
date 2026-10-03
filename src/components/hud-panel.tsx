import type { ReactNode } from "react";
import { getTeamColor } from "@/lib/team-colors";

/**
 * Section eyebrow + large heading, used above a major block of the page
 * (mirrors the treatment RaceHeader/RacePredictionPanel use for their own
 * titles) so every section reads with the same visual weight.
 */
export function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="hud-mono text-xs uppercase tracking-[0.16em] text-red-500">{eyebrow}</p>
      <h2 className="font-heading mt-1.5 text-4xl font-extrabold uppercase leading-none text-[#f2f3f5]">
        {title}
      </h2>
    </div>
  );
}

export const PODIUM_EDGE = ["#f3c13a", "#c9cfdb", "#e08a3c"];

/** Pre-quali (simulated grid, provisional) vs post-quali (real grid) accent colors -- used anywhere both stages are shown side by side so they're distinguishable at a glance, not just by label text. */
export const STAGE_COLOR = { preQuali: "#f3b23a", postQuali: "#34d399" };

function pct(v: number): string {
  if (v >= 0.995) return "100";
  if (v > 0 && v < 0.001) return "<0.1";
  return (v * 100).toFixed(1);
}

export type PodiumEntry = {
  id: number;
  name: string;
  team: string | null;
  winPct: number;
};

/** Last name only -- matches pace-projection-panel.tsx's own helper, kept local since both are small, private formatting utilities. */
function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

/**
 * Top-3 as large editorial cards -- used wherever a win-probability call is
 * the headline (race page's prediction panel, home page's next-race
 * preview), so both read as the same design rather than two near-alike
 * implementations drifting apart. Accented by each driver's team color
 * rather than podium gold/silver/bronze -- team identity is the more useful
 * signal here than finishing-order rank, which P1/P2/P3 already conveys.
 */
export function PodiumCards({ entries, isLive = false }: { entries: PodiumEntry[]; isLive?: boolean }) {
  const top3 = entries.slice(0, 3);
  if (top3.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {top3.map((d, i) => {
        const accent = getTeamColor(d.team);
        return (
          <article
            key={d.id}
            className="relative overflow-hidden border border-[#262a35] bg-[#12141a] p-6"
            style={{ borderTopWidth: 4, borderTopColor: accent }}
          >
            <div className="flex items-baseline gap-3">
              <span className="font-heading text-2xl font-extrabold" style={{ color: accent }}>
                P{i + 1}
              </span>
              <span className="hud-mono text-[11px] uppercase tracking-wider text-[#8a91a3]">
                {d.team ?? "—"}
              </span>
            </div>
            <div className="font-heading mt-2 text-3xl font-bold uppercase leading-tight text-[#f2f3f5]">
              {lastName(d.name)}
            </div>
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="hud-mono text-5xl font-medium leading-none" style={{ color: i === 0 ? accent : "#f2f3f5" }}>
                {pct(d.winPct)}
              </span>
              <span className="hud-mono text-xl text-[#a3a9b8]">%</span>
              <span className="ml-2 text-sm text-[#a3a9b8]">win probability</span>
            </div>
            <div className="relative mt-4 h-1.5 bg-[#1e212b]">
              <div
                className={isLive ? "h-1.5 transition-[width] duration-200 ease-out" : "hud-bar-fill h-1.5"}
                style={{ width: `${Math.max(d.winPct * 100, 2)}%`, backgroundColor: accent }}
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}

/**
 * Shared panel: flat bordered card on the dark editorial theme. Wraps
 * every card/table in the app so the border/background stays consistent
 * without repeating the same classes everywhere.
 */
export function HudPanel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`border border-[#262a35] bg-[#12141a] ${className}`}>
      {title && (
        <div className="border-b border-[#262a35] px-4 py-3">
          <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-red-400">
            {title}
          </h3>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
