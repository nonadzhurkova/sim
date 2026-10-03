import { getLatestSeason, getAllSeasons, resolveSeasonParam, listRacesForSeason } from "@/queries/races";
import { getCurrentRace } from "@/queries/current-race";
import { RaceList } from "@/components/race-list";
import { SeasonPicker } from "@/components/season-picker";
import { SectionHeading } from "@/components/hud-panel";

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
  const [latest, seasons] = await Promise.all([getLatestSeason(), getAllSeasons()]);
  const season = resolveSeasonParam(seasonParam, seasons, latest);

  const [raceRows, currentRace] = await Promise.all([
    listRacesForSeason(season),
    season === latest ? getCurrentRace(season) : Promise.resolve(null),
  ]);

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading eyebrow="Schedule" title={`${season} Races`} />
        <SeasonPicker basePath="/races" seasons={seasons} activeSeason={season} />
      </div>

      <div className="mt-6">
        <RaceList races={raceRows} currentRaceId={currentRace?.id} />
      </div>
    </main>
  );
}
