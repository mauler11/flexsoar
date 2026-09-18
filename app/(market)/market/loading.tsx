/**
 * app/(market)/market/loading.tsx
 *
 * Route-level skeleton: shown on hard navigations into /market (logo click,
 * OAuth fallbacks, first paint). Filter changes inside the page use the
 * lighter in-page Suspense fallback instead, so the filter bar stays
 * mounted and interactive.
 */
import {
  FeaturedSkeleton,
  GridSkeleton,
} from "@/components/market/MarketSkeleton";

export default function MarketLoading() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading market">
      <FeaturedSkeleton />
      <div
        aria-hidden
        className="h-[76px] animate-pulse rounded-2xl border border-line bg-raised/40"
      />
      <GridSkeleton />
    </div>
  );
}
