export function RaceHeader({
  race,
}: {
  race: { season: number; round: number; circuitName: string; country: string | null; date: string };
}) {
  return (
    <div>
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
        {race.season} {"//"} Round {String(race.round).padStart(2, "0")}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-slate-100">{race.circuitName}</h1>
      <p className="hud-mono mt-1 text-xs text-slate-500">
        {race.country} • {race.date}
      </p>
    </div>
  );
}
