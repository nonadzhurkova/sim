"use client";

import { useEffect, useState } from "react";

/**
 * A live "in 2h 14m" / "12m ago" label.
 *
 * Client-only and rendered as an absolute time on the server: a relative
 * string computed during SSR is stale the moment it arrives and mismatches on
 * hydration, so the first client render replaces it and a timer keeps it
 * current from there.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // Deliberate: `now` must stay null through SSR and the first client render
    // so both produce the same markup, then switch to a live relative time.
    // That is exactly the "set state on mount" the rule warns about, and here
    // it is the mechanism preventing a hydration mismatch, not a mistake.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;

  // Before hydration, show the absolute time — always correct, never stale.
  if (now == null) {
    return (
      <time dateTime={iso} suppressHydrationWarning>
        {new Date(iso).toISOString().slice(11, 16)} UTC
      </time>
    );
  }

  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} suppressHydrationWarning>
      {formatRelative(target - now)}
    </time>
  );
}

function formatRelative(deltaMs: number): string {
  const future = deltaMs > 0;
  const totalMinutes = Math.round(Math.abs(deltaMs) / 60_000);

  if (totalMinutes < 1) return future ? "in under a minute" : "just now";
  if (totalMinutes < 60) return future ? `in ${totalMinutes}m` : `${totalMinutes}m ago`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    const text = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    return future ? `in ${text}` : `${text} ago`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  const text = remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  return future ? `in ${text}` : `${text} ago`;
}
