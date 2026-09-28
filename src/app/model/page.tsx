import { getLatestSeason } from "@/queries/races";
import { getCurrentRace } from "@/queries/current-race";
import { getYearOverYearComparison } from "@/queries/comparison";
import { FreshnessBanner } from "@/components/freshness-banner";
import { RatingsPanel } from "@/components/ratings-panel";

/**
 * Developer/model-internals page, split out from the fan-facing home page —
 * data-import status and the model's own driver/team ratings aren't
 * something a visitor checking the next race's odds needs to see, but
 * they're genuinely useful when working on the model itself. Accepts an
 * optional `?race=<season>-<round>` (same idiom the driver page already uses
 * for its own optional race context) to inspect ratings as of a specific
 * race; defaults to the current/next one.
 */
export default async function ModelPage({
  searchParams,
}: {
  searchParams: Promise<{ race?: string }>;
}) {
  const { race: raceParam } = await searchParams;
  const season = await getLatestSeason();

  let targetSeason = season;
  let targetRound: number | null = null;
  if (raceParam) {
    const [s, r] = raceParam.split("-").map((n) => parseInt(n, 10));
    if (Number.isInteger(s) && Number.isInteger(r)) {
      targetSeason = s;
      targetRound = r;
    }
  }
  if (targetRound == null) {
    const currentRace = await getCurrentRace(targetSeason);
    targetRound = currentRace?.round ?? null;
  }

  const comparison = targetRound != null ? await getYearOverYearComparison(targetSeason, targetRound) : null;

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">Internal</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-100">Model</h1>
      <p className="hud-mono mt-1 text-xs text-slate-400">
        Data freshness, imports, and the model&apos;s own driver/team ratings — not fan-facing, kept off the home
        page.
      </p>

      <div className="mt-6">
        <FreshnessBanner season={season} />
      </div>

      {comparison ? (
        <div className="mt-6">
          <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
            {"//"} Ratings — {targetSeason} R{String(targetRound).padStart(2, "0")}
          </p>
          <div className="mt-4">
            <RatingsPanel snapshot={comparison.thisYear} />
          </div>
        </div>
      ) : (
        <p className="hud-mono mt-6 text-xs text-slate-400">
          NO RATINGS AVAILABLE YET FOR THIS RACE.
        </p>
      )}
    </main>
  );
}
