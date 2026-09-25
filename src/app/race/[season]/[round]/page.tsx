import { notFound } from "next/navigation";
import { getRaceByRoute } from "@/queries/races";
import { getAllSessionPaceForRace } from "@/queries/session-pace";
import { getYearOverYearComparison } from "@/queries/comparison";
import { RaceHeader } from "@/components/race-header";
import { ImportButton } from "@/components/import-button";
import { SessionPaceTable } from "@/components/session-pace-table";
import { RaceComparison } from "@/components/race-comparison";
import { PredictionStub } from "@/components/prediction-stub";

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

  const [sessionPace, comparison] = await Promise.all([
    getAllSessionPaceForRace(race.id),
    getYearOverYearComparison(season, round),
  ]);

  const hasRaceResult = sessionPace.r != null && sessionPace.r.length > 0;
  const raceHasHappened = new Date(race.date) <= new Date();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <RaceHeader race={race} />
        <ImportButton season={season} />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-bold">This weekend</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Object.entries(sessionPace).map(([type, rows]) => (
            <SessionPaceTable key={type} title={SESSION_LABELS[type] ?? type} rows={rows} />
          ))}
          {Object.keys(sessionPace).length === 0 && (
            <p className="text-sm text-gray-400">No session data yet for this race weekend.</p>
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
          <RaceComparison comparison={comparison} />
        </section>
      )}
    </main>
  );
}
