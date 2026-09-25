import Link from "next/link";
import type { DriverProfile, DriverRaceRow } from "@/queries/driver-profile";
import { HudPanel } from "./hud-panel";
import { TeamBadge } from "./team-badge";
import { getTeamColor } from "@/lib/team-colors";

/** Colour a finishing position the way a results screen would. */
function positionClass(position: number | null, status: string | null): string {
  if (status && status !== "finished") return "text-red-400";
  if (position == null) return "text-slate-500";
  if (position === 1) return "text-yellow-300";
  if (position <= 3) return "text-slate-100";
  if (position <= 10) return "text-green-400";
  return "text-slate-400";
}

function ResultsTable({ rows, showSeason }: { rows: DriverRaceRow[]; showSeason?: boolean }) {
  if (rows.length === 0) {
    return <p className="hud-mono text-xs text-slate-500">NO RESULTS</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs">
        <thead>
          <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-slate-500">
            <th className="py-1.5 pr-3 font-medium">{showSeason ? "Race" : "Round"}</th>
            <th className="py-1.5 pr-3 font-medium">Circuit</th>
            <th className="py-1.5 pr-3 font-medium">Team</th>
            <th className="py-1.5 pr-3 font-medium text-right">Quali</th>
            <th className="py-1.5 pr-3 font-medium text-right">Grid</th>
            <th className="py-1.5 pr-3 font-medium text-right">Finish</th>
            <th className="py-1.5 font-medium text-right">+/−</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.raceId} className="border-t border-slate-800/60">
              <td className="hud-mono py-1.5 pr-3 text-slate-400">
                <Link
                  href={`/race/${r.season}/${r.round}`}
                  className="hover:text-cyan-300"
                >
                  {showSeason ? `${r.season} R${r.round}` : `R${r.round}`}
                </Link>
              </td>
              <td className="py-1.5 pr-3 truncate text-slate-300">{r.circuitName}</td>
              <td className="py-1.5 pr-3">
                <span className="flex items-center gap-1.5">
                  <TeamBadge teamName={r.teamName} size={12} />
                  <span className="hud-mono text-[10px] text-slate-500">{r.teamName}</span>
                </span>
              </td>
              <td className="hud-mono py-1.5 pr-3 text-right text-slate-400">
                {r.qualifyingPosition ?? "—"}
              </td>
              <td className="hud-mono py-1.5 pr-3 text-right text-slate-500">
                {r.gridPosition ?? "—"}
              </td>
              <td
                className={`hud-mono py-1.5 pr-3 text-right font-semibold ${positionClass(
                  r.finishPosition,
                  r.status,
                )}`}
              >
                {r.status && r.status !== "finished"
                  ? r.status.toUpperCase()
                  : (r.finishPosition ?? "—")}
              </td>
              <td className="hud-mono py-1.5 text-right">
                {r.placesGained == null ? (
                  <span className="text-slate-600">—</span>
                ) : r.placesGained > 0 ? (
                  <span className="text-green-400">▲{r.placesGained}</span>
                ) : r.placesGained < 0 ? (
                  <span className="text-red-400">▼{Math.abs(r.placesGained)}</span>
                ) : (
                  <span className="text-slate-500">–</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-slate-800/80 bg-slate-900/30 px-3 py-2">
      <div className="hud-mono text-[9px] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-100">{value}</div>
      {hint && <div className="hud-mono text-[9px] text-slate-600">{hint}</div>}
    </div>
  );
}

export function DriverProfilePanel({
  profile,
  circuitHistory,
  circuitName,
}: {
  profile: DriverProfile;
  circuitHistory: DriverRaceRow[];
  circuitName: string | null;
}) {
  const accent = getTeamColor(profile.currentTeam);
  const current = profile.seasonSummaries[0];
  const initials = profile.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
      <div
        className="relative flex flex-wrap items-center gap-5 border border-slate-800 bg-slate-900/40 p-5"
        style={{ borderLeftColor: accent, borderLeftWidth: 4 }}
      >
        {profile.headshotUrl ? (
          // Plain img rather than next/image: these are ~5 KB thumbnails from
          // formula1.com's CDN, so optimisation buys nothing and this avoids
          // configuring a remote image host.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.headshotUrl}
            alt={profile.name}
            width={88}
            height={88}
            className="h-22 w-22 shrink-0 rounded-full border-2 bg-slate-950 object-cover"
            style={{ borderColor: accent, height: 88, width: 88 }}
          />
        ) : (
          <div
            className="flex h-22 w-22 shrink-0 items-center justify-center rounded-full border-2 bg-slate-950 text-2xl font-bold text-slate-300"
            style={{ borderColor: accent, height: 88, width: 88 }}
          >
            {initials}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-2xl font-bold text-slate-100">{profile.name}</h1>
            {profile.driverNumber != null && (
              <span className="hud-mono text-xl font-bold" style={{ color: accent }}>
                #{profile.driverNumber}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2">
              <TeamBadge teamName={profile.currentTeam} size={16} />
              <span className="text-sm text-slate-300">{profile.currentTeam ?? "—"}</span>
            </span>
            {profile.nationality && (
              <span className="hud-mono text-[11px] text-slate-500">{profile.nationality}</span>
            )}
          </div>
        </div>
      </div>

      {/* current-season headline numbers */}
      {current && (
        <div>
          <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
            {"//"} {current.season} season
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-9">
            <StatTile label="Races" value={String(current.races)} />
            <StatTile label="Points" value={String(current.points)} hint="championship" />
            <StatTile label="Wins" value={String(current.wins)} />
            <StatTile label="Poles" value={String(current.poles)} />
            <StatTile label="Podiums" value={String(current.podiums)} />
            <StatTile label="Points finishes" value={String(current.pointsFinishes)} />
            <StatTile label="DNFs" value={String(current.dnfs)} />
            <StatTile
              label="Avg grid"
              value={current.avgGrid != null ? current.avgGrid.toFixed(1) : "—"}
              hint={current.bestGrid != null ? `best P${current.bestGrid}` : undefined}
            />
            <StatTile
              label="Avg finish"
              value={current.avgFinish != null ? current.avgFinish.toFixed(1) : "—"}
              hint={current.bestFinish != null ? `best P${current.bestFinish}` : undefined}
            />
          </div>
          {current.qualiBattles > 0 && (
            <p className="hud-mono mt-2 text-[11px] text-slate-500">
              TEAM-MATE QUALIFYING:{" "}
              <span
                className={
                  current.qualiWins * 2 >= current.qualiBattles
                    ? "text-green-400"
                    : "text-red-400"
                }
              >
                {current.qualiWins}–{current.qualiBattles - current.qualiWins}
              </span>{" "}
              <span className="text-slate-600">
                (same car, so this is the cleanest read on the driver)
              </span>
            </p>
          )}
        </div>
      )}

      {/* this circuit, previous years */}
      {circuitName && (
        <HudPanel title={`At ${circuitName} — previous years`}>
          {circuitHistory.length > 0 ? (
            <ResultsTable rows={circuitHistory} showSeason />
          ) : (
            <p className="hud-mono text-xs text-slate-500">
              NO PREVIOUS RACES AT THIS CIRCUIT IN THE INGESTED DATA.
            </p>
          )}
        </HudPanel>
      )}

      {/* recent form */}
      <HudPanel title="Last 10 races">
        <ResultsTable rows={profile.recentRaces} showSeason />
      </HudPanel>

      {/* season-by-season */}
      {profile.seasonSummaries.length > 1 && (
        <HudPanel title="Season by season">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="hud-mono text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Season</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Races</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Wins</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Poles</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Podiums</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Pts</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Points</th>
                  <th className="py-1.5 pr-3 font-medium text-right">DNFs</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Avg grid</th>
                  <th className="py-1.5 font-medium text-right">Avg finish</th>
                </tr>
              </thead>
              <tbody>
                {profile.seasonSummaries.map((s) => (
                  <tr key={s.season} className="border-t border-slate-800/60">
                    <td className="hud-mono py-1.5 pr-3 text-slate-200">{s.season}</td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-slate-400">{s.races}</td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-yellow-300">
                      {s.wins || "—"}
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-purple-300">
                      {s.poles || "—"}
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-slate-200">
                      {s.podiums || "—"}
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right font-semibold text-cyan-300">
                      {s.points || "—"}
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-green-400">
                      {s.pointsFinishes || "—"}
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-red-400">
                      {s.dnfs || "—"}
                    </td>
                    <td className="hud-mono py-1.5 pr-3 text-right text-slate-400">
                      {s.avgGrid != null ? s.avgGrid.toFixed(1) : "—"}
                    </td>
                    <td className="hud-mono py-1.5 text-right text-slate-400">
                      {s.avgFinish != null ? s.avgFinish.toFixed(1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </HudPanel>
      )}

      {/* what the model thinks */}
      {profile.ratings && (
        <HudPanel
          title={`Model ratings — as of ${profile.ratings.asOfSeason} R${profile.ratings.asOfRound}`}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Base pace"
              value={
                profile.ratings.basePace != null
                  ? `${profile.ratings.basePace >= 0 ? "+" : ""}${profile.ratings.basePace.toFixed(3)}`
                  : "—"
              }
              hint="s/lap vs field"
            />
            <StatTile
              label="Practice pace"
              value={
                profile.ratings.practicePace != null
                  ? `${profile.ratings.practicePace >= 0 ? "+" : ""}${profile.ratings.practicePace.toFixed(3)}`
                  : "—"
              }
              hint="s/lap vs field"
            />
            <StatTile
              label="Track affinity"
              value={
                profile.ratings.trackAffinity != null
                  ? `${profile.ratings.trackAffinity >= 0 ? "+" : ""}${profile.ratings.trackAffinity.toFixed(3)}`
                  : "—"
              }
              hint="vs own average"
            />
            <StatTile
              label="DNF rate"
              value={
                profile.ratings.driverReliability != null
                  ? `${(profile.ratings.driverReliability * 100).toFixed(0)}%`
                  : "—"
              }
              hint="recency-weighted"
            />
          </div>
          <p className="hud-mono mt-3 text-[10px] leading-relaxed text-slate-600">
            NEGATIVE PACE = FASTER THAN THE FIELD MEDIAN. THESE ARE THE VALUES THE RACE
            PREDICTION USES.
          </p>
        </HudPanel>
      )}
    </div>
  );
}
