import { HudPanel, SectionHeading } from "@/components/hud-panel";

export const metadata = {
  title: "The Story",
  description: "What this app uses to predict F1 race outcomes.",
};

export default function StoryPage() {
  return (
    <main className="mx-auto max-w-[900px] px-6 py-8 lg:px-10">
      <SectionHeading eyebrow="Internal" title="The Story" />
      <p className="hud-mono mt-2 text-xs text-slate-400">What this app actually predicts from, in plain language.</p>

      <div className="mt-8 flex flex-col gap-6">
        <HudPanel title="Two models, blended into one prediction">
          <p className="text-sm leading-relaxed text-slate-300">
            Every race-day prediction here is a blend of two very different approaches.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            The first is a <strong className="text-slate-100">Monte Carlo simulation</strong>: the
            app plays out the same race thousands of times, each time with a slightly different
            roll of the dice for tyre luck, traffic, retirements and safety cars, starting from
            each driver&apos;s underlying pace. Run it 8,000 times and count how often each driver
            wins, podiums, or scores points — that&apos;s the prediction.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            The second is a <strong className="text-slate-100">machine-learning model</strong>{" "}
            (XGBoost), trained on 13 seasons of historical Formula 1 data — grid positions,
            qualifying gaps, recent form, reliability — rather than simulating anything lap by lap.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Neither one wins outright. Blended together — 40% the simulation, 60% the
            machine-learning model — the combination beats either one alone, and is the first
            version of this model to clearly beat the simplest possible guess (&quot;whoever is on
            pole wins&quot;) by a real, measured margin.
          </p>
        </HudPanel>

        <HudPanel title="What feeds the simulation">
          <p className="text-sm leading-relaxed text-slate-300">
            A driver&apos;s expected race pace is built from several independent signals, blended
            together and reweighted depending on what&apos;s actually available for that race
            weekend:
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-slate-300">
            <li>
              <strong className="text-slate-100">Season-long base pace</strong> — how fast this
              driver has been, relative to the field, all year.
            </li>
            <li>
              <strong className="text-slate-100">This weekend&apos;s practice pace</strong> — once
              practice sessions happen, their long runs sharpen the prediction.
            </li>
            <li>
              <strong className="text-slate-100">Car strength</strong> — the team&apos;s own pace,
              separate from the driver sitting in it.
            </li>
            <li>
              <strong className="text-slate-100">Track affinity</strong> — some drivers are
              consistently better at street circuits, or high-speed tracks, than their overall
              average suggests.
            </li>
            <li>
              <strong className="text-slate-100">Recent qualifying and race form</strong> — not
              just the whole season, but how a driver has been trending lately.
            </li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Before qualifying happens, there&apos;s no real starting grid yet, so the simulation
            builds one itself from these same signals — and in that case, only the Monte Carlo
            side runs; the machine-learning model needs a real grid to work with, so it sits out
            until qualifying is done.
          </p>
        </HudPanel>

        <HudPanel title="Keeping the numbers honest">
          <p className="text-sm leading-relaxed text-slate-300">
            A model that says a driver has a &quot;30% chance to win&quot; is only useful if that
            driver actually wins about 30% of the time they&apos;re given those odds — not 10%, not
            60%. Every prediction here is checked against this, and adjusted (calibrated) so the
            stated percentages mean what they say.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Every change to the model — a new signal, a reweighted blend, a different approach
            entirely — is tested against real, already-known race results before it&apos;s trusted.
            Plenty of ideas that sounded reasonable on paper (a pit-stop signal, a tyre-degradation
            model, a dedicated qualifying predictor) were built, measured, and quietly dropped when
            they didn&apos;t actually improve the predictions. What&apos;s live today is what
            survived that process, not everything that was ever tried.
          </p>
        </HudPanel>
      </div>
    </main>
  );
}
