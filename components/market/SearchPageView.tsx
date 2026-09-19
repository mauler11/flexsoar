"use client";

/**
 * components/market/SearchPageView.tsx
 *
 * The /search section. On mobile the main shell header steps aside and
 * this renders its own header row — burger, mini logo, expanded input,
 * CANCEL — so tapping search reads as the header's search bar growing to
 * fill the whole row. Below it: "All results for X →" plus live TOP
 * RESULTS (debounced, read-only, session-scoped like the grid).
 *
 * The swap works without the layout knowing the route: on mount this adds
 * a body class (removed on unmount) and a <style> rule hides
 * .market-shell-header on small screens only. Desktop keeps the normal
 * header and gets a big input + the same results.
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { searchMarketAction } from "@/app/(market)/actions";
import { toSku } from "@/components/market/bridge";
import { CardArt } from "@/components/card/CardArt";
import { FiatAmount } from "@/components/market/Fiat";
import { MobileNavButton } from "@/components/market/Sidebar";
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
  const desktopRef = useRef<HTMLInputElement>(null);

  const searched = query.trim().length > 0;

  // Swap the shell header for the search header (mobile only — the rule
  // below is max-width scoped). Cleanup restores it on navigate-away.
  useEffect(() => {
    document.body.classList.add("hide-market-header");
    inputRef.current?.focus();
    return () => {
      document.body.classList.remove("hide-market-header");
    };
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

  const fieldClass =
    "w-full rounded-xl border border-line-strong bg-raised py-2.5 pl-9 pr-9 text-[15px] text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none";
  const icon = (
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
  );

  return (
    <>
      <style>{`@media (max-width: 639px){body.hide-market-header .market-shell-header{display:none}}`}</style>

      {/* Mobile search header: same row geometry as the shell header it
          replaces (px-3, py-3, border, blur) so the swap is seamless.
          -mx-0.5 cancels main's own padding for a true full-bleed row. */}
      <div className="sticky top-0 z-40 -mx-0.5 border-b border-line bg-background/80 px-3 backdrop-blur sm:hidden">
        <div className="flex w-full items-center gap-2 py-3">
          <MobileNavButton />
          <Link href="/" aria-label="FlexSoar home" className="shrink-0">
            <Image
              src="/logo-white-big.png"
              alt="FlexSoar"
              width={150}
              height={50}
              priority
              className="h-5 w-auto"
            />
          </Link>
          <div className="relative min-w-0 flex-1">
            {icon}
            <input
              ref={inputRef}
              type="text"
              role="searchbox"
              aria-label="Search the market"
              placeholder="Search sneakers, brands…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={fieldClass}
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
      </div>

      {/* Desktop: the shell header stays; a big field opens the section. */}
      <div className="relative hidden min-w-0 flex-1 sm:block">
        {icon}
        <input
          ref={desktopRef}
          type="text"
          role="searchbox"
          aria-label="Search the market"
          placeholder="Search sneakers, brands, or collections…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && searched) {
              router.push(`/market?q=${encodeURIComponent(query.trim())}`);
            }
          }}
          className={fieldClass}
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

      <div className="mt-2 flex flex-col gap-2">
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
    </>
  );
}
