/**
 * components/market/ListingCard.tsx
 *
 * One live listing in the market grid: tier pill over the art, shoe name,
 * variant · size, colour-coded condition, big price with a below/above-fair
 * indication. The whole card links to the detail page.
 *
 * Buy affordance is hover-reveal on hover-capable devices (desktop): a
 * scrim + Buy Now pill fades in over the art. The pill is a real button —
 * clicking it opens the checkout popup instantly without leaving the grid.
 * Touch devices have no hover, so the overlay never renders there — tapping
 * the card opens the detail page, where the real checkout lives.
 *
 * Only real data is rendered: no wishlist hearts (no watchlist UI), no trend
 * deltas (no price history), no make-offer (not a real flow). "Fair" anchors
 * on fair_price_cents (condition-adjusted) with oracle_value_cents as the
 * fallback; with neither, the indication line is omitted, never invented.
 */
"use client";

import Link from "next/link";
import { useState } from "react";

import type { ListingSummary } from "@/lib/api/contract";
import { toSku } from "@/components/market/bridge";
import { CardArt } from "@/components/card/CardArt";
import { ConditionBadge } from "@/components/card/ConditionBadge";
import { FloatBar } from "@/components/card/FloatBar";
import { TierBadge } from "@/components/card/TierBadge";
import { formatMyr } from "@/components/card/format";
import { FiatAmount } from "@/components/market/Fiat";
import { Modal } from "@/components/market/Modal";
import { CheckoutModal } from "@/components/market/CheckoutModal";
import { fairIndicator } from "@/lib/market/pricing";
import {
  borderColorFor,
  conditionGradeBand,
  floatBand,
  publishedConditionLabel,
} from "@/lib/domain/rarity";

export interface ListingCardProps {
  listing: ListingSummary;
  /**
   * Mirrors getPlatformConfig().show_numeric_float. Defaults to false — the
   * live value today — so an unwired caller renders the safe named condition
   * badge instead of numeric float precision on a seller self-assessment.
   */
  showNumericFloat?: boolean;
}

/**
 * One live listing in the market grid. Below/above-fair math comes from
 * fairIndicator() in lib/market/pricing (server-safe, shared with the card
 * page and FeaturedCard).
 */
export function ListingCard({
  listing,
  showNumericFloat = false,
}: ListingCardProps) {
  const sku = toSku(listing.card.sku);
  const band = listing.card.condition_grade
    ? conditionGradeBand(listing.card.condition_grade)
    : floatBand(listing.card.float_value);
  const condition = publishedConditionLabel(
    listing.card.float_value,
    listing.card.condition_grade,
  );
  const percentile =
    listing.card.float_percentile == null
      ? null
      : listing.card.float_percentile.toFixed(2);

  const fair = fairIndicator(
    listing.price_cents,
    listing.fair_price_cents,
    listing.oracle_value_cents,
  );

  const detailHref = `/card/${listing.card_id}`;
  // Subtle full-card outline in the rarity colour (hex alpha: faint, not neon).
  const rarityColor = borderColorFor(
    listing.card.tier,
    listing.card.is_exceptional,
  );
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  return (
    <>
    <Link
      href={detailHref}
      aria-label={`${listing.card.sku.brand} ${listing.card.sku.model} ${listing.card.sku.colorway}, ${formatMyr(listing.price_cents)}`}
      className="group flex flex-col overflow-hidden rounded-2xl border-2 bg-[#141d18] transition-all hover:shadow-soft active:scale-[0.995]"
      style={{ borderColor: `${rarityColor}40` }}
    >
      {/* Inset art frame: the picture sits inside the card like a trading
          card window. */}
      <div className="px-2 pt-2">
        <div className="relative overflow-hidden rounded-xl">
          <CardArt sku={sku} aspect="aspect-[4/3]" />
          <div className="absolute left-2 top-2">
            <TierBadge
              tier={listing.card.tier}
              isExceptional={listing.card.is_exceptional}
            />
          </div>
          {/* Hover scrim: visual only. The pill inside is a real button —
              keyboard users reach it by tabbing (focus-visible reveals the
              scrim), mouse users by hovering. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 hidden justify-center bg-gradient-to-t from-black/70 via-black/20 to-transparent px-3 pb-3 pt-10 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-focus-visible:opacity-100 [@media(hover:hover)]:flex [@media(hover:hover)]:group-hover:opacity-100"
          >
            <button
              type="button"
              aria-label={`Buy ${listing.card.sku.brand} ${listing.card.sku.model} now`}
              onClick={(e) => {
                // The pill lives inside the card link: swallow the click so
                // the checkout popup opens instead of navigating away.
                e.preventDefault();
                e.stopPropagation();
                setCheckoutOpen(true);
              }}
              className="pointer-events-auto inline-flex items-center justify-center rounded-full bg-accent px-6 py-2 text-sm font-bold text-[#0B0B0B] transition hover:brightness-110"
            >
              Buy Now
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        <h3 className="truncate text-sm font-bold leading-snug">
          {listing.card.sku.brand} {listing.card.sku.model}
        </h3>
        <p className="truncate text-xs text-muted">
          {listing.card.sku.colorway} · US {listing.card.sku.size_us}
        </p>
        {showNumericFloat ? (
          <>
            <FloatBar float={listing.card.float_value} />
            <p className="text-xs text-muted">
              PCT {percentile ?? "—"}
            </p>
          </>
        ) : (
          <ConditionBadge
            band={band}
            label={condition}
            className="mt-0.5 w-fit"
          />
        )}

        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-base font-extrabold tracking-tight">
            <FiatAmount cents={listing.price_cents} />
          </span>
        </div>
        {fair != null && (
          <p
            className={
              fair.below
                ? "text-xs font-semibold text-accent"
                : "text-xs font-semibold text-[#E8B33A]"
            }
          >
            {fair.text}
          </p>
        )}
      </div>
    </Link>
    {checkoutOpen && (
      <Modal onClose={() => setCheckoutOpen(false)} closeLabel="Close checkout" panelClassName="max-w-2xl">
        <CheckoutModal
          listing={{
            id: listing.id,
            cardId: listing.card_id,
            priceCents: listing.price_cents,
            fairPriceCents: listing.fair_price_cents,
            oracleValueCents: listing.oracle_value_cents,
            status: listing.status,
            sellerId: listing.seller_id,
          }}
          onClose={() => setCheckoutOpen(false)}
        />
      </Modal>
    )}
    </>
  );
}
