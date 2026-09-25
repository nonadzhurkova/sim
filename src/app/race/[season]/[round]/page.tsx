import { notFound } from "next/navigation";
import { getRaceByRoute } from "@/queries/races";
import { getAllSessionPaceForRace } from "@/queries/session-pace";
import { getYearOverYearComparison } from "@/queries/comparison";
import { RaceHeader } from "@/components/race-header";
import { ImportButton } from "@/components/import-button";
import { SessionPaceTable } from "@/components/session-pace-table";
import { RaceComparison } from "@/components/race-comparison";
import { RatingsPanel } from "@/components/ratings-panel";
import { PredictionStub } from "@/components/prediction-stub";
import { FastestLapBanner } from "@/components/fastest-lap-banner";
import { PaceProjectionPanel } from "@/components/pace-projection-panel";
import { CarPerformancePanel } from "@/components/car-performance-panel";
import { getCarPerformance } from "@/queries/car-performance";

const SESSION_LABELS: Record<string, string> = {
  fp1: "FP1",
  fp2: "FP2",
  fp3: "FP3",
  q: "Qualifying",
  r: "Race",
};

export default async function RacePage({
  params,
}: {
  params: Promise<{ season: string; round: string }>;
}) {
  const { season: seasonStr, round: roundStr } = await params;
  const season = parseInt(seasonStr, 10);
  const round = parseInt(roundStr, 10);

  const race = await getRaceByRoute(season, round);
  if (!race) notFound();

  const [sessionPace, comparison, carPerformance] = await Promise.all([
    getAllSessionPaceForRace(race.id),
    getYearOverYearComparison(season, round),
    getCarPerformance(season, race.id),
  ]);

  const hasRaceResult = sessionPace.r != null && sessionPace.r.length > 0;
  const raceHasHappened = new Date(race.date) <= new Date();
  const hasPracticeData = sessionPace.fp1 != null || sessionPace.fp2 != null || sessionPace.fp3 != null;

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <div className="flex items-center justify-between gap-4">
        <RaceHeader race={race} />
        <ImportButton season={season} />
      </div>

      <div className="mt-6">
        <CarPerformancePanel rows={carPerformance} seasonLabel={`${season} Season`} />
      </div>

      <div className="mt-6">
        <FastestLapBanner sessionPace={sessionPace} comparison={comparison} />
      </div>

      {hasPracticeData && (
        <section className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PaceProjectionPanel
            raceId={race.id}
            endpoint="/api/practice-pace"
            title="Projected Qualifying Pace (from practice so far)"
            emptyMessage="NO DRY PRACTICE LAPS AVAILABLE YET FOR THIS WEEKEND."
          />
          <PaceProjectionPanel
            raceId={race.id}
            endpoint="/api/race-pace-projection"
            title="Projected Race Pace (from long runs so far)"
            emptyMessage="NO LONG-RUN STINTS DETECTED YET FOR THIS WEEKEND."
          />
        </section>
      )}

      <section className="mt-8">
        <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
          {"//"} This weekend
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Object.entries(sessionPace).map(([type, rows]) => (
            <SessionPaceTable key={type} title={SESSION_LABELS[type] ?? type} rows={rows} />
          ))}
          {Object.keys(sessionPace).length === 0 && (
            <p className="hud-mono text-xs text-slate-500">
              NO SESSION DATA YET FOR THIS RACE WEEKEND.
            </p>
          )}
        </div>
      </section>

      {!raceHasHappened && !hasRaceResult && (
        <section className="mt-8">
          <PredictionStub />
        </section>
      )}

      {comparison && (
        <section className="mt-8">
          <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
            {"//"} Ratings
          </p>
          <div className="mt-4">
            <RatingsPanel snapshot={comparison.thisYear} />
          </div>
        </section>
      )}

      {comparison && (
        <section className="mt-8">
          <RaceComparison comparison={comparison} />
        </section>
      )}
    </main>
  );
}
