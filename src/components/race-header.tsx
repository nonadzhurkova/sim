import Link from "next/link";
import type { AdjacentRace } from "@/queries/races";

function AdjacentRaceLink({ race, direction }: { race: AdjacentRace | null; direction: "previous" | "next" }) {
  if (!race) {
    return (
      <span className="hud-mono flex shrink-0 items-center gap-1 px-1 text-slate-700">
        {direction === "previous" ? "←" : "→"}
      </span>
    );
  }
  return (
    <Link
      href={`/race/${race.season}/${race.round}`}
      title={race.circuitName}
      className={`hud-mono flex shrink-0 items-center gap-1 text-xs text-slate-400 transition-colors hover:text-red-300 ${
        direction === "previous" ? "flex-row" : "flex-row-reverse"
      }`}
    >
      <span>{direction === "previous" ? "←" : "→"}</span>
      <span className="max-w-[10ch] truncate sm:max-w-[16ch]">{race.circuitName}</span>
    </Link>
  );
}

export function RaceHeader({
  race,
  adjacentRaces,
}: {
  race: { season: number; round: number; circuitName: string; country: string | null; date: string };
  adjacentRaces?: { previous: AdjacentRace | null; next: AdjacentRace | null };
}) {
  return (
    <div>
      {adjacentRaces && (
        <div className="mb-2 flex items-center gap-3">
          <AdjacentRaceLink race={adjacentRaces.previous} direction="previous" />
          <span className="text-slate-800">|</span>
          <AdjacentRaceLink race={adjacentRaces.next} direction="next" />
        </div>
      )}
      <p className="hud-mono text-xs uppercase tracking-[0.14em] text-red-500">
        {race.season} {"//"} Round {String(race.round).padStart(2, "0")}
      </p>
      <h1 className="font-heading mt-2 text-4xl font-extrabold uppercase leading-[0.95] tracking-tight text-[#f2f3f5] sm:text-6xl">
        {race.circuitName}
      </h1>
      <p className="mt-2 text-base text-[#a3a9b8]">
        {race.country} • {race.date}
      </p>
    </div>
  );
}
