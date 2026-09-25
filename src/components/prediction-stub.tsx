export function PredictionStub() {
  return (
    <div className="rounded-md border border-dashed border-gray-300 p-4">
      <h3 className="text-sm font-semibold text-gray-700">Race Prediction</h3>
      <p className="mt-2 text-sm text-gray-500">
        Simulation engine not yet built. When available, predictions for this
        race will be generated from each driver&apos;s base pace, reliability,
        and track affinity ratings, combined with each team&apos;s car
        strength — computed from data available before this race. Practice
        pace won&apos;t factor in, since practice hasn&apos;t happened yet for
        a future race.
      </p>
    </div>
  );
}
