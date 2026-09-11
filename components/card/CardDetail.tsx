/**
 * components/card/CardDetail.tsx
 *
 * Hero card: full-width rarity frame with the photo carousel at scale, condition,
 * mint number, ownership status, and the price in MYR — the marketplace's
 * unit of account (AGENT_RULES.md §6). No ringgit conversion. Oracle value
 * is always shown beside an ask — never hidden.
 *
 * Pure props only. No fetching, no state.
 */
"use client";

import type { Card, Listing, Sku } from "@/lib/db/types";
import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { CardArt } from "./CardArt";
import { CardFrame } from "./CardFrame";
import { ConditionBadge } from "./ConditionBadge";
import { FloatBar } from "./FloatBar";
import { TierBadge } from "./TierBadge";
import { PhotoCarousel } from "./PhotoCarousel";
import { ImageZoom } from "./ImageZoom";
import { formatMyr } from "./format";
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
  /** Photos from the item for the carousel */
  photos?: string[];
  /** True when the physical pair sits in the warehouse — badged Vaulted. */
  vaulted?: boolean;
}

export function CardDetail({
  card,
  sku,
  priceCents,
  listing,
  className,
  showNumericFloat = false,
  photos = [],
  vaulted = false,
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

  // Normalize product name to Title Case
  const productName = `${sku.brand} ${sku.model}`.replace(
    /\b\w/g,
    (c) => c.toUpperCase()
  );

  // Determine if SKU has art (uploaded PNG or sprite)
  const hasArt = !!sku.art_url || !!sku.sprite_key;

  // Build images array for zoom: art first, then photos
  const zoomImages = [
    ...(sku.art_url ? [sku.art_url] : []),
    ...photos,
  ].filter(Boolean);

  // Zoom modal state
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);

  const openZoom = (index: number) => {
    setZoomIndex(index);
    setZoomOpen(true);
  };

  return (
    <CardFrame
      tier={card.tier}
      isExceptional={card.is_exceptional}
      plain
      className={cn("w-full overflow-hidden rounded-2xl bg-raised", className)}
    >
      <div className="grid gap-6 p-5 sm:grid-cols-2">
        <div className="flex items-center justify-center">
          {zoomImages.length > 0 ? (
            <>
              <PhotoCarousel
                photos={zoomImages}
                alt={`${productName} ${sku.colorway}`}
                className="w-full sm:w-auto sm:min-w-[320px]"
                onImageClick={openZoom}
              />
              <ImageZoom
                images={zoomImages}
                isOpen={zoomOpen}
                onClose={() => setZoomOpen(false)}
                initialIndex={zoomIndex}
                alt={`${productName} ${sku.colorway}`}
              />
            </>
          ) : (
            <CardArt sku={sku} className="w-full sm:w-auto sm:min-w-[320px]" px={8} />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={card.tier} isExceptional={card.is_exceptional} />
            {vaulted && (
              <span className="rounded-md border border-accent/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                Vaulted
              </span>
            )}
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {card.status}
            </span>
            {listing && (
              <span className="rounded-full border border-accent/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                {listing.status}
              </span>
            )}
          </div>

          <div>
            <h1 className="text-2xl font-extrabold leading-tight tracking-tight">
              {productName}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {sku.colorway} · US {sku.size_us}
            </p>
          </div>

          {card.is_exceptional && card.exceptional_reason && (
            <div className="rounded-xl border-l-2 border-[#FF4444] bg-[#FF4444]/10 px-3 py-2 text-xs leading-snug text-[#FF4444]">
              {card.exceptional_reason}
            </div>
          )}

          {showNumericFloat ? (
            <FloatBar float={card.float_value} className="mt-2" />
          ) : (
            <ConditionBadge band={band} label={conditionLabel} className="mt-2 w-fit" />
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className={cell}>
              <dt className={label}>Mint</dt>
              <dd className="text-foreground/90">
                #{String(card.mint_number).padStart(2, "0")}
                {sku.mint_cap != null ? ` / ${sku.mint_cap}` : ""}
              </dd>
            </div>
            {showNumericFloat && (
              <div className={cell}>
                <dt className={label} title="Float percentile within the SKU — 0 is the lowest float">
                  Float pct
                </dt>
                <dd className="text-foreground/90">{percentile ?? "—"}</dd>
              </div>
            )}
            <div className={cell}>
              <dt className={label}>Size</dt>
              <dd className="text-foreground/90">US {sku.size_us}</dd>
            </div>
            <div className={cell}>
              <dt className={label}>Minted</dt>
              <dd className="text-foreground/90">{card.minted_at.slice(0, 10)}</dd>
            </div>
          </dl>

          <div className="mt-auto border-t border-line pt-4">
            {value != null && (
              <div className="text-3xl font-extrabold tracking-tight text-foreground">
                {formatMyr(value)}
              </div>
            )}
            {listing && listing.oracle_value_cents != null && (
              <div className="mt-1 text-sm text-muted">
                Fair Price {formatMyr(listing.oracle_value_cents)}
              </div>
            )}
          </div>
        </div>
      </div>
    </CardFrame>
  );
}