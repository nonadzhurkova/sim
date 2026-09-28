import Link from "next/link";
import { notFound } from "next/navigation";
import { getRaceByRoute } from "@/queries/races";
import { buildPredictionReview } from "@/queries/prediction-review";
import { PredictionReviewTable } from "@/components/prediction-review-table";
import { Breadcrumbs } from "@/components/breadcrumbs";

/**
 * How the model's prediction for one already-run race compares to what
 * actually happened — the per-race detail behind the aggregate backtest
 * numbers (sim/backtest.ts). A subpage rather than part of the race page:
 * it re-runs a full simulation (thousands of iterations) at request time,
 * which only makes sense once a race has a real result to compare against.
 */
export default async function PredictionReviewPage({
  params,
}: {
  params: Promise<{ season: string; round: string }>;
}) {
  const { season: seasonStr, round: roundStr } = await params;
  const season = parseInt(seasonStr, 10);
  const round = parseInt(roundStr, 10);

  const race = await getRaceByRoute(season, round);
  if (!race) notFound();

  const review = await buildPredictionReview(race.id);

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-8 lg:px-10">
      <Breadcrumbs
        items={[
          { label: "Races", href: "/races" },
          { label: race.circuitName, href: `/race/${season}/${round}` },
          { label: "Prediction Review" },
        ]}
      />
      <div className="mt-2 flex items-center justify-between gap-4">
        <div>
          <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
            {season} {"//"} Round {String(round).padStart(2, "0")}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-100">{race.circuitName} — Prediction Review</h1>
        </div>
        <Link
          href={`/race/${season}/${round}`}
          className="hud-mono border border-cyan-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-cyan-400 transition-colors hover:border-cyan-500 hover:text-cyan-300"
        >
          ← Race Page
        </Link>
      </div>

      {!review ? (
        <p className="hud-mono mt-6 text-xs text-slate-400">
          NO RESULT YET FOR THIS RACE — NOTHING TO REVIEW UNTIL IT HAS BEEN RUN AND IMPORTED.
        </p>
      ) : (
        <PredictionReviewTable review={review} />
      )}
    </main>
  );
}
