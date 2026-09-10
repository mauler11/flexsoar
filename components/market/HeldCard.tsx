"use client";

/**
 * components/market/HeldCard.tsx
 *
 * A held shoe in the dashboard, dressed exactly like the market grid:
 * art, tier pill, name, variant · size, colour-coded condition, and a
 * status footer. The whole card links to its detail page. Below it sits
 * the per-shoe profile toggle — green Shown In Profile, grey when hidden.
 */

import Link from "next/link";
import type { CardSummary } from "@/lib/api/contract";
import { toSku } from "@/components/market/bridge";
import { CardArt } from "@/components/card/CardArt";
import { ConditionBadge } from "@/components/card/ConditionBadge";
import { TierBadge } from "@/components/card/TierBadge";
import {
  conditionGradeBand,
  floatBand,
  publishedConditionLabel,
} from "@/lib/domain/rarity";
import { toggleCardVisibilityAction } from "@/app/(market)/actions";
import { cn } from "@/components/ui/cn";

export interface HeldCardProps {
  card: CardSummary;
  statusLabel: string;
  shownInProfile: boolean;
}

export function HeldCard({ card, statusLabel, shownInProfile }: HeldCardProps) {
  const sku = toSku(card.sku);
  const band = card.condition_grade
    ? conditionGradeBand(card.condition_grade)
    : floatBand(card.float_value);

  return (
    <div className="flex flex-col">
      <Link
        href={`/card/${card.id}`}
        aria-label={`${card.sku.brand} ${card.sku.model} ${card.sku.colorway}`}
        className="group flex flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-raised transition-colors hover:border-line-strong hover:shadow-soft"
      >
        <div className="relative">
          <CardArt sku={sku} aspect="aspect-[4/3]" />
          <div className="absolute left-2 top-2">
            <TierBadge tier={card.tier} isExceptional={card.is_exceptional} />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 p-2.5">
          <h3 className="truncate text-sm font-bold leading-snug">
            {card.sku.brand} {card.sku.model}
          </h3>
          <p className="truncate text-xs text-muted">
            {card.sku.colorway} · US {card.sku.size_us}
          </p>
          <ConditionBadge
            band={band}
            label={publishedConditionLabel(card.float_value, card.condition_grade)}
            className="mt-0.5 w-fit"
          />
          <p className="mt-0.5 text-xs text-muted">{statusLabel}</p>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => {
          void toggleCardVisibilityAction(card.id, !shownInProfile);
        }}
        aria-pressed={shownInProfile}
        className={cn(
          "mt-1.5 rounded-lg border px-2 py-1 text-[11px] font-bold uppercase tracking-wide transition",
          shownInProfile
            ? "border-accent/60 text-accent hover:bg-accent/10"
            : "border-line-strong text-muted hover:border-muted hover:text-foreground",
        )}
      >
        {shownInProfile ? "Shown in Profile" : "Not Shown In Profile"}
      </button>
    </div>
  );
}
