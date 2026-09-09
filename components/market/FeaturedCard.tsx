/**
 * components/market/FeaturedCard.tsx
 *
 * The market hero: the most recently listed shoe, presented like the
 * concept art — FEATURED badge, big shoe name, variant line, below/above
 * fair indication, a View details action, and the card art staged on the
 * right. Everything rendered is real listing data (see ListingCard's doc
 * comment for what is deliberately never invented).
 */
import Link from "next/link";

import type { ListingSummary } from "@/lib/api/contract";
import { toSku } from "@/components/market/bridge";
import { CardArt } from "@/components/card/CardArt";
import { TierBadge } from "@/components/card/TierBadge";
import { Button } from "@/components/ui/Button";
import { fairIndicator } from "@/components/market/ListingCard";

export interface FeaturedCardProps {
  listing: ListingSummary;
}

export function FeaturedCard({ listing }: FeaturedCardProps) {
  const sku = toSku(listing.card.sku);
  const fair = fairIndicator(
    listing.price_cents,
    listing.fair_price_cents,
    listing.oracle_value_cents,
  );

  return (
    <section
      aria-label="Featured listing"
      className="grid overflow-hidden rounded-2xl border border-line bg-raised sm:grid-cols-2"
    >
      <div className="flex flex-col items-start justify-center gap-2 p-5 sm:p-8">
        <span className="rounded-md border border-accent/60 px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-accent">
          Featured
        </span>
        <h2 className="text-2xl font-extrabold uppercase leading-tight tracking-tight sm:text-4xl">
          {listing.card.sku.brand} {listing.card.sku.model}
        </h2>
        <p className="text-sm text-muted sm:text-base">
          {listing.card.sku.colorway} · US {listing.card.sku.size_us}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <TierBadge
            tier={listing.card.tier}
            isExceptional={listing.card.is_exceptional}
          />
          {fair != null && (
            <span
              className={
                fair.below
                  ? "text-sm font-semibold text-accent"
                  : "text-sm font-semibold text-[#E8B33A]"
              }
            >
              {fair.text}
            </span>
          )}
        </div>
        <Button
          href={`/card/${listing.card_id}`}
          variant="secondary"
          size="md"
          className="mt-3"
        >
          View details →
        </Button>
      </div>
      <div className="relative bg-[radial-gradient(ellipse_at_center,rgba(53,240,122,0.08),transparent_70%)]">
        <CardArt sku={sku} aspect="aspect-[16/10] sm:aspect-auto sm:h-full sm:min-h-72" px={8} />
      </div>
    </section>
  );
}
