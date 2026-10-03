import { getLatestSeason, getAllSeasons, resolveSeasonParam } from "@/queries/races";
import { getSeasonPredictionReview } from "@/queries/race-prediction";
import { SectionHeading } from "@/components/hud-panel";
import { SeasonPicker } from "@/components/season-picker";
import { SeasonReviewStats } from "@/components/season-review-stats";
import { SeasonReviewRaceRow } from "@/components/season-review-race-row";

/**
 * Season-wide "how did the model do" page: pre-quali vs post-quali hit
 * rates, calibration, and a per-race breakdown of each stage's top-3 call
 * against the actual podium. Built entirely from getPredictionStages per
 * race (same source as each race page's own "Prediction over time" panel),
 * so a genuine frozen run and a flagged retroactive reconstruction are
 * distinguished exactly the same way here as there. `?season=` query param
 * to match standings/races/team's existing season-picker convention, rather
 * than a `[season]` route segment.
 */
export default async function SeasonReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const [latest, seasons] = await Promise.all([getLatestSeason(), getAllSeasons()]);
  const season = resolveSeasonParam(seasonParam, seasons, latest);

  const summary = await getSeasonPredictionReview(season);

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading eyebrow="Model review" title={`${season} Prediction Review`} />
        <SeasonPicker basePath="/review" seasons={seasons} activeSeason={season} />
      </div>

      <p className="mt-4 max-w-2xl text-sm text-[#a3a9b8]">
        How the model&apos;s top-3 call held up at two points in each race weekend: before
        qualifying (simulated grid) and after qualifying but before the race (real grid),
        compared against who actually finished on the podium.
      </p>

      {summary.races.length === 0 ? (
        <p className="mt-10 text-sm text-[#5a6175]">No finished races yet this season.</p>
      ) : (
        <>
          <div className="mt-8">
            <SeasonReviewStats summary={summary} />
          </div>

          <div className="mt-10 flex flex-col gap-3">
            {summary.races.map((row) => (
              <SeasonReviewRaceRow key={row.raceId} row={row} season={season} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
