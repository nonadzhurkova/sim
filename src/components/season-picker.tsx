import Link from "next/link";

/**
 * Shared season-picker pills, used by standings/team/races pages — previously
 * each page hand-rolled the same `?season=` link-pill pattern independently.
 * A server component (plain links, no client state): the season lives in the
 * URL, so changing it is just a normal navigation, not something JS needs to
 * intercept.
 */
export function SeasonPicker({
  basePath,
  seasons,
  activeSeason,
}: {
  /** e.g. "/standings", "/team/12", "/races" — the picker appends `?season=N`. */
  basePath: string;
  seasons: number[];
  activeSeason: number;
}) {
  return (
    <div className="flex gap-2">
      {seasons.map((s) => (
        <Link
          key={s}
          href={`${basePath}?season=${s}`}
          className={`hud-mono border px-3 py-1 text-[11px] tracking-wider transition-colors ${
            s === activeSeason
              ? "border-red-500 bg-red-950/60 text-red-300"
              : "border-slate-800 text-slate-400 hover:border-slate-700"
          }`}
        >
          {s}
        </Link>
      ))}
    </div>
  );
}
