import { HudPanel } from "@/components/hud-panel";

export const metadata = {
  title: "About",
  description: "About the person behind this F1 prediction app.",
};

const LINKS = [
  { label: "LinkedIn", href: "https://www.linkedin.com/in/nona-dzhurkova-3221b812/" },
  { label: "Blog — Sitecore Insights", href: "https://sitecore-insights.dzhurkov.com/" },
];

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-[900px] px-6 py-8 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">Internal</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-100">About</h1>

      <div className="mt-6">
        <HudPanel title="Nona Dzhurkova">
          <p className="text-sm leading-relaxed text-slate-300">
            Technical Manager of the Sitecore Team at Americaneagle.com, and a two-time Sitecore
            Technology MVP (2025, 2026). Over 15 years in the IT industry, with a background
            spanning software development, Sitecore engineering, and technical leadership — based
            in Sofia, Bulgaria.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            This F1 prediction app is a side project, built to explore Monte Carlo simulation and
            machine learning outside the day-to-day Sitecore/CMS world.
          </p>

          <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-800/80 pt-4">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="hud-mono border border-cyan-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-cyan-400 transition-colors hover:border-cyan-500 hover:text-cyan-300"
              >
                {l.label} →
              </a>
            ))}
          </div>
        </HudPanel>
      </div>
    </main>
  );
}
