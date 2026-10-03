import { getStandings } from "@/queries/standings";
import { getLatestSeason, getAllSeasons, resolveSeasonParam } from "@/queries/races";
import { StandingsTables } from "@/components/standings-tables";
import { SeasonPicker } from "@/components/season-picker";
import { SectionHeading } from "@/components/hud-panel";

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
  const [latest, seasons] = await Promise.all([getLatestSeason(), getAllSeasons()]);
  const season = resolveSeasonParam(seasonParam, seasons, latest);
  const standings = await getStandings(season);

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading eyebrow="Championship" title={`${season} Standings`} />
        <SeasonPicker basePath="/standings" seasons={seasons} activeSeason={season} />
      </div>

      {standings.roundsScored === 0 ? (
        <p className="hud-mono mt-6 text-xs text-slate-400">
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
            COMPUTED FROM RACE AND SPRINT CLASSIFICATIONS. THE FASTEST-LAP BONUS POINT IS NOT
            INCLUDED, SO TOTALS MAY DIFFER SLIGHTLY FROM THE OFFICIAL TABLE IN SEASONS THAT
            USED IT.
          </p>
        </div>
      )}
    </main>
  );
}
