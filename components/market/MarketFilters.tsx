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
import { BRAND_PILL_EXCLUSIONS, tierName } from "@/lib/domain/rarity";
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
    q?: string;
  };
}

const SORT_OPTIONS = [
  { value: "recent", label: "Newest" },
  { value: "price_asc", label: "Price low → high" },
  { value: "price_desc", label: "Price high → low" },
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

  const pillActive =
    "border-transparent bg-accent font-semibold text-[#0B0B0B]";
  const pillIdle =
    "border-line-strong bg-raised text-muted hover:border-muted hover:text-foreground";
  const pills = ["", ...BRAND_PILL_EXCLUSIONS, "Other"];

  function onPillClick(value: string) {
    if (value === "") {
      push({ brand: null, model: null });
      return;
    }
    // Model options are brand-scoped; switching pills drops a stale model.
    // "Other" has no model list, so it always resets the model too.
    push({ brand: value, model: null });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-raised/40 p-3">
      <div className="flex items-center gap-2">
        <div
          role="group"
          aria-label="Filter by brand"
          className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1"
        >
          {pills.map((b) => {
            const active = (initial.brand ?? "") === b;
            return (
              <button
                key={b || "all"}
                type="button"
                aria-pressed={active}
                onClick={() => onPillClick(b)}
                className={`shrink-0 rounded-lg border px-3.5 py-1.5 text-[13px] transition-colors ${
                  active ? pillActive : pillIdle
                }`}
              >
                {b || "All"}
              </button>
            );
          })}
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted">
          <span className="hidden sm:inline">Sort</span>
          <select
            aria-label="Sort listings"
            value={initial.sort}
            onChange={(e) => push({ sort: e.target.value })}
            className="rounded-lg border border-line-strong bg-raised px-2 py-1.5 text-[13px] text-foreground"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-raised">
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {initial.q && (
        <p className="text-[13px] text-muted">
          Results for <span className="font-semibold text-foreground">“{initial.q}”</span>{" "}
          <button
            type="button"
            onClick={() => push({ q: null })}
            className="text-accent hover:underline"
          >
            clear
          </button>
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
      <Select
        label="Model"
        options={[{ value: "", label: "All" }, ...models.map((m) => ({ value: m, label: m }))]}
        value={initial.model ?? ""}
        disabled={!initial.brand || initial.brand === "Other"}
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
            q: null,
          })
        }
      >
        Clear
      </Button>
      </div>
    </div>
  );
}