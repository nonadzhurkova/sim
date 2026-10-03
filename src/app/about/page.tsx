import { HudPanel, SectionHeading } from "@/components/hud-panel";

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
      <SectionHeading eyebrow="Internal" title="About" />

      <div className="mt-8">
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
                className="hud-mono border border-red-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-red-400 transition-colors hover:border-red-500 hover:text-red-300"
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
