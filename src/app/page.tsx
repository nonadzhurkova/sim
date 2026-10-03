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
import { SectionHeading } from "@/components/hud-panel";

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
      <SectionHeading eyebrow="System online" title="F1 Race Predictor" />

      {/* Next race leads the page -- it's what a returning visitor almost
          always wants first, ahead of season-wide stats. */}
      {currentRace && (
        <div className="mt-8">
          <NextRaceCard race={currentRace} contenders={nextRaceContenders} driverTeamNames={driverTeamNames} />
        </div>
      )}

      <div className="mt-8">
        <TitleOddsPanel season={season} />
      </div>

      <div className="mt-8">
        <RaceList races={races} currentRaceId={currentRace?.id} />
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Season" value={String(season)} />
        <StatTile label="Races Completed" value={`${completedRaces} / ${races.length}`} />
      </div>

      <div className="mt-8">
        <TopDriversPanel drivers={standings.drivers} season={season} />
        <Link
          href="/drivers"
          className="hud-mono mt-2 inline-block text-xs uppercase tracking-widest text-red-500 hover:text-red-300"
        >
          View all drivers →
        </Link>
      </div>
    </main>
  );
}
