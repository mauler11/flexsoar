"use client";

/**
 * components/market/MarketSearchBox.tsx
 *
 * The header search on mobile AND desktop: an inline field that expands
 * into a live results dropdown instead of navigating away. Typing
 * debounces through searchMarketAction (read-only, session-scoped like
 * the grid); the panel offers an "All results for X →" row into
 * /market?q= plus top-6 listing rows into the card pages. Enter jumps to
 * the full grid; Escape, route change, or tapping outside closes.
 *
 * Panel positioning differs by slot: the desktop field is wide, so the
 * panel hangs off the field itself (absolute); the mobile field is a
 * sliver of a crowded row, so the panel spans the screen width (fixed).
 * "/" focuses the field from anywhere, same as before.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { searchMarketAction } from "@/app/(market)/actions";
import { toSku } from "@/components/market/bridge";
import { CardArt } from "@/components/card/CardArt";
import { FiatAmount } from "@/components/market/Fiat";
import type { ListingSummary } from "@/lib/api/contract";
import { cn } from "@/components/ui/cn";

export function MarketSearchBox({ mobile = false }: { mobile?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<ListingSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const searched = query.trim().length > 0;
  // Deliberately NOT closed on input blur: blur fires on mousedown before
  // a row tap's click lands, which would unmount the row and swallow the
  // navigation. Backdrop, Escape, Enter, and route changes close it.
  const open = focused && searched;

  // "/" focuses search from anywhere (unless already typing somewhere).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A navigation (row tap, All-results, Enter) closes the panel — the
  // header itself never unmounts, so nothing else would.
  useEffect(() => {
    setFocused(false);
  }, [pathname]);

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

  function goAllResults() {
    const q = query.trim();
    if (!q) return;
    router.push(`/market?q=${encodeURIComponent(q)}`);
  }

  return (
    <>
      <div className="relative w-full">
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
          aria-label={mobile ? "Search the market" : "Search sneakers (press / to focus)"}
          aria-expanded={open}
          placeholder={mobile ? "Search" : "Search for sneakers, brands, or collections…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") goAllResults();
            else if (e.key === "Escape") {
              setFocused(false);
              inputRef.current?.blur();
            }
          }}
          className="w-full rounded-xl border border-line-strong bg-raised py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-muted/60 hover:border-muted focus:border-accent focus:outline-none"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-muted hover:text-foreground"
          >
            ×
          </button>
        ) : (
          !mobile && (
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line-strong px-1.5 text-[11px] text-muted sm:block"
            >
              /
            </kbd>
          )
        )}

        {open && (
          <div
            role="listbox"
            aria-label="Search suggestions"
            className={cn(
              "overflow-hidden rounded-2xl border border-line bg-raised shadow-soft",
              mobile
                ? "fixed left-3 right-3 top-[68px] z-50"
                : "absolute inset-x-0 top-[calc(100%+8px)] z-50",
            )}
          >
            <button
              type="button"
              onClick={goAllResults}
              className="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left transition hover:bg-overlay"
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
            </button>
            <p className="px-4 pb-1 pt-3 text-[11px] font-extrabold uppercase tracking-widest text-muted">
              Top results
            </p>
            {error && (
              <p className="px-4 py-2 text-sm text-[#FF4444]">{error}</p>
            )}
            {searching && (
              <p className="px-4 py-2 text-[13px] text-muted">Searching…</p>
            )}
            {!searching && hits != null && hits.length === 0 && (
              <p className="px-4 py-2 text-sm text-muted">
                Nothing listed matches — try the full results above.
              </p>
            )}
            {!searching && hits != null && hits.length > 0 && (
              <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
                {hits.map((listing) => (
                  <li
                    key={listing.id}
                    className="border-b border-line last:border-b-0"
                  >
                    <Link
                      href={`/card/${listing.card_id}`}
                      className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-overlay"
                    >
                      <span className="block h-11 w-11 shrink-0 overflow-hidden rounded-lg">
                        <CardArt
                          sku={toSku(listing.card.sku)}
                          aspect="aspect-square"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] uppercase tracking-wide text-muted">
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
          </div>
        )}
      </div>
      {open && (
        <button
          type="button"
          aria-label="Close search results"
          onClick={() => setFocused(false)}
          className="fixed inset-0 z-40 cursor-default bg-black/40 lg:bg-transparent"
        />
      )}
    </>
  );
}
