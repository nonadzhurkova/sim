import { HudPanel } from "./hud-panel";

export function PredictionStub() {
  return (
    <HudPanel title="Race Prediction">
      <p className="hud-mono text-xs leading-relaxed text-slate-500">
        SIMULATION ENGINE NOT YET BUILT. When available, predictions for this
        race will be generated from each driver&apos;s base pace, reliability,
        and track affinity ratings, combined with each team&apos;s car
        strength — computed from data available before this race. Practice
        pace won&apos;t factor in, since practice hasn&apos;t happened yet for
        a future race.
      </p>
    </HudPanel>
  );
}
