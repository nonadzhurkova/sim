import Link from "next/link";
import { getLatestSeason, listRacesForSeason } from "@/queries/races";
import { getCurrentRace } from "@/queries/current-race";
import { getStandings } from "@/queries/standings";
import { getNextRaceTopContenders } from "@/queries/next-race-outlook";
import { RaceList } from "@/components/race-list";
import { StatTile } from "@/components/stat-tile";
import { NextRaceCard } from "@/components/next-race-card";
import { TitleOddsPanel } from "@/components/title-odds-panel";
import { TopDriversPanel } from "@/components/top-drivers-panel";

export default async function Home() {
  const season = await getLatestSeason();
  const [races, currentRace, standings] = await Promise.all([
    listRacesForSeason(season),
    getCurrentRace(season),
    getStandings(season),
  ]);
  const nextRaceContenders = currentRace ? await getNextRaceTopContenders(currentRace.id) : null;

  const completedRaces = races.filter((r) => new Date(r.date) < new Date()).length;
  const driverTeamNames = new Map(standings.drivers.map((d) => [d.driverId, d.teamName]));

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">System Online</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-100">F1 Race Predictor</h1>

      {/* Next race leads the page -- it's what a returning visitor almost
          always wants first, ahead of season-wide stats. */}
      {currentRace && (
        <div className="mt-6">
          <NextRaceCard race={currentRace} contenders={nextRaceContenders} driverTeamNames={driverTeamNames} />
        </div>
      )}

      <div className="mt-6">
        <TitleOddsPanel season={season} />
      </div>

      <div className="mt-6">
        <RaceList races={races} currentRaceId={currentRace?.id} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Season" value={String(season)} />
        <StatTile label="Races Completed" value={`${completedRaces} / ${races.length}`} />
      </div>

      <div className="mt-6">
        <TopDriversPanel drivers={standings.drivers} season={season} />
        <Link
          href="/drivers"
          className="hud-mono mt-2 inline-block text-xs uppercase tracking-widest text-cyan-500 hover:text-cyan-300"
        >
          View all drivers →
        </Link>
      </div>
    </main>
  );
}
