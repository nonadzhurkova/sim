import type { DriverSessionPace } from "@/queries/session-pace";
import type { YearOverYearComparison } from "@/queries/comparison";

function formatLapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${rest}`;
}

function LapStat({
  label,
  pace,
}: {
  label: string;
  pace: DriverSessionPace | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="hud-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
      {pace ? (
        <div className="flex items-baseline gap-2">
          <span className="hud-mono text-lg font-bold text-cyan-300">{formatLapTime(pace.bestLap)}</span>
          <span className="text-sm text-slate-400">{pace.driverName}</span>
        </div>
      ) : (
        <span className="hud-mono text-sm text-slate-600">—</span>
      )}
    </div>
  );
}

/**
 * Top-of-page HUD banner: this weekend's overall fastest lap so far, plus
 * last year's race and qualifying fastest laps for direct comparison.
 */
export function FastestLapBanner({
  sessionPace,
  comparison,
}: {
  sessionPace: Partial<Record<string, DriverSessionPace[]>>;
  comparison: YearOverYearComparison | null;
}) {
  let fastestThisWeekend: DriverSessionPace | undefined;
  for (const rows of Object.values(sessionPace)) {
    const leader = rows?.[0];
    if (leader && (!fastestThisWeekend || leader.bestLap < fastestThisWeekend.bestLap)) {
      fastestThisWeekend = leader;
    }
  }

  const lastYearRace = comparison?.lastYear?.sessionPace.r?.[0];
  const lastYearQuali = comparison?.lastYear?.sessionPace.q?.[0];

  if (!fastestThisWeekend && !lastYearRace && !lastYearQuali) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border border-cyan-500/40 bg-cyan-950/20 px-4 py-3 shadow-[0_0_15px_-5px_rgba(34,211,238,0.4)]">
      <LapStat label="Fastest This Weekend" pace={fastestThisWeekend} />
      <LapStat label="Last Year — Race" pace={lastYearRace} />
      <LapStat label="Last Year — Qualifying" pace={lastYearQuali} />
    </div>
  );
}
