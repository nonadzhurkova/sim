import Link from "next/link";
import { db } from "@/db";
import { races } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getStandings } from "@/queries/standings";
import { getLatestSeason } from "@/queries/races";
import { StandingsTables } from "@/components/standings-tables";

/**
 * Championship standings, with a season picker.
 *
 * Derived from stored race results rather than ingested separately — see
 * queries/standings.ts for why, and for the sprint/fastest-lap caveat.
 */
export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const latest = await getLatestSeason();
  const requested = seasonParam ? parseInt(seasonParam, 10) : NaN;

  const seasonRows = await db
    .selectDistinct({ season: races.season })
    .from(races)
    .orderBy(desc(races.season));
  const seasons = seasonRows.map((r) => r.season);

  const season = seasons.includes(requested) ? requested : latest;
  const standings = await getStandings(season);

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">Championship</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-100">{season} Standings</h1>
        <div className="flex gap-2">
          {seasons.map((s) => (
            <Link
              key={s}
              href={`/standings?season=${s}`}
              className={`hud-mono border px-3 py-1 text-[11px] tracking-wider transition-colors ${
                s === season
                  ? "border-cyan-500 bg-cyan-950/60 text-cyan-300"
                  : "border-slate-800 text-slate-500 hover:border-slate-700"
              }`}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>

      {standings.roundsScored === 0 ? (
        <p className="hud-mono mt-6 text-xs text-slate-500">
          NO RACE RESULTS FOR {season} YET.
        </p>
      ) : (
        <div className="mt-6">
          <StandingsTables
            drivers={standings.drivers}
            teams={standings.teams}
            season={season}
            roundsScored={standings.roundsScored}
          />
          <p className="hud-mono mt-4 text-[10px] leading-relaxed text-slate-600">
            COMPUTED FROM RACE CLASSIFICATIONS. SPRINT RACES AND FASTEST-LAP BONUS POINTS ARE
            NOT INCLUDED, SO TOTALS MAY DIFFER SLIGHTLY FROM THE OFFICIAL TABLE IN SEASONS
            THAT USED THEM.
          </p>
        </div>
      )}
    </main>
  );
}
