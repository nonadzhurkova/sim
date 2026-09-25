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
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={state === "loading"}
        className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === "loading" ? "Importing..." : "Import latest data"}
      </button>
      {state === "done" && summary && (
        <p className="text-xs text-gray-500">
          Races: {summary.before.races} → {summary.after.races}, Sessions:{" "}
          {summary.before.sessions} → {summary.after.sessions}
        </p>
      )}
      {state === "error" && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
