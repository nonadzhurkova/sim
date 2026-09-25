import Link from "next/link";
import { notFound } from "next/navigation";
import { getRaceByRoute } from "@/queries/races";
import { db } from "@/db";
import { teams, raceResults, qualifyingResults } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { TeamSelector } from "@/components/team-selector";

/**
 * Per-team telemetry analysis for one race weekend.
 *
 * A subpage rather than part of the race page: the analysis pulls live from
 * OpenF1 at request time (nothing is stored), which takes seconds and is
 * rate-limited upstream, so it runs only when explicitly asked for.
 */
export default async function AnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ season: string; round: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const { season: seasonStr, round: roundStr } = await params;
  const { team: selectedTeam } = await searchParams;
  const season = parseInt(seasonStr, 10);
  const round = parseInt(roundStr, 10);

  const race = await getRaceByRoute(season, round);
  if (!race) notFound();

  // Teams that actually took part this weekend, so the selector isn't a list
  // of every constructor in history.
  const [qualiTeamIds, resultTeamIds] = await Promise.all([
    db
      .selectDistinct({ teamId: qualifyingResults.teamId })
      .from(qualifyingResults)
      .where(eq(qualifyingResults.raceId, race.id)),
    db
      .selectDistinct({ teamId: raceResults.teamId })
      .from(raceResults)
      .where(eq(raceResults.raceId, race.id)),
  ]);

  const teamIds = [
    ...new Set([...qualiTeamIds, ...resultTeamIds].map((t) => t.teamId)),
  ];

  const teamRows =
    teamIds.length > 0
      ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds))
      : await db.select({ id: teams.id, name: teams.name }).from(teams);

  const teamNames = [...new Set(teamRows.map((t) => t.name))].sort();

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <Link
        href={`/race/${season}/${round}`}
        className="hud-mono text-xs uppercase tracking-widest text-cyan-500 hover:text-cyan-300"
      >
        ← Back to race
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-slate-100">
        Telemetry Analysis
        <span className="ml-3 hud-mono text-sm font-normal text-slate-500">
          {race.circuitName} · {season} R{round}
        </span>
      </h1>
      <p className="hud-mono mt-1 text-[11px] text-slate-600">
        Live from OpenF1 · nothing stored · pick a team and run the analysis
      </p>

      <div className="mt-6">
        <TeamSelector
          raceId={race.id}
          teamNames={teamNames}
          initialTeam={selectedTeam ?? null}
        />
      </div>
    </main>
  );
}
