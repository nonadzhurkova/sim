"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type IngestSummary = {
  season: number;
  before: { races: number; sessions: number };
  after: { races: number; sessions: number };
};

type PhaseLabel = { phase: string; label: string };

export function ImportButton({ season }: { season: number }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [summary, setSummary] = useState<IngestSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PhaseLabel | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    setState("loading");
    setError(null);
    setSummary(null);
    setPhase(null);
    setMessage(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }

      // NDJSON: one event per line. A full import runs three long phases
      // (race results, timing data, ratings) and can take minutes, so this
      // reports which phase is running and its latest message rather than
      // leaving the button sitting on "Importing..." with no sign of life.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // `state` is a render-time snapshot inside this closure, so a check
      // against it after the loop would always see the "loading" value from
      // when the function started — this local flag tracks the real outcome.
      let failed = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "phase") {
            setPhase({ phase: event.phase, label: event.label });
            setMessage(null);
          } else if (event.type === "progress") {
            setMessage(
              event.message ??
                (event.total != null ? `${event.completed}/${event.total}` : null),
            );
          } else if (event.type === "done") {
            setSummary({ season: event.season, before: event.before, after: event.after });
            setState("done");
          } else if (event.type === "error") {
            setError(event.error);
            setState("error");
            failed = true;
          }
        }
      }
      if (!failed) router.refresh();
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

      {state === "loading" && (
        <div className="flex max-w-xs flex-col items-end gap-0.5 text-right">
          <p className="hud-mono text-[11px] text-cyan-400">
            {phase ? phase.label : "Starting"}
            <span className="hud-ellipsis" />
          </p>
          {message && (
            <p className="hud-mono truncate text-[10px] text-slate-500">{message}</p>
          )}
          <div className="relative mt-0.5 h-1 w-40 overflow-hidden bg-slate-900/80">
            <div className="hud-pulse h-full w-full bg-cyan-400 shadow-[0_0_8px_0_rgba(34,211,238,0.7)]" />
            <div className="hud-scan pointer-events-none absolute inset-y-0 w-1/3" />
          </div>
        </div>
      )}

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
