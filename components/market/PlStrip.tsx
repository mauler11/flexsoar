"use client";

/**
 * components/market/PlStrip.tsx
 *
 * Unrealized P/L across held cards: current value (live ask, else oracle
 * market price) minus acquisition cost from the open provenance hop, summed
 * over every card where both are known. Cards missing either side are
 * counted, never invented — the strip says exactly how many went into the
 * total. Sold cards are excluded: provenance records no release price, so
 * realized P/L cannot be computed honestly from it.
 *
 * Hide/show is per device (localStorage). An account-level "show my P/L"
 * switch needs a users.show_pl column — migration, human lane — so for now
 * the profile strip renders to the owner only, never to visitors.
 */

import { useEffect, useState } from "react";
import { formatMyr } from "@/components/card/format";
import { cn } from "@/components/ui/cn";

export interface PlEntry {
  cardId: string;
  label: string;
  costCents: number | null;
  valueCents: number | null;
}

const PL_VISIBLE_KEY = "flexsoar-show-pl";

export function PlStrip({ entries }: { entries: PlEntry[] }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(PL_VISIBLE_KEY) === "0") {
        setVisible(false);
      }
    } catch {
      // Private mode — default to visible.
    }
  }, []);

  function toggle() {
    setVisible((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(PL_VISIBLE_KEY, next ? "1" : "0");
      } catch {
        // Ignore persistence failures.
      }
      return next;
    });
  }

  const valued = entries.filter(
    (e) => e.costCents != null && e.valueCents != null,
  );
  const total = valued.reduce(
    (sum, e) => sum + (e.valueCents! - e.costCents!),
    0,
  );

  return (
    <section
      aria-label="Unrealized profit and loss"
      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-raised px-4 py-3"
    >
      <div className="flex items-baseline gap-3">
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted">
          P/L · unrealized
        </span>
        {visible &&
          (valued.length > 0 ? (
            <span
              className={cn(
                "text-lg font-extrabold tabular-nums tracking-tight",
                total >= 0 ? "text-accent" : "text-[#FF4444]",
              )}
            >
              {total >= 0 ? "+" : "−"}
              {formatMyr(Math.abs(total))}
            </span>
          ) : (
            <span className="text-sm font-semibold text-muted">
              Not enough data yet
            </span>
          ))}
      </div>
      <div className="flex items-center gap-3">
        {visible && (
          <span className="text-[11px] text-muted">
            {valued.length} of {entries.length} cards valued
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-pressed={visible}
          className="rounded-lg border border-line-strong px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:border-muted hover:text-foreground"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </section>
  );
}

/**
 * Build strip entries for held cards. Cost comes from the open provenance
 * hop (releasedAt == null); value prefers the live ask, else the oracle.
 */
export function plEntriesForCards<
  T extends { id: string; label: string; oracleCents: number | null },
>(
  cards: readonly T[],
  openCostByCardId: ReadonlyMap<string, number | null>,
  askByCardId: ReadonlyMap<string, number>,
): PlEntry[] {
  return cards.map((c) => ({
    cardId: c.id,
    label: c.label,
    costCents: openCostByCardId.get(c.id) ?? null,
    valueCents: askByCardId.get(c.id) ?? c.oracleCents,
  }));
}
