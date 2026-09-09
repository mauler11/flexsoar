/**
 * components/market/ListingCard.tsx
 *
 * One live listing in the market grid: tier pill over the art, shoe name,
 * variant · size, colour-coded condition, big price with a below/above-fair
 * indication, and a Buy now call-to-action. The whole card links to the
 * detail page — the button is the visual affordance, not a separate target.
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
import { TierBadge } from "@/components/card/TierBadge";
import { formatMyr } from "@/components/card/format";
import {
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

  const fairAnchor =
    listing.fair_price_cents ?? listing.oracle_value_cents ?? null;
  const fairDeltaPct =
    fairAnchor != null && fairAnchor > 0
      ? Math.round(
          ((listing.price_cents - fairAnchor) / fairAnchor) * 100,
        )
      : null;

  const detailHref = `/card/${listing.card_id}`;

  return (
    <Link
      href={detailHref}
      aria-label={`${listing.card.sku.brand} ${listing.card.sku.model} ${listing.card.sku.colorway}, ${formatMyr(listing.price_cents)}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-raised transition-colors hover:border-line-strong hover:shadow-soft"
    >
      <div className="relative">
        <CardArt sku={sku} aspect="aspect-[4/3]" />
        <div className="absolute left-2 top-2">
          <TierBadge
            tier={listing.card.tier}
            isExceptional={listing.card.is_exceptional}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="truncate text-[15px] font-bold leading-snug">
          {listing.card.sku.brand} {listing.card.sku.model}
        </h3>
        <p className="truncate text-[13px] text-muted">
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

        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-lg font-extrabold tracking-tight">
            {formatMyr(listing.price_cents)}
          </span>
        </div>
        {fairDeltaPct != null && fairDeltaPct !== 0 && (
          <p
            className={
              fairDeltaPct < 0
                ? "text-xs font-semibold text-accent"
                : "text-xs font-semibold text-[#E8B33A]"
            }
          >
            {Math.abs(fairDeltaPct)}% {fairDeltaPct < 0 ? "below" : "above"}{" "}
            fair
          </p>
        )}

        <span className="mt-2 inline-flex items-center justify-center rounded-lg bg-accent px-3 py-2 text-sm font-bold text-[#0B0B0B] transition group-hover:brightness-110">
          Buy now
        </span>
      </div>
    </Link>
  );
}
