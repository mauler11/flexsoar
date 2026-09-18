/**
 * components/market/MarketSkeleton.tsx
 *
 * Pulse placeholders for the browse grid. Shapes mirror the real layout
 * (featured hero + tile grid) so the swap from skeleton to content doesn't
 * reflow the page. Server-safe: no client code, imported by both
 * market/loading.tsx (route transitions) and the in-page Suspense fallback
 * (filter changes).
 */
export function TileSkeleton() {
  return (
    <div
      aria-hidden
      className="flex flex-col overflow-hidden rounded-2xl border border-line bg-raised"
    >
      <div className="aspect-[4/3] animate-pulse bg-line/70" />
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="h-4 w-3/4 animate-pulse rounded bg-line" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-line/70" />
        <div className="mt-0.5 h-5 w-2/5 animate-pulse rounded bg-line" />
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <TileSkeleton key={i} />
      ))}
    </div>
  );
}

export function FeaturedSkeleton() {
  return (
    <section
      aria-hidden
      className="grid overflow-hidden rounded-2xl border border-line-strong bg-black sm:grid-cols-2"
    >
      <div className="flex flex-col items-start justify-center gap-2 p-4 sm:p-6">
        <div className="h-5 w-20 animate-pulse rounded-md bg-line" />
        <div className="h-8 w-4/5 animate-pulse rounded bg-line" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-line/70" />
        <div className="mt-3 h-11 w-40 animate-pulse rounded-md bg-line" />
      </div>
      <div className="min-h-48 animate-pulse bg-line/40 sm:min-h-60" />
    </section>
  );
}
