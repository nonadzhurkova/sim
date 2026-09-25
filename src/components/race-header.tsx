export function RaceHeader({
  race,
}: {
  race: { season: number; round: number; circuitName: string; country: string | null; date: string };
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold">
        {race.season} Round {race.round}: {race.circuitName}
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        {race.country} • {race.date}
      </p>
    </div>
  );
}
