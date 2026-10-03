import Link from "next/link";
import { getTeamColor } from "@/lib/team-colors";
import { PODIUM_EDGE, STAGE_COLOR } from "@/components/hud-panel";
import type { SeasonReviewRaceRow, PredictionStageResult, ActualPodiumEntry } from "@/queries/race-prediction";

function pct(v: number): string {
  if (v >= 0.995) return "100";
  if (v > 0 && v < 0.001) return "<0.1";
  return (v * 100).toFixed(1);
}

function StageList({ result, accent }: { result: PredictionStageResult; accent: string }) {
  if (!result) return <p className="mt-3 text-sm text-[#5a6175]">No prediction</p>;
  return (
    <>
    <ul className="mt-3 flex flex-col gap-2.5">
      {result.entries.map((d, i) => {
        const hit = d.actualFinish != null && d.actualFinish <= 3;
        return (
          <li key={d.driverId} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="hud-mono w-4 shrink-0 text-xs" style={{ color: PODIUM_EDGE[i] ?? "#5a6175" }}>
                P{i + 1}
              </span>
              <span className="h-3.5 w-[3px] shrink-0" style={{ backgroundColor: getTeamColor(d.teamName) }} />
              <span className="truncate font-medium text-[#eceef2]">{d.driverName}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="hud-mono font-semibold" style={{ color: accent }}>
                {pct(d.winPct)}%
              </span>
              {d.actualFinish != null && (
                <span className={`hud-mono text-xs ${hit ? "text-emerald-400" : "text-[#5a6175]"}`}>
                  →P{d.actualFinish}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
    {result.isRetroactive && (
      <p className="hud-mono mt-2 text-[10px] uppercase tracking-wider text-[#6b7284]">Reconstructed retroactively</p>
    )}
    </>
  );
}

function ActualList({ podium }: { podium: ActualPodiumEntry[] | null }) {
  if (!podium || podium.length === 0) return <p className="mt-3 text-sm text-[#5a6175]">—</p>;
  return (
    <ul className="mt-3 flex flex-col gap-2.5">
      {podium.map((d) => (
        <li key={d.driverId} className="flex items-center gap-2 text-sm">
          <span className="hud-mono w-4 shrink-0 text-xs" style={{ color: PODIUM_EDGE[d.finish - 1] ?? "#5a6175" }}>
            P{d.finish}
          </span>
          <span className="h-3.5 w-[3px] shrink-0" style={{ backgroundColor: getTeamColor(d.teamName) }} />
          <span className="truncate font-medium text-[#eceef2]">{d.driverName}</span>
        </li>
      ))}
    </ul>
  );
}

function CallBadge({ label, hit, accent }: { label: string; hit: boolean | null; accent: string }) {
  if (hit == null) return null;
  return (
    <span
      className="hud-mono flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider"
      style={{ backgroundColor: hit ? "rgba(16,185,129,0.15)" : "#1e212b", color: hit ? "#34d399" : "#6b7284" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
      {label} {hit ? "called it" : "missed"}
    </span>
  );
}

/**
 * One race's card in the season review -- pre-quali / post-quali / actual
 * top-3, each ranked line color-coded to the podium-edge gold/silver/bronze
 * used elsewhere (PodiumCards on the race page) so P1/P2/P3 reads instantly
 * instead of needing the numeral. The win-pick badges sit up top next to the
 * circuit name as the headline of the card, not buried under the lists.
 */
export function SeasonReviewRaceRow({ row, season }: { row: SeasonReviewRaceRow; season: number }) {
  return (
    <Link
      href={`/race/${season}/${row.round}`}
      className="block border border-[#262a35] bg-[#0b0c10] transition-colors hover:border-[#3a3f4d]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e212b] px-6 py-4">
        <div className="flex items-baseline gap-3">
          <span className="hud-mono text-xs uppercase tracking-widest text-[#8a91a3]">Round {row.round}</span>
          <span className="font-heading text-xl font-bold leading-tight text-[#f2f3f5]">{row.circuitName}</span>
        </div>
        <div className="flex gap-2">
          <CallBadge label="Pre-quali" hit={row.preQualiWinnerHit} accent={STAGE_COLOR.preQuali} />
          <CallBadge label="Post-quali" hit={row.postQualiWinnerHit} accent={STAGE_COLOR.postQuali} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 p-6 sm:grid-cols-3">
        <div className="border-l-2 pl-4" style={{ borderColor: STAGE_COLOR.preQuali }}>
          <p className="font-heading text-base font-bold leading-tight" style={{ color: STAGE_COLOR.preQuali }}>
            Pre-quali pick
          </p>
          <StageList result={row.stages.preQuali} accent={STAGE_COLOR.preQuali} />
        </div>
        <div className="border-l-2 pl-4" style={{ borderColor: STAGE_COLOR.postQuali }}>
          <p className="font-heading text-base font-bold leading-tight" style={{ color: STAGE_COLOR.postQuali }}>
            Post-quali pick
          </p>
          <StageList result={row.stages.postQuali} accent={STAGE_COLOR.postQuali} />
        </div>
        <div className="border-l-2 border-[#3a3f4d] pl-4">
          <p className="font-heading text-base font-bold leading-tight text-[#f2f3f5]">Actual result</p>
          <ActualList podium={row.stages.actualPodium} />
        </div>
      </div>
    </Link>
  );
}
