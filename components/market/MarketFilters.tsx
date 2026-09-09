/**
 * components/market/MarketFilters.tsx
 *
 * The browse-grid filters. Purely URL-driven: every change rewrites
 * searchParams on the same path, so the server re-renders and back/forward
 * stay sensible — no local canonical state to desync.
 *
 * Fixed brand pills (All + houses + Other) with Sort on the right. "Other"
 * resolves server-side to every brand outside the pill set.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BRAND_PILL_EXCLUSIONS } from "@/lib/domain/rarity";

export interface MarketFiltersProps {
  initial: {
    brand?: string;
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

export function MarketFilters({ initial }: MarketFiltersProps) {
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
    push({ brand: value, model: null });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-raised/40 p-3">
      <div className="flex items-center gap-3">
        <div
          role="group"
          aria-label="Filter by brand"
          className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-1"
        >
          {pills.map((b) => {
            const active = (initial.brand ?? "") === b;
            return (
              <button
                key={b || "all"}
                type="button"
                aria-pressed={active}
                onClick={() => onPillClick(b)}
                className={`shrink-0 rounded-lg border px-4 py-2 text-sm transition-colors ${
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
    </div>
  );
}
