import Link from "next/link";
import { HudPanel } from "./hud-panel";

/** Reusable single-metric tile — matches the stat-card row pattern from dashboard references. */
export function StatTile({
  label,
  value,
  sublabel,
  href,
}: {
  label: string;
  value: string;
  sublabel?: string;
  /** When set, the whole tile links there and gets a hover affordance. */
  href?: string;
}) {
  const content = (
    <HudPanel className={href ? "transition-colors hover:bg-cyan-950/20" : undefined}>
      <p className="hud-mono text-[11px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className="hud-mono mt-1 text-2xl font-bold text-cyan-300">{value}</p>
      {sublabel && <p className="hud-mono mt-0.5 truncate text-[11px] text-slate-500">{sublabel}</p>}
    </HudPanel>
  );

  return href ? (
    <Link href={href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}
