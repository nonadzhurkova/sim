import type { DriverSessionPace } from "@/queries/session-pace";

function formatLapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${rest}`;
}

export function SessionPaceTable({ title, rows }: { title: string; rows: DriverSessionPace[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <p className="mt-2 text-sm text-gray-400">No data yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="py-1 pr-2 font-medium">#</th>
            <th className="py-1 pr-2 font-medium">Driver</th>
            <th className="py-1 pr-2 font-medium">Team</th>
            <th className="py-1 pr-2 font-medium text-right">Lap</th>
            <th className="py-1 font-medium text-right">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.driverId} className="border-t border-gray-100">
              <td className="py-1 pr-2">{r.rank}</td>
              <td className="py-1 pr-2">{r.driverName}</td>
              <td className="py-1 pr-2 text-gray-500">{r.teamName ?? "—"}</td>
              <td className="py-1 pr-2 text-right font-mono">{formatLapTime(r.bestLap)}</td>
              <td className="py-1 text-right font-mono text-gray-500">
                {r.rank === 1 ? "—" : `+${r.gapToFastest.toFixed(3)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
