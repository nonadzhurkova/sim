import { getLatestSeason, listRacesForSeason } from "@/queries/races";
import { getCurrentRace } from "@/queries/current-race";
import { getStandings } from "@/queries/standings";
import { getTopBasePace } from "@/queries/top-base-pace";
import { FreshnessBanner } from "@/components/freshness-banner";
import { RaceList } from "@/components/race-list";
import { StatTile } from "@/components/stat-tile";
import { TitleOddsPanel } from "@/components/title-odds-panel";
import { TopDriversPanel } from "@/components/top-drivers-panel";
import { TopBasePacePanel } from "@/components/top-base-pace-panel";

export default async function Home() {
  const season = await getLatestSeason();
  const [races, currentRace, standings] = await Promise.all([
    listRacesForSeason(season),
    getCurrentRace(season),
    getStandings(season),
  ]);
  const topBasePace = currentRace ? await getTopBasePace(currentRace.id) : [];

  const completedRaces = races.filter((r) => new Date(r.date) < new Date()).length;

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">System Online</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-100">F1 Race Predictor</h1>

      <div className="mt-6">
        <FreshnessBanner season={season} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Season" value={String(season)} />
        <StatTile label="Races Completed" value={`${completedRaces} / ${races.length}`} />
        <StatTile
          label="Current Round"
          value={currentRace ? `R${String(currentRace.round).padStart(2, "0")}` : "—"}
          sublabel={currentRace?.circuitName}
          href={currentRace ? `/race/${currentRace.season}/${currentRace.round}` : undefined}
        />
        <StatTile label="Next Race" value={currentRace?.date ?? "—"} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TopDriversPanel drivers={standings.drivers} season={season} />
        <TopBasePacePanel drivers={topBasePace} />
      </div>

      <div className="mt-6">
        <RaceList races={races} currentRaceId={currentRace?.id} />
      </div>

      <div className="mt-6">
        <TitleOddsPanel season={season} />
      </div>
    </main>
  );
}
