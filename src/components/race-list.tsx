import Link from "next/link";
import type { RaceListItem } from "@/queries/races";

export function RaceList({
  races,
  currentRaceId,
}: {
  races: RaceListItem[];
  currentRaceId: number | undefined;
}) {
  return (
    <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
      {races.map((race) => {
        const isCurrent = race.id === currentRaceId;
        return (
          <li key={race.id}>
            <Link
              href={`/race/${race.season}/${race.round}`}
              className={`flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-50 ${
                isCurrent ? "bg-red-50 font-semibold" : ""
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span className="text-gray-400">R{race.round}</span>
                <span>{race.circuitName}</span>
                {race.country && <span className="text-gray-500">({race.country})</span>}
                {isCurrent && <span className="text-xs text-red-600">(current)</span>}
              </span>
              <span className="text-gray-500">{race.date}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
