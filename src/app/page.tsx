import { getLatestSeason, listRacesForSeason } from "@/queries/races";
import { getCurrentRace } from "@/queries/current-race";
import { checkFreshness } from "@/ingest/freshness";
import { FreshnessBanner } from "@/components/freshness-banner";
import { RaceList } from "@/components/race-list";
import { StatTile } from "@/components/stat-tile";
import { TitleOddsPanel } from "@/components/title-odds-panel";

export default async function Home() {
  const season = await getLatestSeason();
  const [races, currentRace, freshness] = await Promise.all([
    listRacesForSeason(season),
    getCurrentRace(season),
    checkFreshness(season),
  ]);

  const completedRaces = races.filter((r) => new Date(r.date) < new Date()).length;

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">System Online</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-100">F1 Race Predictor</h1>

      <div className="mt-6">
        <FreshnessBanner freshness={freshness} />
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

      <div className="mt-6">
        <TitleOddsPanel season={season} />
      </div>

      <div className="mt-6 max-w-3xl">
        <RaceList races={races} currentRaceId={currentRace?.id} />
      </div>
    </main>
  );
}
