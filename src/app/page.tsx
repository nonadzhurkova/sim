import { getLatestSeason, listRacesForSeason } from "@/queries/races";
import { getCurrentRace } from "@/queries/current-race";
import { checkFreshness } from "@/ingest/freshness";
import { FreshnessBanner } from "@/components/freshness-banner";
import { RaceList } from "@/components/race-list";

export default async function Home() {
  const season = await getLatestSeason();
  const [races, currentRace, freshness] = await Promise.all([
    listRacesForSeason(season),
    getCurrentRace(season),
    checkFreshness(season),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">F1 Race Predictor</h1>
      <p className="mt-1 text-sm text-gray-500">{season} season</p>

      <div className="mt-6">
        <FreshnessBanner freshness={freshness} />
      </div>

      <div className="mt-6">
        <RaceList races={races} currentRaceId={currentRace?.id} />
      </div>
    </main>
  );
}
