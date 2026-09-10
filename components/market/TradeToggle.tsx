"use client";

/**
 * components/market/TradeToggle.tsx
 *
 * The owner's "Show Trade History: Yes / No" switch on their own profile.
 * Flips optimistically and revalidates the profile path in place.
 */

import { useState, useTransition } from "react";
import { toggleTradeHistoryAction } from "@/app/(market)/actions";
import { cn } from "@/components/ui/cn";

export interface TradeToggleProps {
  handle: string;
  initial: boolean;
}

export function TradeToggle({ handle, initial }: TradeToggleProps) {
  const [shown, setShown] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function flip(next: boolean) {
    if (next === shown) return;
    setShown(next);
    setFailed(false);
    startTransition(async () => {
      const result = await toggleTradeHistoryAction(next, `/u/${handle}`);
      if (!result.ok) {
        setShown(!next);
        setFailed(true);
      }
    });
  }

  const pill = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-[13px] font-bold transition disabled:opacity-60",
      active
        ? "bg-accent text-[#0B0B0B]"
        : "border border-line-strong text-muted hover:border-muted hover:text-foreground",
    );

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold">Show Trade History:</span>
      <button
        type="button"
        aria-pressed={shown}
        disabled={isPending}
        onClick={() => flip(true)}
        className={pill(shown)}
      >
        Yes
      </button>
      <button
        type="button"
        aria-pressed={!shown}
        disabled={isPending}
        onClick={() => flip(false)}
        className={pill(!shown)}
      >
        No
      </button>
      {failed && (
        <span role="alert" className="text-xs text-[#FF4444]">
          Couldn&apos;t save.
        </span>
      )}
    </div>
  );
}
