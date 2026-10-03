import { getTeamColor } from "@/lib/team-colors";
import { HudPanel } from "./hud-panel";
import type { PredictionStages, PredictionStageResult, ActualPodiumEntry } from "@/queries/race-prediction";

function pct(v: number): string {
  if (v >= 0.995) return "100";
  if (v > 0 && v < 0.001) return "<0.1";
  return (v * 100).toFixed(1);
}

function StageCard({ label, result, missing }: { label: string; result: PredictionStageResult; missing: string }) {
  return (
    <div className="border border-[#262a35] bg-[#0b0c10] p-4">
      <p className="hud-mono text-[10px] uppercase tracking-widest text-[#8a91a3]">{label}</p>
      {result ? (
        <>
          <ul className="mt-2 flex flex-col gap-1.5">
            {result.entries.map((d, i) => {
              const hitPodium = d.actualFinish != null && d.actualFinish <= 3;
              return (
                <li key={d.driverId} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 truncate">
                    <span className="hud-mono text-xs text-[#5a6175]">{i + 1}</span>
                    <span className="h-3 w-[3px] shrink-0" style={{ backgroundColor: getTeamColor(d.teamName) }} />
                    <span className="truncate text-sm font-medium text-[#f2f3f5]">{d.driverName}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="hud-mono text-sm font-semibold text-red-400">{pct(d.winPct)}%</span>
                    {d.actualFinish != null && (
                      <span
                        className={`hud-mono text-[10px] ${hitPodium ? "text-emerald-400" : "text-[#5a6175]"}`}
                        title="Actual finishing position"
                      >
                        →P{d.actualFinish}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {result.isRetroactive && (
            <p className="hud-mono mt-2 text-[9px] uppercase tracking-wider text-amber-500">
              Simulated retroactively — not a real prediction made at the time
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-[#5a6175]">{missing}</p>
      )}
    </div>
  );
}

function ActualPodiumCard({ podium }: { podium: ActualPodiumEntry[] | null }) {
  return (
    <div className="border border-[#262a35] bg-[#0b0c10] p-4">
      <p className="hud-mono text-[10px] uppercase tracking-widest text-[#8a91a3]">Actual result</p>
      {podium && podium.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {podium.map((d) => (
            <li key={d.driverId} className="flex items-center gap-2">
              <span className="hud-mono text-xs text-[#5a6175]">P{d.finish}</span>
              <span className="h-3 w-[3px] shrink-0" style={{ backgroundColor: getTeamColor(d.teamName) }} />
              <span className="truncate text-sm font-medium text-[#f2f3f5]">{d.driverName}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[#5a6175]">Race hasn&apos;t happened yet.</p>
      )}
    </div>
  );
}

/**
 * The model's top 3 at two points in the weekend -- before qualifying
 * (simulated grid) and after qualifying (real grid, before the race) --
 * each driver tagged with their actual finishing position once the race is
 * done, plus the real podium alongside for a direct visual check of how
 * each stage's call held up. A stage is a genuine snapshot when a real run
 * was stored at that moment (simulation_runs.stage); otherwise, if the race
 * has already finished and no real snapshot for that stage was ever
 * recorded, it falls back to a clearly-labeled retroactive reconstruction
 * (today's model, blind to data that stage wouldn't have had) rather than
 * leaving a finished race's history blank. An upcoming race with no real
 * run yet just shows "no prediction made" -- no retroactive fallback, since
 * there's nothing dishonest about simply not having run it yet.
 */
export function PredictionOverTime({ stages }: { stages: PredictionStages }) {
  if (!stages.preQuali && !stages.postQuali && !stages.actualPodium) return null;

  return (
    <HudPanel title="Prediction over time">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StageCard label="Before qualifying" result={stages.preQuali} missing="No prediction made at this stage yet." />
        <StageCard
          label="After qualifying, before the race"
          result={stages.postQuali}
          missing="No prediction made at this stage yet."
        />
        <ActualPodiumCard podium={stages.actualPodium} />
      </div>
    </HudPanel>
  );
}
