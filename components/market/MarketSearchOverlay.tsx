"use client";

/**
 * components/market/MarketSearchOverlay.tsx
 *
 * Mobile search, Novelship-arranged: the header carries only a compact
 * Search pill linking to the /search section; that page is the full search
 * view — big input with clear (X), CANCEL, an "All results for X →" row
 * into /market?q=, and live TOP RESULTS rows (debounced lookup through
 * searchMarketAction, read-only, session-scoped like the grid).
 *
 * This used to be a fixed overlay inside the sticky header, but
 * backdrop-blur on the header makes it the containing block for fixed
 * descendants — inset-0 resolved against the header, not the viewport. A
 * real route has no such trap, keeps back-button semantics, and is what
 * "opens a new section" means.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { searchMarketAction } from "@/app/(market)/actions";
import { toSku } from "@/components/market/bridge";
import { CardArt } from "@/components/card/CardArt";
import { FiatAmount } from "@/components/market/Fiat";
import type { ListingSummary } from "@/lib/api/contract";

export function MarketSearchPill() {
  return (
    <Link
      href="/search"
      aria-label="Search the market"
      className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line-strong bg-raised px-3 py-2 text-sm text-muted transition hover:border-muted hover:text-foreground"
    >
      <svg
        className="h-4 w-4 shrink-0"
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
      <span className="truncate">Search</span>
    </Link>
  );
}

export function MarketSearchView() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ListingSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const searched = query.trim().length > 0;

  // Focus the field on arrival; Escape cancels back out.
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const result = await searchMarketAction(query);
        if (cancelled) return;
        if (result.ok) setHits(result.listings ?? []);
        else setError(result.message ?? "Search failed — try again.");
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

  function cancel() {
    if (window.history.length > 1) router.back();
    else router.replace("/market");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
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
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label="Search the market"
            placeholder="Search sneakers, brands…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-line-strong bg-raised py-2.5 pl-9 pr-9 text-[15px] text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-lg leading-none text-muted transition hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={cancel}
          className="shrink-0 px-1 text-sm font-bold uppercase tracking-wide text-foreground underline underline-offset-4 transition hover:text-accent"
        >
          Cancel
        </button>
      </div>

      {!searched ? (
        <p className="px-1 py-6 text-center text-sm text-muted">
          Type to search live listings across the market.
        </p>
      ) : (
        <>
          <Link
            href={`/market?q=${encodeURIComponent(query.trim())}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3 transition hover:border-muted"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-muted">
                All results for{" "}
                <span className="font-bold text-foreground">
                  {query.trim()}
                </span>
              </span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-xl text-muted">
              ›
            </span>
          </Link>

          <p className="px-1 pb-1 pt-4 text-xs font-extrabold uppercase tracking-widest text-muted">
            Top results
          </p>
          {error && <p className="px-1 py-3 text-sm text-[#FF4444]">{error}</p>}
          {searching && (
            <p className="px-1 py-3 text-[13px] text-muted">Searching…</p>
          )}
          {!searching && hits != null && hits.length === 0 && (
            <p className="px-1 py-3 text-sm text-muted">
              Nothing listed matches — try the full results above.
            </p>
          )}
          {!searching && hits != null && hits.length > 0 && (
            <ul className="flex flex-col overflow-hidden rounded-2xl border border-line bg-raised">
              {hits.map((listing) => (
                <li
                  key={listing.id}
                  className="border-b border-line last:border-b-0"
                >
                  <Link
                    href={`/card/${listing.card_id}`}
                    className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-overlay"
                  >
                    <span className="block h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                      <CardArt
                        sku={toSku(listing.card.sku)}
                        aspect="aspect-square"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] uppercase tracking-wide text-muted">
                        {listing.card.sku.brand}
                      </span>
                      <span className="block truncate text-sm font-bold">
                        {listing.card.sku.brand} {listing.card.sku.model}{" "}
                        {listing.card.sku.colorway}
                      </span>
                      <span className="block text-[13px] font-semibold">
                        <FiatAmount cents={listing.price_cents} />
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-xl text-muted"
                    >
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
