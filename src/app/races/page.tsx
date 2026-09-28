import Link from "next/link";
import { db } from "@/db";
import { races } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getLatestSeason, listRacesForSeason } from "@/queries/races";
import { getCurrentRace } from "@/queries/current-race";
import { RaceList } from "@/components/race-list";

/**
 * Full season calendar as its own page — previously the only way to reach
 * any race was clicking through the home page's calendar panel, with no nav
 * entry or direct URL for "show me the schedule." Reuses RaceList as-is;
 * this page's job is just the season-picker chrome around it.
 */
export default async function RacesPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const latest = await getLatestSeason();
  const requested = seasonParam ? parseInt(seasonParam, 10) : NaN;

  const seasonRows = await db.selectDistinct({ season: races.season }).from(races).orderBy(desc(races.season));
  const seasons = seasonRows.map((r) => r.season);

  const season = seasons.includes(requested) ? requested : latest;
  const [raceRows, currentRace] = await Promise.all([
    listRacesForSeason(season),
    season === latest ? getCurrentRace(season) : Promise.resolve(null),
  ]);

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">Schedule</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-100">{season} Races</h1>
        <div className="flex gap-2">
          {seasons.map((s) => (
            <Link
              key={s}
              href={`/races?season=${s}`}
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

      <div className="mt-6">
        <RaceList races={raceRows} currentRaceId={currentRace?.id} />
      </div>
    </main>
  );
}
