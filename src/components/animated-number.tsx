"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that tweens toward its target instead of snapping to it.
 *
 * The title-odds panel updates several times a second while streaming, and a
 * bare `{value}` just replaces one digit string with another — nothing to
 * look at. This keeps an internal displayed value and eases it toward
 * whatever `value` becomes, so a jump from 31% to 65% is seen moving rather
 * than blinking.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
  durationMs = 450,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  durationMs?: number;
}) {
  const [displayed, setDisplayed] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = displayed;
    startRef.current = null;
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);

    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    const step = (t: number) => {
      if (startRef.current == null) startRef.current = t;
      const elapsed = t - startRef.current;
      const progress = Math.min(1, elapsed / durationMs);
      // ease-out cubic: fast start, settles gently rather than stopping dead
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(from + (to - from) * eased);
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
    // Deliberately excludes `displayed`: it's read once via the ref above to
    // capture the animation's starting point, not tracked as a dependency —
    // including it would restart the tween on every animation-driven frame
    // and it would never reach its target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return (
    <>
      {displayed.toFixed(decimals)}
      {suffix}
    </>
  );
}
