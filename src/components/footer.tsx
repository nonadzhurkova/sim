import Link from "next/link";

/**
 * Sitewide footer -- links to /about and /story, the two pages outside the
 * app's own data (who built it, and a plain-language explanation of what
 * the predictions are built from). Server component, no data fetching.
 */
export function Footer() {
  return (
    <footer className="mt-16 border-t border-cyan-900/60 bg-[#05070a]/90">
      <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-2 px-6 py-6 text-center lg:px-10">
        <nav className="flex items-center gap-4 text-xs uppercase tracking-wider text-slate-400">
          <Link href="/story" className="hover:text-cyan-300">
            The Story
          </Link>
          <span className="text-slate-700">·</span>
          <Link href="/about" className="hover:text-cyan-300">
            About
          </Link>
        </nav>
        <p className="hud-mono text-[10px] text-slate-600">
          Built by Nona Dzhurkova
        </p>
      </div>
    </footer>
  );
}
