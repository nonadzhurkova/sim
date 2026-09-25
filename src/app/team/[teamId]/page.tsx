import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { teams, drivers, races, circuits, raceResults, teamRatings } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getLatestSeason } from "@/queries/races";
import { getStandings, pointsForPosition } from "@/queries/standings";
import { HudPanel } from "@/components/hud-panel";
import { TeamBadge } from "@/components/team-badge";
import { getTeamColor } from "@/lib/team-colors";

/** Constructor page: season form, both drivers, and recent results. */
export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { teamId: teamIdStr } = await params;
  const { season: seasonParam } = await searchParams;
  const teamId = parseInt(teamIdStr, 10);
  if (!Number.isInteger(teamId)) notFound();

  const latest = await getLatestSeason();
  const requested = seasonParam ? parseInt(seasonParam, 10) : NaN;
  const season = Number.isInteger(requested) ? requested : latest;

  const [team] = await db
    .select({ id: teams.id, name: teams.name, engineSupplier: teams.engineSupplier })
    .from(teams)
    .where(eq(teams.id, teamId));
  if (!team) notFound();

  const results = await db
    .select({
      raceId: races.id,
      round: races.round,
      circuitName: circuits.name,
      driverId: raceResults.driverId,
      driverName: drivers.name,
      headshotUrl: drivers.headshotUrl,
      gridPosition: raceResults.gridPosition,
      finishPosition: raceResults.finishPosition,
      status: raceResults.status,
    })
    .from(raceResults)
    .innerJoin(races, eq(raceResults.raceId, races.id))
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .innerJoin(drivers, eq(raceResults.driverId, drivers.id))
    .where(and(eq(raceResults.teamId, teamId), eq(races.season, season)))
    .orderBy(desc(races.round));

  const standings = await getStandings(season);
  const standing = standings.teams.find((t) => t.teamId === teamId) ?? null;

  // Latest car-strength rating, the model's own view of the machinery.
  const [rating] = await db
    .select({ carStrength: teamRatings.carStrength, round: races.round })
    .from(teamRatings)
    .innerJoin(races, eq(teamRatings.raceId, races.id))
    .where(and(eq(teamRatings.teamId, teamId), eq(races.season, season)))
    .orderBy(desc(races.round))
    .limit(1);

  // Per-driver totals within the team.
  const byDriver = new Map<
    number,
    { driverId: number; name: string; headshotUrl: string | null; points: number; races: number; bestFinish: number | null }
  >();
  for (const r of results) {
    if (!byDriver.has(r.driverId)) {
      byDriver.set(r.driverId, {
        driverId: r.driverId,
        name: r.driverName,
        headshotUrl: r.headshotUrl,
        points: 0,
        races: 0,
        bestFinish: null,
      });
    }
    const d = byDriver.get(r.driverId)!;
    d.races++;
    if (r.status === "finished") {
      d.points += pointsForPosition(r.finishPosition);
      if (r.finishPosition != null && (d.bestFinish == null || r.finishPosition < d.bestFinish)) {
        d.bestFinish = r.finishPosition;
      }
    }
  }
  const teamDrivers = [...byDriver.values()].sort((a, b) => b.points - a.points);
  const accent = getTeamColor(team.name);

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <Link
        href="/standings"
        className="hud-mono text-xs uppercase tracking-widest text-cyan-500 hover:text-cyan-300"
      >
        ← Standings
      </Link>

      <div
        className="mt-4 flex flex-wrap items-center gap-4 border border-slate-800 bg-slate-900/40 p-5"
        style={{ borderLeftColor: accent, borderLeftWidth: 4 }}
      >
        <TeamBadge teamName={team.name} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-slate-100">{team.name}</h1>
          <p className="hud-mono mt-0.5 text-[11px] text-slate-500">
            {season}
            {team.engineSupplier ? ` · ${team.engineSupplier} power` : ""}
            {standing ? ` · P${standing.position} in the championship` : ""}
          </p>
        </div>
        {standing && (
          <div className="text-right">
            <div className="hud-mono text-[9px] uppercase tracking-wider text-slate-600">
              Points
            </div>
            <div className="text-3xl font-bold" style={{ color: accent }}>
              {standing.points}
            </div>
          </div>
        )}
      </div>

      {standing && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Championship" value={`P${standing.position}`} />
          <Stat label="Wins" value={String(standing.wins)} />
          <Stat label="Podiums" value={String(standing.podiums)} />
          <Stat
            label="Car strength"
            value={
              rating?.carStrength != null
                ? `${rating.carStrength >= 0 ? "+" : ""}${rating.carStrength.toFixed(3)}`
                : "—"
            }
            hint={rating ? `s/lap · after R${rating.round}` : undefined}
          />
        </div>
      )}

      <div className="mt-6">
        <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">{"//"} Drivers</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {teamDrivers.map((d) => (
            <Link
              key={d.driverId}
              href={`/driver/${d.driverId}`}
              className="flex items-center gap-3 border border-slate-800 bg-slate-900/30 p-3 transition-colors hover:bg-slate-900/70"
            >
              {d.headshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.headshotUrl}
                  alt=""
                  className="rounded-full border bg-slate-950 object-cover"
                  style={{ borderColor: accent, height: 48, width: 48 }}
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-100">{d.name}</div>
                <div className="hud-mono text-[10px] text-slate-500">
                  {d.races} races · best P{d.bestFinish ?? "—"}
                </div>
              </div>
              <div className="hud-mono text-xl font-bold text-cyan-300">{d.points}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <HudPanel title={`${season} results`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Round</th>
                  <th className="py-1.5 pr-3 font-medium">Circuit</th>
                  <th className="py-1.5 pr-3 font-medium">Driver</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Grid</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Finish</th>
                  <th className="py-1.5 font-medium text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={`${r.raceId}-${r.driverId}`} className="border-t border-slate-800/60">
                    <td className="hud-mono py-1.5 pr-3 text-slate-400">
                      <Link href={`/race/${season}/${r.round}`} className="hover:text-cyan-300">
                        R{r.round}
                      </Link>
                    </td>
                    <td className="truncate py-1.5 pr-3 text-slate-300">{r.circuitName}</td>
                    <td className="py-1.5 pr-3 text-slate-200">
                      {r.driverName.split(/\s+/).pop()}
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-slate-500">
                      {r.gridPosition ?? "—"}
                    </td>
                    <td
                      className={`hud-mono py-1.5 pr-3 text-right font-semibold ${
                        r.status !== "finished"
                          ? "text-red-400"
                          : r.finishPosition === 1
                            ? "text-yellow-300"
                            : (r.finishPosition ?? 99) <= 10
                              ? "text-green-400"
                              : "text-slate-400"
                      }`}
                    >
                      {r.status !== "finished"
                        ? r.status?.toUpperCase()
                        : (r.finishPosition ?? "—")}
                    </td>
                    <td className="hud-mono py-1.5 text-right text-cyan-300">
                      {r.status === "finished" ? pointsForPosition(r.finishPosition) || "—" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </HudPanel>
      </div>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-slate-800/80 bg-slate-900/30 px-3 py-2">
      <div className="hud-mono text-[9px] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-100">{value}</div>
      {hint && <div className="hud-mono text-[9px] text-slate-600">{hint}</div>}
    </div>
  );
}
