import type { YearOverYearComparison, RaceWeekendSnapshot } from "@/queries/comparison";
import { SessionPaceTable } from "./session-pace-table";

const SESSION_LABELS: Record<string, string> = {
  fp1: "FP1",
  fp2: "FP2",
  fp3: "FP3",
  q: "Qualifying",
  r: "Race",
};

function WeatherRow({ snapshot }: { snapshot: RaceWeekendSnapshot }) {
  const entries = Object.entries(snapshot.weatherBySession);
  if (entries.length === 0) return <p className="text-sm text-gray-400">No weather data yet</p>;
  return (
    <ul className="text-sm text-gray-600">
      {entries.map(([type, weather]) => (
        <li key={type}>
          {SESSION_LABELS[type] ?? type}: {weather ?? "unknown"}
        </li>
      ))}
    </ul>
  );
}

function ResultTable({ snapshot }: { snapshot: RaceWeekendSnapshot }) {
  if (!snapshot.raceResult) {
    return <p className="text-sm text-gray-400">Race hasn&apos;t happened yet</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-1 pr-2 font-medium">Pos</th>
          <th className="py-1 pr-2 font-medium">Driver</th>
          <th className="py-1 font-medium">Team</th>
        </tr>
      </thead>
      <tbody>
        {snapshot.raceResult.map((r) => (
          <tr key={r.driverId} className="border-t border-gray-100">
            <td className="py-1 pr-2">{r.finishPosition ?? r.status}</td>
            <td className="py-1 pr-2">{r.driverName}</td>
            <td className="py-1 text-gray-500">{r.teamName}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RatingsTable({ snapshot }: { snapshot: RaceWeekendSnapshot }) {
  const sortedDrivers = [...snapshot.driverRatings].sort(
    (a, b) => (a.basePace ?? Infinity) - (b.basePace ?? Infinity),
  );
  const sortedTeams = [...snapshot.teamRatings].sort(
    (a, b) => (a.carStrength ?? Infinity) - (b.carStrength ?? Infinity),
  );
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <h4 className="text-xs font-semibold text-gray-500">Driver base pace</h4>
        <ul className="mt-1 text-sm">
          {sortedDrivers.map((d) => (
            <li key={d.driverId} className="flex justify-between">
              <span>{d.driverName}</span>
              <span className="font-mono text-gray-500">{d.basePace?.toFixed(3) ?? "—"}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-500">Team car strength</h4>
        <ul className="mt-1 text-sm">
          {sortedTeams.map((t) => (
            <li key={t.teamId} className="flex justify-between">
              <span>{t.teamName}</span>
              <span className="font-mono text-gray-500">{t.carStrength?.toFixed(3) ?? "—"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SnapshotColumn({ snapshot, label }: { snapshot: RaceWeekendSnapshot; label: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-semibold">
        {label} — Round {snapshot.race.round} ({snapshot.race.date})
      </h3>
      {Object.entries(snapshot.sessionPace).map(([type, rows]) => (
        <SessionPaceTable key={type} title={SESSION_LABELS[type] ?? type} rows={rows} />
      ))}
      <div className="rounded-md border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700">Race Result</h4>
        <div className="mt-2">
          <ResultTable snapshot={snapshot} />
        </div>
      </div>
      <div className="rounded-md border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700">Ratings</h4>
        <div className="mt-2">
          <RatingsTable snapshot={snapshot} />
        </div>
      </div>
      <div className="rounded-md border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-700">Weather</h4>
        <div className="mt-2">
          <WeatherRow snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
}

export function RaceComparison({ comparison }: { comparison: YearOverYearComparison }) {
  return (
    <div>
      <h2 className="text-lg font-bold">Year-over-year comparison</h2>
      <div className="mt-4 grid grid-cols-1 gap-8 md:grid-cols-2">
        <SnapshotColumn snapshot={comparison.thisYear} label="This year" />
        {comparison.lastYear ? (
          <SnapshotColumn snapshot={comparison.lastYear} label="Last year" />
        ) : (
          <p className="text-sm text-gray-400">No race at this circuit last year</p>
        )}
      </div>
    </div>
  );
}
