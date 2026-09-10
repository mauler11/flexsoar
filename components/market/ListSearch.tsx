"use client";

/**
 * components/market/ListSearch.tsx
 *
 * The list landing's centered search. Debounced lookup against sku_models
 * through searchSkuModelsAction (read-only, creates nothing); each result
 * links to the product page (/list/[modelId]), where sizes live. An empty
 * result set offers the Product Request path instead of a dead end.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { searchSkuModelsAction } from "@/app/(market)/list/actions";

interface ModelHit {
  id: string;
  brand: string;
  model: string;
  colorway: string;
  basePriceCents: number | null;
  artUrl: string | null;
  variantCount: number;
  cardCount: number;
}

export function ListSearch() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ModelHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searched = query.trim().length > 0;

  useEffect(() => {
    if (!searched) {
      setHits(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const formData = new FormData();
        formData.set("brand", query);
        formData.set("model", "");
        formData.set("colorway", "");
        const result = await searchSkuModelsAction(formData);
        if (cancelled) return;
        if (result.ok) setHits(result.models);
        else setError(result.message);
      } catch {
        if (!cancelled) setError("Search failed — try again.");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searched]);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          role="searchbox"
          aria-label="Search products to sell"
          placeholder="Search for products, brands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-2xl border border-line-strong bg-raised py-3.5 pl-11 pr-4 text-[15px] text-foreground placeholder:text-muted/60 hover:border-muted focus:border-accent focus:outline-none"
        />
      </div>

      {error && <p className="text-sm text-[#FF4444]">{error}</p>}

      {searched && !searching && hits != null && hits.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-2xl border border-line bg-raised">
          {hits.map((hit) => (
            <li key={hit.id} className="border-b border-line last:border-b-0">
              <Link
                href={`/list/${hit.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-overlay"
              >
                {hit.artUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external host, same call as CardArt
                  <img
                    src={hit.artUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-overlay text-sm font-extrabold text-muted"
                  >
                    {hit.brand.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
                    {hit.brand} {hit.model}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {hit.colorway}
                    {hit.variantCount > 0 ? ` · ${hit.variantCount} sizes` : ""}
                    {hit.basePriceCents == null ? " · unpriced" : ""}
                  </span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-muted">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {searched && !searching && hits != null && hits.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-raised px-4 py-8 text-center">
          <p className="max-w-sm text-sm leading-relaxed text-muted">
            We couldn&apos;t find what you&apos;re looking for. Please try a
            different search or make a{" "}
            <Link href="/list/request" className="font-semibold text-accent hover:underline">
              Product Request
            </Link>
          </p>
        </div>
      )}

      {searching && (
        <p className="text-center text-[13px] text-muted">Searching…</p>
      )}
    </div>
  );
}
