/**
 * Shown while the race page's server-side data fetches (session pace, car
 * performance, comparison, adjacent races) are in flight. Without this,
 * navigating to a race page showed a blank white flash until everything
 * resolved — Next renders this automatically via React Suspense as soon as
 * the route segment starts loading, no wiring needed beyond this file.
 */
export default function RaceLoading() {
  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-cyan-500">
        Loading<span className="hud-ellipsis" />
      </p>
      <div className="mt-3 h-8 w-96 bg-slate-900/60" />
      <div className="mt-8 h-40 w-full border border-slate-800/80 bg-slate-950/40" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-32 border border-slate-800/80 bg-slate-950/40" />
        ))}
      </div>
    </main>
  );
}
