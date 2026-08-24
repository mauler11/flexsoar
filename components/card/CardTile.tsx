/**
 * components/card/CardTile.tsx
 *
 * Compact card for grids (~180px). Shows the sprite in its rarity frame,
 * condition, mint number, and price in USD — the marketplace's unit of
 * account (AGENT_RULES.md §6). No ringgit conversion; USD is the one
 * comparable number a buyer judges a trade against.
 *
 * Pure props only. `priceCents` defaults to the card's oracle value
 * (fn_card_value_cents mirror); pass a listing's price to show the ask.
 */
import type { Card, CardStatus, Listing, Sku } from "@/lib/db/types";
import { cn } from "@/components/ui/cn";
import { Badge } from "@/components/ui/Badge";
import { CardArt } from "./CardArt";
import { CardFrame } from "./CardFrame";
import { ConditionBadge } from "./ConditionBadge";
import { FloatBar } from "./FloatBar";
import { TierBadge } from "./TierBadge";
import { formatUsd } from "./format";
import { displayPriceCents } from "./value";
import { conditionGradeBand, floatBand, publishedConditionLabel } from "@/lib/domain/rarity";

/**
 * 023a_card_status_pending_vault.sql added 'pending_vault' to the live
 * card_status enum; CardStatus in lib/db/types.ts (track/data's lane) hasn't
 * caught up yet — the same gap BuyPanel and the card detail page hit (see
 * docs/handoff/market.md). A plain `card.status === "pending_vault"` fails
 * TS2367 even past a widened variable annotation; routing the comparison
 * through a typed parameter sidesteps it with no cast.
 */
type CardStatusWithVault = CardStatus | "pending_vault";
function isPendingVault(status: CardStatusWithVault): boolean {
  return status === "pending_vault";
}

export interface CardTileProps {
  card: Card;
  sku: Sku;
  /** Ask price when listed, else omitted to use the oracle value. */
  priceCents?: number | null;
  listing?: Listing | null;
  href?: string;
  className?: string;
  /**
   * Mirrors platform_config.show_numeric_float (getPlatformConfig()).
   * Defaults to false — the live value today — so a caller that hasn't
   * wired the real config through still renders the safe, correct state:
   * a named condition badge only, no numeric float, no percentile. Every
   * float is a seller's self-assessment at launch; three decimals of
   * published precision on a guess is indefensible in a dispute.
   */
  showNumericFloat?: boolean;
}

export function CardTile({
  card,
  sku,
  priceCents,
  listing,
  href,
  className,
  showNumericFloat = false,
}: CardTileProps) {
  const value = displayPriceCents(card, sku, priceCents);
  const percentile =
    card.float_percentile == null ? null : card.float_percentile.toFixed(2);
  const frozen = isPendingVault(card.status);
  const band = card.condition_grade
    ? conditionGradeBand(card.condition_grade)
    : floatBand(card.float_value);
  const conditionLabel = publishedConditionLabel(card.float_value, card.condition_grade);

  const body = (
    <CardFrame
      tier={card.tier}
      isExceptional={card.is_exceptional}
      className={cn(
        "w-[180px] bg-raised",
        href && !frozen && "transition-transform hover:-translate-y-0.5",
      )}
    >
      <div className="flex flex-col gap-2 p-2">
        <div className="relative">
          <CardArt sku={sku} className={cn(frozen && "opacity-40 grayscale")} />
          {frozen && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-overlay/70">
              <Badge tone="info">Vault Pending</Badge>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <TierBadge tier={card.tier} isExceptional={card.is_exceptional} />
          {frozen ? (
            <span className="border border-[#3B9EFF]/60 px-1 py-0.5 font-mono text-[8px] uppercase tracking-tight text-[#3B9EFF]">
              Frozen
            </span>
          ) : (
            listing && (
              <span className="border border-accent/60 px-1 py-0.5 font-mono text-[8px] uppercase tracking-tight text-accent">
                Listed
              </span>
            )
          )}
        </div>

        <div className="font-mono text-[10px] leading-tight uppercase tracking-tight text-muted">
          {sku.brand} {sku.model}
        </div>
        <div className="font-mono text-[11px] leading-tight tracking-tight text-foreground">
          {sku.colorway}
        </div>

        {showNumericFloat ? (
          <>
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
          </>
        ) : (
          <div className="mt-1 flex items-center justify-between font-mono text-[9px] tracking-tight text-muted">
            <ConditionBadge band={band} label={conditionLabel} />
            <span>
              MINT #
              {String(card.mint_number).padStart(2, "0")}
              {sku.mint_cap != null ? ` / ${sku.mint_cap}` : ""}
            </span>
          </div>
        )}

        <div className="mt-1 border-t border-line pt-2">
          {value != null ? (
            <div className="font-mono text-sm font-bold tracking-tight text-foreground">
              {formatUsd(value)}
            </div>
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
