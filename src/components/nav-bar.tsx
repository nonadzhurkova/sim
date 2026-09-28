import Link from "next/link";
import { getLatestSeason } from "@/queries/races";
import { getCurrentRace } from "@/queries/current-race";

/**
 * Server component (no "use client") so the "Next Race" shortcut can be
 * resolved directly from the DB rather than fetched client-side — the nav
 * renders once per request alongside the rest of the server-rendered shell.
 */
export async function NavBar() {
  const season = await getLatestSeason();
  const currentRace = await getCurrentRace(season);

  return (
    <header className="border-b border-cyan-900/60 bg-[#05070a]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3 lg:px-10">
        <Link href="/" className="hud-mono text-sm font-bold tracking-widest text-cyan-400">
          F1// PREDICTOR
        </Link>
        <nav className="flex items-center gap-4 text-xs uppercase tracking-wider text-slate-400">
          <Link href="/" className="hover:text-cyan-300">
            Home
          </Link>
          <Link href="/races" className="hover:text-cyan-300">
            Races
          </Link>
          <Link href="/standings" className="hover:text-cyan-300">
            Standings
          </Link>
          <Link href="/drivers" className="hover:text-cyan-300">
            Drivers
          </Link>
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
