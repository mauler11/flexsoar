/**
 * components/card/CardDetail.tsx
 *
 * Hero card: full-width rarity frame with the sprite at scale, condition,
 * mint number, ownership status, and the price in USD — the marketplace's
 * unit of account (AGENT_RULES.md §6). No ringgit conversion. Oracle value
 * is always shown beside an ask — never hidden.
 *
 * Pure props only. No fetching, no state.
 */
import type { Card, Listing, Sku } from "@/lib/db/types";
import { cn } from "@/components/ui/cn";
import { CardArt } from "./CardArt";
import { CardFrame } from "./CardFrame";
import { ConditionBadge } from "./ConditionBadge";
import { FloatBar } from "./FloatBar";
import { TierBadge } from "./TierBadge";
import { formatUsd } from "./format";
import { displayPriceCents } from "./value";
import { conditionGradeBand, floatBand, publishedConditionLabel } from "@/lib/domain/rarity";

export interface CardDetailProps {
  card: Card;
  sku: Sku;
  /** Ask price when listed, else omitted to use the oracle value. */
  priceCents?: number | null;
  listing?: Listing | null;
  className?: string;
  /** Mirrors platform_config.show_numeric_float — see CardTile's doc comment. */
  showNumericFloat?: boolean;
}

export function CardDetail({
  card,
  sku,
  priceCents,
  listing,
  className,
  showNumericFloat = false,
}: CardDetailProps) {
  const value = displayPriceCents(card, sku, priceCents);
  const percentile =
    card.float_percentile == null ? null : card.float_percentile.toFixed(2);
  const band = card.condition_grade
    ? conditionGradeBand(card.condition_grade)
    : floatBand(card.float_value);
  const conditionLabel = publishedConditionLabel(card.float_value, card.condition_grade);

  const cell = "flex flex-col gap-0.5";
  const label = "text-[9px] uppercase tracking-tight text-muted";

  return (
    <CardFrame
      tier={card.tier}
      isExceptional={card.is_exceptional}
      className={cn("w-full", className)}
    >
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="flex items-center justify-center">
          <CardArt sku={sku} className="w-full sm:w-auto sm:min-w-[280px]" px={8} />
        </div>

        <div className="flex flex-col gap-3 font-mono">
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={card.tier} isExceptional={card.is_exceptional} />
            <span className="border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-tight text-muted">
              {card.status}
            </span>
            {listing && (
              <span className="border border-accent/60 px-1.5 py-0.5 text-[10px] uppercase tracking-tight text-accent">
                {listing.status}
              </span>
            )}
          </div>

          <div>
            <h1 className="text-lg font-bold leading-tight tracking-tight">
              {sku.brand} {sku.model}
            </h1>
            <p className="mt-0.5 text-[11px] tracking-tight text-muted">
              {sku.colorway} · US {sku.size_us}
            </p>
          </div>

          {card.is_exceptional && card.exceptional_reason && (
            <div className="border-l-2 border-[#FF4444] bg-[#FF4444]/10 px-2 py-1.5 text-[10px] leading-snug tracking-tight text-[#FF4444]">
              {card.exceptional_reason}
            </div>
          )}

          {showNumericFloat ? (
            <FloatBar float={card.float_value} className="mt-1" />
          ) : (
            <ConditionBadge band={band} label={conditionLabel} className="mt-1 w-fit" />
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] tracking-tight">
            <div className={cell}>
              <dt className={label}>Mint</dt>
              <dd>
                #{String(card.mint_number).padStart(2, "0")}
                {sku.mint_cap != null ? ` / ${sku.mint_cap}` : ""}
              </dd>
            </div>
            {showNumericFloat && (
              <div className={cell}>
                <dt className={label} title="Float percentile within the SKU — 0 is the lowest float">
                  Float pct
                </dt>
                <dd>{percentile ?? "—"}</dd>
              </div>
            )}
            <div className={cell}>
              <dt className={label}>Size</dt>
              <dd>US {sku.size_us}</dd>
            </div>
            <div className={cell}>
              <dt className={label}>Minted</dt>
              <dd>{card.minted_at.slice(0, 10)}</dd>
            </div>
          </dl>

          <div className="mt-auto border-t border-line pt-3">
            {value != null && (
              <div className="text-xl font-bold tracking-tight">
                {formatUsd(value)}
              </div>
            )}
            {listing && listing.oracle_value_cents != null && (
              <div className="mt-1 text-[10px] tracking-tight text-muted">
                Oracle fair value {formatUsd(listing.oracle_value_cents)}
              </div>
            )}
          </div>
        </div>
      </div>
    </CardFrame>
  );
}
