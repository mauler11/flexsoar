/**
 * components/market/Countdown.tsx
 *
 * Ticking HH:MM:SS until the early-access window ends. The initial server
 * render shows dashes and the real figure appears from the first effect tick,
 * so a statically-rendered grid of countdowns never triggers a hydration
 * mismatch. Fires `onUnlock` once, when it crosses zero.
 */
"use client";

import { useEffect, useRef, useState } from "react";

function render(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export interface CountdownProps {
  /** ISO timestamp the window ends at. */
  target: string;
  label?: string;
  onUnlock?: () => void;
  className?: string;
}

export function Countdown({
  target,
  label,
  onUnlock,
  className,
}: CountdownProps) {
  const [ms, setMs] = useState<number | null>(null);
  const unlocked = useRef(false);

  useEffect(() => {
    if (unlocked.current) return;
    let timer: number | undefined;

    const tick = () => {
      const next = Math.max(0, new Date(target).getTime() - Date.now());
      setMs(next);
      if (next <= 0 && !unlocked.current) {
        unlocked.current = true;
        onUnlock?.();
        return;
      }
      timer = window.setTimeout(tick, 1000);
    };

    timer = window.setTimeout(tick, 0);
    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [target, onUnlock]);

  return (
    <time
      dateTime={target}
      className={className}
      aria-label={label ? `${label} ${ms == null ? "" : render(ms)}` : undefined}
    >
      {label && <span className="mr-1 whitespace-nowrap">{label}</span>}
      <span className="tabular-nums">{ms == null ? "--:--:--" : render(ms)}</span>
    </time>
  );
}