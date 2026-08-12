"use client";

/**
 * components/market/intake/SkuPicker.tsx
 *
 * Step 1 of the intake wizard: search the live SKU catalog and pick the shoe.
 * The grid is the seller's term-to-SKU matching problem — they think "the
 * Jordan 1", the catalog has `brand / model / colorway / size_us`. Search
 * filters on all three text fields so a seller can find their exact drop.
 *
 * If nothing matches, the "not listed" path hands off to SkuRequestForm
 * (handoff M2) instead of sending a half-filled listing.
 */

import { useMemo, useState } from "react";
import type { Sku } from "@/lib/db/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatFsc, formatUsd } from "@/components/card/format";

export interface SkuPickerProps {
  skus: readonly Sku[];
  selected: Sku | null;
  onSelect: (sku: Sku) => void;
  onRequestMissing: () => void;
}

export function SkuPicker({
  skus,
  selected,
  onSelect,
  onRequestMissing,
}: SkuPickerProps) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skus;
    return skus.filter((sku) =>
      [sku.brand, sku.model, sku.colorway]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [skus, query]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Find your shoe"
        placeholder="jordan 1 / red / air force / dunk …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        hint={`${matches.length} of ${skus.length} in the catalog`}
      />

      {selected && (
        <div className="flex items-center justify-between gap-2 border border-accent bg-accent/10 px-2 py-1.5 font-mono text-[11px] tracking-tight">
          <span className="text-foreground">
            {selected.brand} {selected.model} · {selected.colorway} · US{" "}
            {selected.size_us}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              onSelect(null as unknown as Sku);
            }}
          >
            change
          </Button>
        </div>
      )}

      <div className="grid max-h-[300px] grid-cols-1 gap-1.5 overflow-y-auto pr-1">
        {matches.length === 0 && (
          <div className="flex flex-col gap-2 border border-dashed border-line-strong px-3 py-4 font-mono text-[11px] tracking-tight text-muted">
            <span>No match for “{query}”.</span>
            <span>If the shoe is real, we may not have it priced yet.</span>
          </div>
        )}
        {matches.map((sku) => {
          const isSelected = selected?.id === sku.id;
          return (
            <button
              key={sku.id}
              type="button"
              onClick={() => onSelect(sku)}
              aria-pressed={isSelected}
              className={
                "flex items-center justify-between gap-2 border px-2 py-1.5 text-left font-mono text-[11px] tracking-tight transition-colors " +
                (isSelected
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-line-strong bg-overlay text-foreground hover:border-muted")
              }
            >
              <span className="min-w-0">
                <span className="block truncate font-bold">
                  {sku.brand} {sku.model}
                </span>
                <span className="block truncate text-muted">
                  {sku.colorway} · US {sku.size_us}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-accent">
                  {sku.market_price_cents != null
                    ? formatFsc(sku.market_price_cents)
                    : "unpriced"}
                </span>
                {sku.market_price_cents != null && (
                  <span className="block text-[9px] text-muted">
                    {formatUsd(sku.market_price_cents)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-line-strong pt-3 font-mono text-[10px] tracking-tight text-muted">
        <span>Only priced, live catalog SKUs appear here.</span>
        <Button variant="ghost" size="sm" onClick={onRequestMissing}>
          don&apos;t see your shoe? request it
        </Button>
      </div>
    </div>
  );
}