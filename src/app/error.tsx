"use client";

import { useEffect } from "react";

/**
 * Root error boundary — without this, any thrown error (a failed DB query, a
 * bad param) fell through to Next's default unstyled error page, jarringly
 * out of step with the rest of the app's HUD look. Client component: Next
 * requires error.tsx to be one, since it needs to catch errors during render
 * on the client too, not just ones thrown server-side.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex max-w-[1600px] flex-col items-start gap-4 px-6 py-16 lg:px-10">
      <p className="hud-mono text-xs uppercase tracking-widest text-red-400">System Fault</p>
      <h1 className="text-2xl font-bold text-slate-100">Something went wrong</h1>
      <p className="hud-mono max-w-xl text-xs leading-relaxed text-slate-500">
        {error.message || "An unexpected error occurred while rendering this page."}
      </p>
      <button
        onClick={reset}
        className="hud-mono border border-cyan-700 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-cyan-400 transition-colors hover:border-cyan-500 hover:text-cyan-300"
      >
        Try again
      </button>
    </main>
  );
}
