"use client";

/**
 * components/market/SizeGrid.tsx
 *
 * The product page's size run: click a size to highlight it, then SELL
 * below carries model + size into the intake. Sizes already in the catalog
 * read solid; sizes that don't exist yet read dashed and get ensured on
 * continue — never a dead size.
 */

import { useState } from "react";
import Link from "next/link";
import { SIZE_RUN } from "@/components/market/size-run";

export interface SizeGridProps {
  modelId: string;
  existingSizes: readonly number[];
}

export function SizeGrid({ modelId, existingSizes }: SizeGridProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const existing = new Set(existingSizes);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SIZE_RUN.map((size) => {
          const active = selected === size;
          return (
            <button
              key={size}
              type="button"
              aria-pressed={active}
              onClick={() => setSelected(active ? null : size)}
              className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 text-center transition ${
                active
                  ? "border-accent bg-accent/15 text-foreground"
                  : existing.has(size)
                    ? "border-line-strong bg-raised hover:border-accent"
                    : "border-dashed border-line-strong bg-raised/40 hover:border-accent"
              }`}
            >
              <span className="text-sm font-extrabold">US M {size}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {active ? "Selected" : "Make List"}
              </span>
            </button>
          );
        })}
      </div>
      {selected != null ? (
        <Link
          href={`/list/new?modelId=${modelId}&sizeUs=${selected}`}
          className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-bold text-[#0B0B0B] transition hover:brightness-110"
        >
          Sell US M {selected} →
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-xl border border-line bg-raised px-4 py-3 text-sm font-bold text-muted opacity-60"
        >
          Select a size to sell
        </button>
      )}
      <p className="text-xs text-muted">
        Dashed sizes aren&apos;t in the catalog yet — picking one creates the
        variant as part of your submission.
      </p>
    </div>
  );
}
