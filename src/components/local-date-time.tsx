"use client";

import { useEffect, useState } from "react";

/**
 * An absolute date/time in the viewer's own local timezone, with the zone
 * name shown explicitly (e.g. "Fri 3 Oct, 14:30 GMT+2") -- next to
 * RelativeTime's "in 4d 19h" so a schedule reads correctly regardless of
 * where the viewer is.
 *
 * Server-rendered as UTC (matching RelativeTime's placeholder) since the
 * server doesn't know the viewer's timezone; swaps to the real local
 * rendering once mounted, same hydration-safety pattern as RelativeTime.
 */
export function LocalDateTime({ iso }: { iso: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  if (!mounted) {
    return (
      <time dateTime={iso} suppressHydrationWarning>
        {date.toISOString().slice(0, 16).replace("T", " ")} UTC
      </time>
    );
  }

  const formatted = date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const zoneMatch = date
    .toLocaleTimeString(undefined, { timeZoneName: "shortOffset" })
    .match(/GMT[+-]\d+(:\d+)?|UTC[+-]\d+(:\d+)?/);
  const zone = zoneMatch?.[0] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatted} {zone}
    </time>
  );
}
