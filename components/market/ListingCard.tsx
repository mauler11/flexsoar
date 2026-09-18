/**
 * components/market/ListingCard.tsx
 *
 * One live listing in the market grid: tier pill over the art, shoe name,
 * variant · size, colour-coded condition, big price with a below/above-fair
 * indication. The whole card links to the detail page.
 *
 * Buy affordance is hover-reveal on hover-capable devices (desktop): a
 * scrim + Buy Now pill fades in over the art. Touch devices have no hover,
 * so the overlay never renders there — tapping the card opens the detail
 * page, where the real checkout lives. The pill is pointer-events-none and
 * aria-hidden: pure visual affordance, never a separate target (nested
 * interactives inside a link would break keyboard/screen-reader users).
 *
 * Only real data is rendered: no wishlist hearts (no watchlist UI), no trend
 * deltas (no price history), no make-offer (not a real flow). "Fair" anchors
 * on fair_price_cents (condition-adjusted) with oracle_value_cents as the
 * fallback; with neither, the indication line is omitted, never invented.
 */
import Link from "next/link";

import type { ListingSummary } from "@/lib/api/contract";
import { toSku } from "@/components/market/bridge";
import { CardArt } from "@/components/card/CardArt";
import { ConditionBadge } from "@/components/card/ConditionBadge";
import { FloatBar } from "@/components/card/FloatBar";
import { RarityBand } from "@/components/card/RarityBand";
import { TierBadge } from "@/components/card/TierBadge";
import { formatMyr } from "@/components/card/format";
import { FiatAmount } from "@/components/market/Fiat";
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
 * Below/above-fair indication. Anchors on fair_price_cents
 * (condition-adjusted) with oracle_value_cents as fallback; null when
 * neither exists or the price is exactly fair — never invented.
 */
export function fairIndicator(
  priceCents: number,
  fairPriceCents: number | null,
  oracleValueCents: number | null,
): { text: string; below: boolean } | null {
  const anchor = fairPriceCents ?? oracleValueCents ?? null;
  if (anchor == null || anchor <= 0) return null;
  const pct = Math.round(((priceCents - anchor) / anchor) * 100);
  if (pct === 0) return null;
  return {
    text: `${Math.abs(pct)}% ${pct < 0 ? "below" : "above"} fair`,
    below: pct < 0,
  };
}

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

  return (
    <Link
      href={detailHref}
      aria-label={`${listing.card.sku.brand} ${listing.card.sku.model} ${listing.card.sku.colorway}, ${formatMyr(listing.price_cents)}`}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-raised transition-all hover:shadow-soft active:scale-[0.995]"
      style={{ borderColor: `${rarityColor}40` }}
    >
      {/* Inset art frame: the picture sits inside the card like a trading
          card window, with the rarity band across the top of the frame. */}
      <div className="px-2 pt-2">
        <div className="relative overflow-hidden rounded-xl">
          <CardArt sku={sku} aspect="aspect-[4/3]" />
          <RarityBand
            tier={listing.card.tier}
            isExceptional={listing.card.is_exceptional}
          />
          <div className="absolute left-2 top-2">
            <TierBadge
              tier={listing.card.tier}
              isExceptional={listing.card.is_exceptional}
            />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 hidden justify-center bg-gradient-to-t from-black/70 via-black/20 to-transparent px-3 pb-3 pt-10 opacity-0 transition-opacity duration-150 group-focus-visible:opacity-100 [@media(hover:hover)]:flex [@media(hover:hover)]:group-hover:opacity-100"
          >
            <span className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-2 text-sm font-bold text-[#0B0B0B]">
              Buy Now
            </span>
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
  );
}
