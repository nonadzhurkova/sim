import Link from "next/link";
import { db } from "@/db";
import { drivers, teams, raceResults, races } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getLatestSeason } from "@/queries/races";
import { getStandings } from "@/queries/standings";
import { TeamBadge } from "@/components/team-badge";
import { getTeamColor } from "@/lib/team-colors";

/** Driver index for the current season, as a grid of cards, ordered by the constructors' championship. */
export default async function DriversPage() {
  const season = await getLatestSeason();

  // Every driver who has a result this season, with their most recent team.
  const [rows, standings] = await Promise.all([
    db
      .select({
        driverId: drivers.id,
        name: drivers.name,
        driverNumber: drivers.driverNumber,
        headshotUrl: drivers.headshotUrl,
        teamName: teams.name,
        round: races.round,
      })
      .from(raceResults)
      .innerJoin(drivers, eq(raceResults.driverId, drivers.id))
      .innerJoin(teams, eq(raceResults.teamId, teams.id))
      .innerJoin(races, eq(raceResults.raceId, races.id))
      .where(eq(races.season, season))
      .orderBy(desc(races.round)),
    getStandings(season),
  ]);

  // First row per driver wins, which is their latest team this season.
  const byDriver = new Map<number, (typeof rows)[number]>();
  for (const r of rows) if (!byDriver.has(r.driverId)) byDriver.set(r.driverId, r);

  const teamRankByName = new Map(standings.teams.map((t) => [t.teamName, t.position]));
  const driverPointsById = new Map(standings.drivers.map((d) => [d.driverId, d.points]));
  const UNRANKED = Number.MAX_SAFE_INTEGER;

  const list = [...byDriver.values()].sort((a, b) => {
    const teamRankA = teamRankByName.get(a.teamName ?? "") ?? UNRANKED;
    const teamRankB = teamRankByName.get(b.teamName ?? "") ?? UNRANKED;
    if (teamRankA !== teamRankB) return teamRankA - teamRankB;
    const pointsA = driverPointsById.get(a.driverId) ?? 0;
    const pointsB = driverPointsById.get(b.driverId) ?? 0;
    return pointsB - pointsA || a.name.localeCompare(b.name);
  });

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
        {season} Season
      </p>
      <h1 className="mt-1 text-2xl font-bold text-slate-100">Drivers</h1>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {list.map((d) => {
          const accent = getTeamColor(d.teamName);
          const initials = d.name
            .split(/\s+/)
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();
          return (
            <Link
              key={d.driverId}
              href={`/driver/${d.driverId}`}
              className="group flex items-center gap-3 border border-slate-800 bg-slate-900/30 p-3 transition-colors hover:bg-slate-900/70"
              style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
            >
              {d.headshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.headshotUrl}
                  alt={d.name}
                  className="shrink-0 rounded-full border bg-slate-950 object-cover"
                  style={{ borderColor: accent, height: 44, width: 44 }}
                />
              ) : (
                <div
                  className="flex shrink-0 items-center justify-center rounded-full border bg-slate-950 text-sm font-bold text-slate-400"
                  style={{ borderColor: accent, height: 44, width: 44 }}
                >
                  {initials}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-100 group-hover:text-cyan-300">
                  {d.name}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <TeamBadge teamName={d.teamName} size={11} />
                  <span className="hud-mono truncate text-[10px] text-slate-500">
                    {d.teamName}
                  </span>
                </div>
              </div>
              {d.driverNumber != null && (
                <span
                  className="hud-mono ml-auto shrink-0 text-lg font-bold opacity-60"
                  style={{ color: accent }}
                >
                  {d.driverNumber}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {list.length === 0 && (
        <p className="hud-mono mt-6 text-xs text-slate-500">
          NO DRIVER RESULTS FOR {season} YET.
        </p>
      )}
    </main>
  );
}
