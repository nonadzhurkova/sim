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
    <header className="border-b border-[#1e212b] bg-[#0b0c10]">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-y-3 px-6 py-3 lg:px-10">
        <Link
          href="/"
          className="font-heading flex items-center gap-2.5 text-xl font-extrabold uppercase tracking-wide text-[#f2f3f5]"
        >
          <span className="inline-block h-3.5 w-3.5 -skew-x-[14deg] bg-red-500" />
          F1 Predictor
        </Link>
        <nav className="flex flex-wrap items-center gap-x-7 gap-y-2 text-sm font-medium">
          <NavLinks />
          {currentRace && (
            <Link
              href={`/race/${currentRace.season}/${currentRace.round}`}
              className="font-heading bg-red-500 px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition-[filter] hover:brightness-110"
            >
              Next race
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
