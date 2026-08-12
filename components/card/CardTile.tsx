/**
 * components/card/CardTile.tsx
 *
 * Compact card for grids (~180px). Shows the sprite in its rarity frame,
 * float, percentile badge, mint number, and price in FSC with the ringgit
 * conversion beneath it.
 *
 * Pure props only. `priceCents` defaults to the card's oracle value
 * (fn_card_value_cents mirror); pass a listing's price to show the ask.
 */
import type { Card, Listing, Sku } from "@/lib/db/types";
import { cn } from "@/components/ui/cn";
import { CardArt } from "./CardArt";
import { CardFrame } from "./CardFrame";
import { FloatBar } from "./FloatBar";
import { TierBadge } from "./TierBadge";
import { formatFsc, formatMyr } from "./format";
import { displayPriceCents } from "./value";

export interface CardTileProps {
  card: Card;
  sku: Sku;
  /** Ask price when listed, else omitted to use the oracle value. */
  priceCents?: number | null;
  listing?: Listing | null;
  href?: string;
  className?: string;
}

export function CardTile({
  card,
  sku,
  priceCents,
  listing,
  href,
  className,
}: CardTileProps) {
  const value = displayPriceCents(card, sku, priceCents);
  const percentile =
    card.float_percentile == null ? null : card.float_percentile.toFixed(2);

  const body = (
    <CardFrame
      tier={card.tier}
      isExceptional={card.is_exceptional}
      className={cn("w-[180px] bg-raised", href && "transition-transform hover:-translate-y-0.5")}
    >
      <div className="flex flex-col gap-2 p-2">
        <CardArt sku={sku} />

        <div className="flex items-center justify-between gap-2">
          <TierBadge tier={card.tier} isExceptional={card.is_exceptional} />
          {listing && (
            <span className="border border-accent/60 px-1 py-0.5 font-mono text-[8px] uppercase tracking-tight text-accent">
              Listed
            </span>
          )}
        </div>

        <div className="font-mono text-[10px] leading-tight uppercase tracking-tight text-muted">
          {sku.brand} {sku.model}
        </div>
        <div className="font-mono text-[11px] leading-tight tracking-tight text-foreground">
          {sku.colorway}
        </div>

        <FloatBar float={card.float_value} className="mt-1" />

        <div className="flex items-center justify-between font-mono text-[9px] tracking-tight text-muted">
          <span title="Float percentile within the SKU — 0 is the lowest float">
            PCT {percentile ?? "—"}
          </span>
          <span>
            MINT #
            {String(card.mint_number).padStart(2, "0")}
            {sku.mint_cap != null ? ` / ${sku.mint_cap}` : ""}
          </span>
        </div>

        <div className="mt-1 border-t border-line pt-2">
          {value != null ? (
            <>
              <div className="font-mono text-sm font-bold tracking-tight text-foreground">
                {formatFsc(value)}
              </div>
              <div className="font-mono text-[10px] tracking-tight text-muted">
                {formatMyr(value)}
              </div>
            </>
          ) : (
            <div className="font-mono text-sm font-bold tracking-tight text-muted">
              —
            </div>
          )}
        </div>
      </div>
    </CardFrame>
  );

  if (href) {
    return (
      <a href={href} className={cn("block", className)} aria-label={`${sku.brand} ${sku.model} card`}>
        {body}
      </a>
    );
  }
  return <div className={className}>{body}</div>;
}
