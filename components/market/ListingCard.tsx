/**
 * components/market/ListingCard.tsx
 *
 * One live listing in the market grid, in the marketplace's card language:
 * rounded panel, tier pill over the art, name/colorway/size, big price with
 * the oracle value beside it, and a single Buy now action into the card
 * page (the buy itself — cash/FSC legs — lives in BuyPanel there).
 *
 * No wishlist hearts (no watchlist UI exists), no trend deltas (no price
 * history exists), no make-offer (not a real flow). Everything rendered
 * here comes from the ListingSummary.
 */
import Link from "next/link";

import type { ListingSummary } from "@/lib/api/contract";
import { toCard, toSku } from "@/components/market/bridge";
import { CardArt } from "@/components/card/CardArt";
import { FloatBar } from "@/components/card/FloatBar";
import { TierBadge } from "@/components/card/TierBadge";
import { formatMyr } from "@/components/card/format";
import { publishedConditionLabel } from "@/lib/domain/rarity";

export interface ListingCardProps {
  listing: ListingSummary;
  /**
   * Mirrors getPlatformConfig().show_numeric_float. Defaults to false — the
   * live value today — so an unwired caller renders the safe named condition
   * badge instead of numeric float precision on a seller self-assessment.
   */
  showNumericFloat?: boolean;
}

export function ListingCard({ listing, showNumericFloat = false }: ListingCardProps) {
  const card = toCard(listing.card);
  const sku = toSku(listing.card.sku);
  const condition = publishedConditionLabel(
    listing.card.float_value,
    listing.card.condition_grade,
  );
  const percentile =
    listing.card.float_percentile == null
      ? null
      : listing.card.float_percentile.toFixed(2);

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-raised transition-colors hover:border-line-strong hover:shadow-soft">
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
          {listing.card.sku.colorway}
        </p>
        {showNumericFloat ? (
          <>
            <FloatBar float={listing.card.float_value} />
            <p className="text-xs text-muted">
              US {listing.card.sku.size_us} · PCT {percentile ?? "—"} · Mint #
              {String(card.mint_number).padStart(2, "0")}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted">
            US {listing.card.sku.size_us} · {condition} · Mint #
            {String(card.mint_number).padStart(2, "0")}
          </p>
        )}

        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-lg font-extrabold tracking-tight">
            {formatMyr(listing.price_cents)}
          </span>
          {listing.oracle_value_cents != null && (
            <span
              className="truncate text-xs text-muted"
              title="Oracle fair value"
            >
              Oracle {formatMyr(listing.oracle_value_cents)}
            </span>
          )}
        </div>

        <Link
          href={`/card/${listing.card_id}`}
          aria-label={`Buy ${listing.card.sku.brand} ${listing.card.sku.model} for ${formatMyr(listing.price_cents)}`}
          className="mt-2 inline-flex items-center justify-center rounded-xl bg-accent px-3 py-2 text-sm font-bold text-[#0B0B0B] transition hover:brightness-110"
        >
          Buy now
        </Link>
      </div>
    </article>
  );
}
