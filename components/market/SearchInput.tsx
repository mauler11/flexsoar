"use client";

/**
 * components/market/SearchInput.tsx
 *
 * Header text search. Writes the shared `q` URL param (debounced) so the
 * server re-renders the grid; back/forward keep working and there is no
 * local canonical state to desync — the same URL-driven contract as
 * MarketFilters. Clears itself when navigation resets `q` elsewhere.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export interface SearchInputProps {
  initial?: string;
}

export function SearchInput({ initial = "" }: SearchInputProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initial);

  // Another control (e.g. Clear) can reset q — follow it.
  useEffect(() => {
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (value === (searchParams.get("q") ?? "")) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set("q", value.trim());
      else params.delete("q");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, 400);
    return () => clearTimeout(timer);
  }, [value, pathname, router, searchParams]);

  return (
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
        type="search"
        role="searchbox"
        aria-label="Search sneakers"
        placeholder="Search for sneakers, brands, or collections…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-xl border border-line-strong bg-raised py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-muted/60 hover:border-muted focus:border-accent focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setValue("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-muted hover:text-foreground"
        >
          ×
        </button>
      ) : (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line-strong px-1.5 text-[11px] text-muted sm:block"
        >
          /
        </kbd>
      )}
    </div>
  );
}
