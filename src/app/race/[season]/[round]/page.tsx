import Link from "next/link";
import { notFound } from "next/navigation";
import { getRaceByRoute, getAdjacentRaces } from "@/queries/races";
import { getAllSessionPaceForRace } from "@/queries/session-pace";
import { getYearOverYearComparison } from "@/queries/comparison";
import { buildPredictionReview } from "@/queries/prediction-review";
import { RaceHeader } from "@/components/race-header";
import { SessionSchedulePanel } from "@/components/session-schedule-panel";
import { SessionPaceTable } from "@/components/session-pace-table";
import { RaceComparison } from "@/components/race-comparison";
import { RacePredictionPanel } from "@/components/race-prediction-panel";
import { RaceResultSummary } from "@/components/race-result-summary";
import { FastestLapBanner } from "@/components/fastest-lap-banner";
import { PaceProjectionPanel } from "@/components/pace-projection-panel";
import { CarPerformancePanel } from "@/components/car-performance-panel";
import { getCarPerformance } from "@/queries/car-performance";

const SESSION_LABELS: Record<string, string> = {
  fp1: "FP1",
  fp2: "FP2",
  fp3: "FP3",
  sprint_quali: "Sprint Quali",
  sprint: "Sprint",
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

  const [sessionPace, comparison, carPerformance, adjacentRaces, review] = await Promise.all([
    getAllSessionPaceForRace(race.id),
    getYearOverYearComparison(season, round),
    getCarPerformance(season, race.id),
    getAdjacentRaces(race.date),
    buildPredictionReview(race.id),
  ]);

  const hasPracticeData = sessionPace.fp1 != null || sessionPace.fp2 != null || sessionPace.fp3 != null;
  // buildPredictionReview returns null specifically when the race has no
  // result yet (see its own doc comment) -- the same signal this page uses
  // to decide whether to lead with "here's the result" or "here's the
  // upcoming prediction."
  const isFinished = review != null;

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <div className="flex items-center justify-between gap-4">
        <RaceHeader race={race} adjacentRaces={adjacentRaces} />
        <div className="flex items-center gap-3">
          <Link
            href={`/race/${season}/${round}/prediction-review`}
            className="hud-mono border border-cyan-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-cyan-400 transition-colors hover:border-cyan-500 hover:text-cyan-300"
          >
            Prediction Review →
          </Link>
          <Link
            href={`/race/${season}/${round}/analysis`}
            className="hud-mono border border-cyan-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-cyan-400 transition-colors hover:border-cyan-500 hover:text-cyan-300"
          >
            Telemetry Analysis →
          </Link>
          <Link
            href={`/model?race=${season}-${round}`}
            className="hud-mono border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
          >
            Model Ratings →
          </Link>
        </div>
      </div>

      {/* Prediction leads the page before/during a race weekend, since that's
          what most visitors come here for. Once the race is decided, a
          visitor is more likely asking "what happened, and did the model get
          it right" than "run me a simulation" -- so a finished race leads
          with RaceResultSummary (result vs. frozen prediction) instead, and
          the interactive RacePredictionPanel (still useful for validation,
          see its own comment) moves further down rather than disappearing. */}
      {isFinished ? (
        <section className="mt-6">
          <RaceResultSummary review={review} season={season} round={round} />
        </section>
      ) : (
        <section className="mt-6">
          <RacePredictionPanel raceId={race.id} />
        </section>
      )}

      <div className="mt-6">
        <SessionSchedulePanel raceId={race.id} />
      </div>

      <section className="mt-8">
        <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
          {"//"} This weekend
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Object.entries(sessionPace).map(([type, rows]) => (
            <SessionPaceTable key={type} title={SESSION_LABELS[type] ?? type} rows={rows} />
          ))}
          {Object.keys(sessionPace).length === 0 && (
            <p className="hud-mono text-xs text-slate-400">
              NO SESSION DATA YET FOR THIS RACE WEEKEND.
            </p>
          )}
        </div>
      </section>

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

      {isFinished && (
        <section className="mt-8">
          <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
            {"//"} Model prediction (interactive)
          </p>
          <div className="mt-4">
            <RacePredictionPanel raceId={race.id} />
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
