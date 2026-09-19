"use client";

/**
 * components/market/SearchPageView.tsx
 *
 * Mobile search: the header pill opens a full-screen search tab that
 * slides in from the right and covers everything (header included) —
 * just a long search bar, live results, and CANCEL.
 *
 * The panel portals to document.body on purpose. Earlier attempts rendered
 * it inside the sticky header, where backdrop-blur makes the header the
 * containing block for fixed descendants (inset-0 resolved against the
 * header, not the viewport). A body portal has no such trap.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { searchMarketAction } from "@/app/(market)/actions";
import { toSku } from "@/components/market/bridge";
import { CardArt } from "@/components/card/CardArt";
import { FiatAmount } from "@/components/market/Fiat";
import type { ListingSummary } from "@/lib/api/contract";
import { cn } from "@/components/ui/cn";

export function MarketSearchPill() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search the market"
        aria-haspopup="dialog"
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
      </button>

      {mounted &&
        open &&
        createPortal(
          <MarketSearchPanel onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}

function MarketSearchPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ListingSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter animation only: mount off-canvas right, slide to zero on the
  // next frame. Close unmounts immediately — no exit choreography needed.
  const [shown, setShown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const searched = query.trim().length > 0;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search the market"
      className={cn(
        "fixed inset-0 z-[60] flex flex-col bg-background transition-transform duration-300 ease-out",
        shown ? "translate-x-0" : "translate-x-full",
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-3">
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
          onClick={onClose}
          className="shrink-0 px-1 text-sm font-bold uppercase tracking-wide text-foreground underline underline-offset-4 transition hover:text-accent"
        >
          Cancel
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
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
              <span
                aria-hidden="true"
                className="shrink-0 text-xl text-muted"
              >
                ›
              </span>
            </Link>

            <p className="px-1 pb-1 pt-4 text-xs font-extrabold uppercase tracking-widest text-muted">
              Top results
            </p>
            {error && (
              <p className="px-1 py-3 text-sm text-[#FF4444]">{error}</p>
            )}
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
    </div>
  );
}
