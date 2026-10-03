export default function AnalysisLoading() {
  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-red-500">
        Loading<span className="hud-ellipsis" />
      </p>
      <div className="mt-3 h-8 w-96 bg-slate-900/60" />
    </main>
  );
}
