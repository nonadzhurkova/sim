import Link from "next/link";

export function NavBar() {
  return (
    <header className="border-b border-cyan-900/60 bg-[#05070a]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3 lg:px-10">
        <Link href="/" className="hud-mono text-sm font-bold tracking-widest text-cyan-400">
          F1// PREDICTOR
        </Link>
        <nav className="flex gap-4 text-xs uppercase tracking-wider text-slate-400">
          <Link href="/" className="hover:text-cyan-300">
            Home
          </Link>
          <Link href="/standings" className="hover:text-cyan-300">
            Standings
          </Link>
          <Link href="/drivers" className="hover:text-cyan-300">
            Drivers
          </Link>
        </nav>
      </div>
    </header>
  );
}
