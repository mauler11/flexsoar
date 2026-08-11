/**
 * components/market/MarketFilters.tsx
 *
 * The browse-grid filters. Purely URL-driven: every change rewrites
 * searchParams on the same path, so the server re-renders and back/forward
 * stay sensible — no local canonical state to desync.
 *
 * The option lists are built server-side from the catalogue (getSkus), so the
 * selects show only brands/models/sizes that actually exist. Model is
 * brand-aware when a brand is chosen.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { tierName } from "@/lib/domain/rarity";
import type { Tier } from "@/lib/db/types";

export interface MarketFiltersProps {
  brands: string[];
  modelsByBrand: Record<string, string[]>;
  sizes: number[];
  maxTier: number;
  initial: {
    brand?: string;
    model?: string;
    sizeUs?: number;
    tier: number[];
    sort: string;
  };
}

const SORT_OPTIONS = [
  { value: "recent", label: "Newest" },
  { value: "price_asc", label: "Price low → high" },
  { value: "price_desc", label: "Price high → low" },
  { value: "public_at_asc", label: "Unlocks soon" },
  { value: "float_desc", label: "Float best" },
];

export function MarketFilters({
  brands,
  modelsByBrand,
  sizes,
  maxTier,
  initial,
}: MarketFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function push(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value == null || value === "") params.delete(key);
      else params.set(key, value);
    }
    for (const key of ["error", "order", "redeemed", "listed"] as const) {
      params.delete(key);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  const tierOptions =
    maxTier > 0
      ? Array.from({ length: maxTier }, (_, i) => (i + 1) as Tier).map((t) => ({
          value: String(t),
          label: tierName(t),
        }))
      : [];
  const models =
    initial.brand && initial.brand in modelsByBrand
      ? modelsByBrand[initial.brand]
      : [];

  function onBrandChange(value: string) {
    const nextBrand = value || null;
    if (
      nextBrand &&
      initial.model &&
      !(modelsByBrand[nextBrand] ?? []).includes(initial.model)
    ) {
      push({ brand: nextBrand, model: null });
      return;
    }
    push({ brand: nextBrand });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border border-line bg-overlay px-3 py-2">
      <Select
        label="Brand"
        options={[{ value: "", label: "All" }, ...brands.map((b) => ({ value: b, label: b }))]}
        value={initial.brand ?? ""}
        onChange={(e) => onBrandChange(e.target.value)}
      />
      <Select
        label="Model"
        options={[{ value: "", label: "All" }, ...models.map((m) => ({ value: m, label: m }))]}
        value={initial.model ?? ""}
        disabled={!initial.brand}
        onChange={(e) => push({ model: e.target.value || null })}
      />
      <Select
        label="Size"
        options={[{ value: "", label: "All" }, ...sizes.map((s) => ({ value: String(s), label: `US ${s}` }))]}
        value={initial.sizeUs != null ? String(initial.sizeUs) : ""}
        onChange={(e) => push({ size: e.target.value || null })}
      />
      <Select
        label="Tier"
        options={[{ value: "", label: "All" }, ...tierOptions]}
        value={initial.tier.length === 1 ? String(initial.tier[0]) : initial.tier.length > 1 ? "Tier" : ""}
        onChange={(e) => push({ tier: e.target.value || null })}
      />
      <Select
        label="Sort"
        options={SORT_OPTIONS}
        value={initial.sort}
        onChange={(e) => push({ sort: e.target.value })}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          push({
            brand: null,
            model: null,
            size: null,
            tier: null,
            sort: "recent",
          })
        }
      >
        Clear
      </Button>
    </div>
  );
}