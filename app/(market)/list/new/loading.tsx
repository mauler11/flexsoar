/**
 * app/(market)/list/new/loading.tsx
 *
 * Shown while the product page's SELL target resolves the size variant.
 * Without this, the variant-ensure round trip reads as a bounce back to
 * the product page when it fails — and as dead air when it succeeds.
 */
export default function ListNewLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          Submit your pair
        </h1>
        <p className="mt-1 text-sm text-muted">
          Preparing your size…
        </p>
      </div>
      <div
        aria-hidden="true"
        className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-4"
      >
        <div className="h-5 w-2/3 animate-pulse rounded-lg bg-overlay" />
        <div className="h-5 w-1/2 animate-pulse rounded-lg bg-overlay" />
        <div className="h-10 w-full animate-pulse rounded-xl bg-overlay" />
      </div>
    </div>
  );
}
