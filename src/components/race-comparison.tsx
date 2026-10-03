import type { YearOverYearComparison, RaceWeekendSnapshot } from "@/queries/comparison";
import { SessionPaceTable } from "./session-pace-table";
import { HudPanel } from "./hud-panel";

const SESSION_LABELS: Record<string, string> = {
  fp1: "FP1",
  fp2: "FP2",
  fp3: "FP3",
  q: "Qualifying",
  r: "Race",
};

function WeatherRow({ snapshot }: { snapshot: RaceWeekendSnapshot }) {
  const entries = Object.entries(snapshot.weatherBySession);
  if (entries.length === 0) return <p className="hud-mono text-xs text-slate-400">NO DATA</p>;
  return (
    <ul className="hud-mono text-xs text-slate-400">
      {entries.map(([type, weather]) => (
        <li key={type} className="flex justify-between border-t border-slate-800/80 py-1 first:border-t-0">
          <span className="text-slate-400">{SESSION_LABELS[type] ?? type}</span>
          <span className={weather === "wet" ? "text-red-300" : "text-slate-300"}>
            {(weather ?? "unknown").toUpperCase()}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SnapshotColumn({ snapshot, label }: { snapshot: RaceWeekendSnapshot; label: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="hud-mono text-xs uppercase tracking-widest text-red-500">
        {label} — Round {snapshot.race.round} ({snapshot.race.date})
      </p>
      {Object.entries(snapshot.sessionPace).map(([type, rows]) => (
        <SessionPaceTable key={type} title={SESSION_LABELS[type] ?? type} rows={rows} />
      ))}
      <HudPanel title="Weather">
        <WeatherRow snapshot={snapshot} />
      </HudPanel>
    </div>
  );
}

export function RaceComparison({ comparison }: { comparison: YearOverYearComparison }) {
  return (
    <details className="group">
      <summary className="font-heading cursor-pointer list-none text-2xl font-extrabold uppercase tracking-wide text-[#f2f3f5] hover:text-red-400">
        <span className="mr-2 inline-block text-base transition-transform group-open:rotate-90">▶</span>
        Year-over-year comparison
      </summary>
      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
        <SnapshotColumn snapshot={comparison.thisYear} label="This Year" />
        {comparison.lastYear ? (
          <SnapshotColumn snapshot={comparison.lastYear} label="Last Year" />
        ) : (
          <p className="hud-mono text-xs text-slate-400">NO RACE AT THIS CIRCUIT LAST YEAR</p>
        )}
      </div>
    </details>
  );
}
