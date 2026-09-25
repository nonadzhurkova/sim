import { HudPanel } from "./hud-panel";

/** Reusable single-metric tile — matches the stat-card row pattern from dashboard references. */
export function StatTile({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <HudPanel>
      <p className="hud-mono text-[11px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className="hud-mono mt-1 text-2xl font-bold text-cyan-300">{value}</p>
      {sublabel && <p className="hud-mono mt-0.5 text-[11px] text-slate-500">{sublabel}</p>}
    </HudPanel>
  );
}
