import type { ReactNode } from "react";

/**
 * Shared HUD-style panel: angular corner brackets, glowing cyan border,
 * dark translucent background. Wraps every card/table in the app so the
 * sci-fi dashboard aesthetic stays consistent without repeating the same
 * border/glow classes everywhere.
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
    <div
      className={`relative border border-cyan-900/60 bg-[#0b1015]/80 shadow-[0_0_20px_-8px_rgba(34,211,238,0.35)] ${className}`}
    >
      {/* corner brackets */}
      <span className="pointer-events-none absolute -left-px -top-px h-3 w-3 border-l-2 border-t-2 border-cyan-400" />
      <span className="pointer-events-none absolute -right-px -top-px h-3 w-3 border-r-2 border-t-2 border-cyan-400" />
      <span className="pointer-events-none absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 border-cyan-400" />
      <span className="pointer-events-none absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 border-cyan-400" />

      {title && (
        <div className="border-b border-cyan-900/60 px-4 py-2">
          <h3 className="hud-mono text-xs font-semibold uppercase tracking-widest text-cyan-400">
            {title}
          </h3>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
