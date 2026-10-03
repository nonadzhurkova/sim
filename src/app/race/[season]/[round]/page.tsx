import Link from "next/link";
import { notFound } from "next/navigation";
import { getRaceByRoute, getAdjacentRaces } from "@/queries/races";
import { getAllSessionPaceForRace } from "@/queries/session-pace";
import { getYearOverYearComparison } from "@/queries/comparison";
import { buildPredictionReview } from "@/queries/prediction-review";
import { RaceHeader } from "@/components/race-header";
import { SessionPaceTable } from "@/components/session-pace-table";
import { RaceComparison } from "@/components/race-comparison";
import { RacePredictionPanel } from "@/components/race-prediction-panel";
import { RaceResultSummary } from "@/components/race-result-summary";
import { FastestLapBanner } from "@/components/fastest-lap-banner";
import { PaceProjectionPanel } from "@/components/pace-projection-panel";
import { CarPerformancePanel } from "@/components/car-performance-panel";
import { getCarPerformance } from "@/queries/car-performance";
import { SectionHeading } from "@/components/hud-panel";
import { SessionTabBar } from "@/components/session-tab-bar";

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
    <>
      <SessionTabBar raceId={race.id} raceDateLabel={race.date} />
      <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <RaceHeader race={race} adjacentRaces={adjacentRaces} />
        <div className="flex flex-wrap items-center gap-3">
          {/* Each of these three leads to a page that has nothing to show
              until its own prerequisite exists -- hidden rather than shown
              as a dead end, same "don't link to an empty page" judgment the
              rest of the app already makes (e.g. NextRaceCard's empty state). */}
          {isFinished && (
            <Link
              href={`/race/${season}/${round}/prediction-review`}
              className="hud-mono border border-red-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-red-400 transition-colors hover:border-red-500 hover:text-red-300"
            >
              Prediction Review →
            </Link>
          )}
          {hasPracticeData && (
            <Link
              href={`/race/${season}/${round}/analysis`}
              className="hud-mono border border-red-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-red-400 transition-colors hover:border-red-500 hover:text-red-300"
            >
              Telemetry Analysis →
            </Link>
          )}
          {comparison && (
            <Link
              href={`/model?race=${season}-${round}`}
              className="hud-mono border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
            >
              Model Ratings →
            </Link>
          )}
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
        <section id="race" className="mt-6 scroll-mt-24">
          <RaceResultSummary review={review} season={season} round={round} />
        </section>
      ) : (
        <section id="race" className="mt-6 scroll-mt-24">
          <RacePredictionPanel raceId={race.id} />
        </section>
      )}

      <div className="mt-8">
        <FastestLapBanner sessionPace={sessionPace} comparison={comparison} />
      </div>

      <section className="mt-10 flex flex-col gap-6">
        <SectionHeading eyebrow="This weekend" title="Session results" />
        {(() => {
          const withData = Object.entries(sessionPace).filter(([, rows]) => rows.length > 0);
          const withoutData = (["r", "q", "fp3", "fp2", "fp1"] as const).filter(
            (type) => !(sessionPace[type]?.length),
          );
          return (
            <>
              {withData.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {withData.map(([type, rows]) => (
                    <div key={type} id={`session-${type}`} className="scroll-mt-24">
                      <SessionPaceTable title={SESSION_LABELS[type] ?? type} rows={rows} />
                    </div>
                  ))}
                </div>
              )}
              {withoutData.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border border-dashed border-[#2e3340] px-5 py-4 text-[#a3a9b8]">
                  <span className="hud-mono text-[11px] uppercase tracking-wider text-[#8a91a3]">
                    Not run yet
                  </span>
                  {withoutData.map((type) => (
                    <span key={type} id={`session-${type}`} className="scroll-mt-24 text-sm font-semibold">
                      {SESSION_LABELS[type]}
                    </span>
                  ))}
                </div>
              )}
            </>
          );
        })()}
      </section>

      {hasPracticeData && (
        <section className="mt-10 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="flex flex-col gap-5 xl:col-span-2">
            <SectionHeading eyebrow="From practice so far" title="Projected pace" />
          </div>
          <PaceProjectionPanel
            raceId={race.id}
            endpoint="/api/practice-pace"
            title="Projected Qualifying Pace"
            emptyMessage="NO DRY PRACTICE LAPS AVAILABLE YET FOR THIS WEEKEND."
          />
          <PaceProjectionPanel
            raceId={race.id}
            endpoint="/api/race-pace-projection"
            title="Projected Race Pace"
            emptyMessage="NO LONG-RUN STINTS DETECTED YET FOR THIS WEEKEND."
          />
        </section>
      )}

      <section className="mt-10 flex flex-col gap-5">
        <SectionHeading eyebrow={`${season} season`} title="Car performance" />
        <CarPerformancePanel rows={carPerformance} seasonLabel={`${season} Season`} />
      </section>

      {isFinished && (
        <div className="mt-10">
          <RacePredictionPanel raceId={race.id} />
        </div>
      )}

      {comparison && (
        <section className="mt-8">
          <RaceComparison comparison={comparison} />
        </section>
      )}
      </main>
    </>
  );
}
