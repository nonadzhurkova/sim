import Link from "next/link";
import { getLatestSeason } from "@/queries/races";
import { getCurrentRace } from "@/queries/current-race";
import { NavLinks } from "./nav-links";

/**
 * Server component (no "use client") so the "Next Race" shortcut can be
 * resolved directly from the DB rather than fetched client-side — the nav
 * renders once per request alongside the rest of the server-rendered shell.
 * The link list itself lives in NavLinks (a client component), since active-
 * link highlighting needs the current pathname.
 */
export async function NavBar() {
  const season = await getLatestSeason();
  const currentRace = await getCurrentRace(season);

  return (
    <header className="border-b border-cyan-900/60 bg-[#05070a]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-y-2 px-6 py-3 lg:px-10">
        <Link href="/" className="hud-mono text-sm font-bold tracking-widest text-cyan-400">
          F1// PREDICTOR
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs uppercase tracking-wider text-slate-400">
          <NavLinks />
          {currentRace && (
            <Link
              href={`/race/${currentRace.season}/${currentRace.round}`}
              className="hud-mono border border-cyan-700/70 bg-cyan-950/30 px-2.5 py-1 text-[11px] text-cyan-300 transition-colors hover:border-cyan-500 hover:bg-cyan-950/50"
            >
              Next Race →
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
