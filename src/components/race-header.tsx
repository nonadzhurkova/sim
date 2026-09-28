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
      className={`hud-mono flex shrink-0 items-center gap-1 text-xs text-slate-400 transition-colors hover:text-cyan-300 ${
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
        <div className="mb-1.5 flex items-center gap-3">
          <AdjacentRaceLink race={adjacentRaces.previous} direction="previous" />
          <span className="text-slate-800">|</span>
          <AdjacentRaceLink race={adjacentRaces.next} direction="next" />
        </div>
      )}
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
        {race.season} {"//"} Round {String(race.round).padStart(2, "0")}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-slate-100">{race.circuitName}</h1>
      <p className="hud-mono mt-1 text-xs text-slate-400">
        {race.country} • {race.date}
      </p>
    </div>
  );
}
