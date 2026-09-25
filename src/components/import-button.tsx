"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type IngestSummary = {
  season: number;
  before: { races: number; sessions: number };
  after: { races: number; sessions: number };
};

export function ImportButton({ season }: { season: number }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [summary, setSummary] = useState<IngestSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }
      const data: IngestSummary = await res.json();
      setSummary(data);
      setState("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setState("error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={state === "loading"}
        className="hud-mono relative border border-cyan-500 bg-cyan-950/40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-cyan-300 shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] transition-colors hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "loading" ? "Importing..." : "Import Latest Data"}
      </button>
      {state === "done" && summary && (
        <p className="hud-mono text-[11px] text-slate-500">
          Races {summary.before.races}→{summary.after.races} · Sessions{" "}
          {summary.before.sessions}→{summary.after.sessions}
        </p>
      )}
      {state === "error" && <p className="hud-mono text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
