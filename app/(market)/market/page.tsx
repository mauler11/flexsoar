/**
 * app/(market)/market/page.tsx
 *
 * The browse grid. Every listing the viewer is allowed to see: public ones,
 * and early-access ones they hold a level for (or sell). Filters are URL
 * state, the server does the rest, and the same query that renders the grid
 * feeds the card links.
 */
import type { Metadata } from "next";
import { getListings, getPlatformConfig, getSkus } from "@/lib/api/contract";
import type { ListingSort, ListingsQuery } from "@/lib/api/contract";
import type { Tier } from "@/lib/db/types";
import { currentUserId } from "@/app/(market)/queries";
import { MarketFilters } from "@/components/market/MarketFilters";
import { MarketTile } from "@/components/market/MarketTile";
import { Banner } from "@/components/market/Banner";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = {
  title: "Market — FlexSoar",
};

const SORTS: readonly ListingSort[] = [
  "recent",
  "price_asc",
  "price_desc",
  "float_desc",
  "public_at_asc",
];

interface BrowseSearchParams {
  brand?: string;
  model?: string;
  size?: string;
  tier?: string;
  sort?: string;
  error?: string;
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<BrowseSearchParams>;
}) {
  const params = await searchParams;
  const viewerId = await currentUserId();

  const brand = params.brand?.trim() || undefined;
  const model = params.model?.trim() || undefined;
  const sizeUs = params.size ? Number(params.size) : undefined;
  const tier = params.tier
    ? params.tier
        .split(",")
        .map((t) => Number(t))
        .filter((t) => Number.isInteger(t) && t >= 1 && t <= 5)
    : [];
  const sort: ListingSort = SORTS.includes(params.sort as ListingSort)
    ? (params.sort as ListingSort)
    : "recent";

  const query: ListingsQuery = { viewerId: viewerId ?? undefined, sort };
  if (brand) query.brand = brand;
  if (model) query.model = model;
  if (sizeUs != null && Number.isFinite(sizeUs)) query.sizeUs = sizeUs;
  if (tier.length) query.tier = tier as Tier[];

  const [listings, skus, platformConfig] = await Promise.all([
    getListings(query),
    getSkus({ limit: 400 }),
    getPlatformConfig(),
  ]);

  const brands = [...new Set(skus.map((s) => s.brand))].sort();
  const modelsByBrand: Record<string, string[]> = {};
  for (const s of skus) {
    if (!s.brand) continue;
    (modelsByBrand[s.brand] ??= []).push(s.model);
  }
  for (const key of Object.keys(modelsByBrand)) {
    modelsByBrand[key] = [...new Set(modelsByBrand[key])].sort();
  }
  const sizes = [...new Set(skus.map((s) => s.size_us))].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-black uppercase tracking-tight">
            Market
          </h1>
          <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Level-gated early access · oracle-priced asks
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
          {listings.length} live
        </p>
      </div>

      {params.error && (
        <Banner tone="error" title="Couldn't do that">
          {params.error}
        </Banner>
      )}

      <MarketFilters
        brands={brands}
        modelsByBrand={modelsByBrand}
        sizes={sizes}
        maxTier={5}
        initial={{
          brand,
          model,
          sizeUs: sizeUs != null && Number.isFinite(sizeUs) ? sizeUs : undefined,
          tier,
          sort,
        }}
      />

      {listings.length === 0 ? (
        <EmptyState
          title="Nothing listed yet"
          description="No listings match these filters right now. Early-access windows and new mints fill this grid as they unlock."
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {listings.map((listing) => (
            <MarketTile
              key={listing.id}
              listing={listing}
              showNumericFloat={platformConfig.show_numeric_float}
            />
          ))}
        </div>
      )}
    </div>
  );
}