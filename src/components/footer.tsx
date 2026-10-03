import Link from "next/link";

/**
 * Sitewide footer -- links to /about and /story, the two pages outside the
 * app's own data (who built it, and a plain-language explanation of what
 * the predictions are built from). Server component, no data fetching.
 */
export function Footer() {
  return (
    <footer className="mt-16 border-t border-[#1e212b] bg-[#0b0c10]">
      <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-2 px-6 py-8 text-center lg:px-10">
        <nav className="flex items-center gap-4 text-sm font-medium text-[#a3a9b8]">
          <Link href="/story" className="hover:text-[#f2f3f5]">
            The Story
          </Link>
          <span className="text-[#2e3340]">·</span>
          <Link href="/about" className="hover:text-[#f2f3f5]">
            About
          </Link>
        </nav>
        <p className="hud-mono text-xs text-[#5a6175]">Built by Nona Dzhurkova</p>
      </div>
    </footer>
  );
}
