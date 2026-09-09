/**
 * app/(market)/page.tsx
 *
 * The browse grid. Every listing the viewer is allowed to see: public ones,
 * and early-access ones they hold a level for (or sell). Filters are URL
 * state, the server does the rest, and the same query that renders the grid
 * feeds the card links.
 */
import type { Metadata } from "next";
import { BRAND_PILL_EXCLUSIONS, getListings, getPlatformConfig } from "@/lib/api/contract";
import type { ListingSort, ListingsQuery } from "@/lib/api/contract";
import { FeaturedCard } from "@/components/market/FeaturedCard";
import type { Tier } from "@/lib/db/types";
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
];

interface BrowseSearchParams {
  brand?: string;
  model?: string;
  size?: string;
  tier?: string;
  sort?: string;
  q?: string;
  error?: string;
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<BrowseSearchParams>;
}) {
  const params = await searchParams;

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

  const query: ListingsQuery = { sort };
  if (brand === "Other") query.excludeBrands = [...BRAND_PILL_EXCLUSIONS];
  else if (brand) query.brand = brand;
  if (model) query.model = model;
  const search = params.q?.trim() || undefined;
  if (search) query.search = search;
  if (sizeUs != null && Number.isFinite(sizeUs)) query.sizeUs = sizeUs;
  if (tier.length) query.tier = tier as Tier[];

  const [listings, platformConfig] = await Promise.all([
    getListings(query),
    getPlatformConfig(),
  ]);

  const featured =
    listings.length === 0
      ? null
      : [...listings].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const gridListings =
    featured != null && listings.length > 1
      ? listings.filter((l) => l.id !== featured.id)
      : listings;

  return (
    <div className="flex flex-col gap-4">
      {featured != null && <FeaturedCard listing={featured} />}

      {params.error && (
        <Banner tone="error" title="Couldn't do that">
          {params.error}
        </Banner>
      )}

      <MarketFilters
        initial={{
          brand,
          sort,
          q: search,
        }}
      />

      {listings.length === 0 ? (
        <EmptyState
          title="Nothing listed yet"
          description="No listings match these filters right now. New mints fill this grid as they unlock."
        />
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {gridListings.map((listing) => (
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