"use client";

/**
 * components/market/intake/SkuModelFinder.tsx
 *
 * Replaces the dead "request a SKU" flow. As the seller types brand + model +
 * colourway, fuzzy-match against existing sku_models via the server action.
 * Show close matches so a seller typing "Jordan 1 Chicago" sees the existing
 * "Air Jordan 1 / Chicago" model if it's already there.
 *
 * If nothing fits, create inline: calls createSkuModel (no price — sellers
 * must never set the oracle) then ensureSkuVariant for their size. This
 * happens as part of the listing flow, not a separate ledger/request step.
 */

import { useState, useTransition, useEffect, useCallback } from "react";
import { findOrCreateSkuModelAction, searchSkuModelsAction } from "@/app/(market)/list/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Sku } from "@/lib/db/types";

export interface SkuModelFinderProps {
  /** Prefilled when the seller typed a brand/model that didn't match in SkuPicker. */
  initialBrand?: string;
  initialModel?: string;
  initialColorway?: string;
  /** Called with the created/found variant SKU, the model info, and flags. */
  onDone: (sku: Sku, model: SkuModelFinderResult["model"], isNewModel: boolean, isUnpriced: boolean) => void;
  onBack: () => void;
}

export interface SkuModelFinderResult {
  skuId: string;
  model: {
    modelId: string;
    brand: string;
    model: string;
    colorway: string;
    basePriceCents: number | null;
    variantId: string | null;
    sizeUs: number | null;
  };
  isNewModel: boolean;
  isUnpriced: boolean;
}

interface ModelMatch {
  id: string;
  brand: string;
  model: string;
  colorway: string;
  basePriceCents: number | null;
  variantCount: number;
  cardCount: number;
}

export function SkuModelFinder({
  initialBrand = "",
  initialModel = "",
  initialColorway = "",
  onDone,
  onBack,
}: SkuModelFinderProps) {
  const [brand, setBrand] = useState(initialBrand);
  const [model, setModel] = useState(initialModel);
  const [colorway, setColorway] = useState(initialColorway);
  const [size, setSize] = useState("");
  const [matches, setMatches] = useState<ModelMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<ModelMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Debounced fuzzy search as user types in brand/model/colorway
  const searchKey = [brand, model, colorway].filter(Boolean).join(" ").toLowerCase();

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || !searchKey.trim()) {
        if (!cancelled) setMatches([]);
        return;
      }
      setSearching(true);
      try {
        const formData = new FormData();
        formData.set("brand", brand);
        formData.set("model", model);
        formData.set("colorway", colorway);
        const result = await searchSkuModelsAction(formData);
        if (!cancelled) {
          if (result.ok) {
            setMatches(result.models);
          } else {
            setError(result.message);
          }
        }
      } catch {
        if (!cancelled) setError("Search failed — try again.");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchKey, brand, model, colorway]);

  // When a match is selected, prefill the form
  const handleSelectMatch = useCallback((m: ModelMatch) => {
    setSelectedMatch(m);
    setBrand(m.brand);
    setModel(m.model);
    setColorway(m.colorway);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await findOrCreateSkuModelAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const sku: Sku = {
        id: result.skuId,
        model_id: result.model.modelId,
        brand: result.model.brand,
        model: result.model.model,
        colorway: result.model.colorway,
        size_us: result.model.sizeUs ?? 0,
        retail_price_cents: null,
        market_price_cents: result.model.basePriceCents,
        size_multiplier: 1.0,
        price_override_cents: null,
        price_confidence: null,
        priced_at: null,
        demand_score: 0,
        sprite_key: null,
        palette: null,
        art_url: null,
        mint_cap: null,
        created_at: new Date().toISOString(),
      };
      onDone(sku, result.model, result.isNewModel, result.isUnpriced);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="border border-dashed border-[#E8B33A]/60 bg-[#E8B33A]/5 px-3 py-2 font-mono text-[10px] tracking-tight text-muted">
        We&apos;ll match your shoe against existing models. If it&apos;s new, we&apos;ll create
        the model (no price — pricing is an admin decision) and your size variant
        instantly. You can list immediately; an unpriced model just means the
        card can&apos;t mint until an admin sets the oracle price.
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Brand"
          name="brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          required
        />
        <Input
          label="Model"
          name="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          required
        />
        <Input
          label="Colorway"
          name="colorway"
          placeholder="e.g. Chicago"
          value={colorway}
          onChange={(e) => setColorway(e.target.value)}
        />
        <Input
          label="US size"
          name="size"
          type="number"
          min="3"
          max="20"
          step="0.5"
          placeholder="e.g. 9.5"
          value={size}
          onChange={(e) => setSize(e.target.value)}
        />
      </div>

      {matches.length > 0 && (
        <div className="border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[11px] tracking-tight">
          <div className="font-bold text-foreground mb-1">Close matches (click to select):</div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelectMatch(m)}
                className={
                  "flex items-center justify-between gap-2 border px-2 py-1 text-left transition-colors " +
                  (selectedMatch?.id === m.id
                    ? "border-accent bg-accent/15 text-foreground"
                    : "border-line-strong bg-overlay text-foreground hover:border-muted")
                }
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold">
                    {m.brand} {m.model}
                  </span>
                  <span className="block truncate text-muted">
                    {m.colorway} · {m.variantCount} sizes · {m.cardCount} cards
                    {m.basePriceCents === null && " · unpriced"}
                  </span>
                </span>
                <span className="shrink-0 text-accent">
                  {m.basePriceCents != null ? `$${(m.basePriceCents / 100).toFixed(0)}` : "unpriced"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {searching && matches.length === 0 && (
        <p className="font-mono text-[10px] tracking-tight text-muted">
          Searching models…
        </p>
      )}

      {error && (
        <p className="font-mono text-[10px] tracking-tight text-[#FF4444]">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={isPending}>
          back
        </Button>
        <Button type="submit" size="md" disabled={isPending || searching}>
          {isPending || searching ? "finding…" : "confirm & continue"}
        </Button>
      </div>
    </form>
  );
}