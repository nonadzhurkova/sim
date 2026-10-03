import Link from "next/link";
import { db } from "@/db";
import { drivers, teams, raceResults, races } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getLatestSeason } from "@/queries/races";
import { getStandings } from "@/queries/standings";
import { getLatestDriverRatingsForSeason } from "@/queries/driver-profile";
import { TeamBadge } from "@/components/team-badge";
import { getTeamColor } from "@/lib/team-colors";
import { SectionHeading } from "@/components/hud-panel";

function paceCell(value: number | null): string {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

/** Negative base pace (faster than the field) reads as good news; positive as a real deficit. */
function paceColor(value: number | null): string {
  if (value == null) return "text-slate-400";
  return value < 0 ? "text-green-400" : "text-red-400";
}

/** Driver index for the current season, as a table, sorted by championship points. */
export default async function DriversPage() {
  const season = await getLatestSeason();

  // Every driver who has a result this season, with their most recent team.
  const [rows, standings, ratingsByDriver] = await Promise.all([
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
    getLatestDriverRatingsForSeason(season),
  ]);

  // First row per driver wins, which is their latest team this season.
  const byDriver = new Map<number, (typeof rows)[number]>();
  for (const r of rows) if (!byDriver.has(r.driverId)) byDriver.set(r.driverId, r);

  const driverPointsById = new Map(standings.drivers.map((d) => [d.driverId, d.points]));

  const list = [...byDriver.values()].sort((a, b) => {
    const pointsA = driverPointsById.get(a.driverId) ?? 0;
    const pointsB = driverPointsById.get(b.driverId) ?? 0;
    return pointsB - pointsA || a.name.localeCompare(b.name);
  });

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <SectionHeading eyebrow={`${season} Season`} title="Drivers" />

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-slate-400">
              <th className="py-2 pr-3 font-medium">Driver</th>
              <th className="py-2 pr-3 font-medium">Team</th>
              <th className="py-2 pr-3 font-medium text-right" title="Championship points scored this season">
                Points
              </th>
              <th
                className="py-2 pr-3 font-medium text-right"
                title="Seconds/lap vs. the field, blending qualifying gap and race pace (negative = faster than the field). The model's core pace signal."
              >
                Base pace
              </th>
              <th
                className="py-2 font-medium text-right"
                title="Recency-weighted, not a plain DNFs/races count — a recent DNF counts for more than an older one (5-race half-life)"
              >
                DNF rate*
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => {
              const accent = getTeamColor(d.teamName);
              const rating = ratingsByDriver.get(d.driverId) ?? null;
              const points = driverPointsById.get(d.driverId) ?? 0;
              return (
                <tr key={d.driverId} className="group border-t border-slate-800/60 hover:bg-slate-900/40">
                  <td className="py-2 pr-3">
                    <Link href={`/driver/${d.driverId}`} className="flex items-center gap-2.5">
                      {d.headshotUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={d.headshotUrl}
                          alt={d.name}
                          className="h-8 w-8 shrink-0 rounded-full border bg-slate-950 object-cover"
                          style={{ borderColor: accent }}
                        />
                      ) : (
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-slate-950 text-[10px] font-bold text-slate-300"
                          style={{ borderColor: accent }}
                        >
                          {d.name
                            .split(/\s+/)
                            .map((p) => p[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                      )}
                      <span className="truncate font-semibold text-slate-100 group-hover:text-red-300">
                        {d.name}
                      </span>
                      {d.driverNumber != null && (
                        <span className="hud-mono shrink-0 text-xs opacity-60" style={{ color: accent }}>
                          #{d.driverNumber}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-1.5">
                      <TeamBadge teamName={d.teamName} size={12} />
                      <span className="hud-mono truncate text-xs text-slate-400">{d.teamName}</span>
                    </span>
                  </td>
                  <td className="hud-mono py-2 pr-3 text-right font-semibold text-red-300">{points}</td>
                  <td className={`hud-mono py-2 pr-3 text-right font-semibold ${paceColor(rating?.basePace ?? null)}`}>
                    {paceCell(rating?.basePace ?? null)}
                  </td>
                  <td className="hud-mono py-2 text-right text-slate-400">
                    {rating?.driverReliability != null ? `${(rating.driverReliability * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hud-mono mt-3 text-[10px] leading-relaxed text-slate-600">
        BASE PACE IS SECONDS/LAP VS. THE FIELD (NEGATIVE = FASTER) — THE SAME NUMBER THE RACE
        PREDICTION USES. PRACTICE PACE AND TRACK AFFINITY AREN&apos;T SHOWN HERE: BOTH ARE SCOPED
        TO ONE SPECIFIC RACE WEEKEND, NOT A SEASON-LEVEL STAT, SO THEY&apos;RE SHOWN PER-RACE ON
        THE DRIVER AND RACE PAGES INSTEAD. *DNF RATE IS RECENCY-WEIGHTED (5-RACE HALF-LIFE), NOT
        A PLAIN DNFS/RACES COUNT — A DRIVER WITH ONE RECENT DNF CAN SHOW A HIGHER RATE THAN ONE
        WITH ONE OLDER DNF, EVEN WITH THE SAME TOTAL COUNT.
      </p>

      {list.length === 0 && (
        <p className="hud-mono mt-6 text-xs text-slate-400">
          NO DRIVER RESULTS FOR {season} YET.
        </p>
      )}
    </main>
  );
}
