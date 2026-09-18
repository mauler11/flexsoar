/**
 * components/card/RarityBand.tsx
 *
 * The always-visible rarity signal: a tier-coloured band across the top of
 * the art plus a faint full ring in the same colour. Renders in every
 * context — collapsed grid tiles (market, profile, dashboard) and anywhere
 * else art appears — so rarity never depends on an expanded view.
 *
 * Colour comes from the same tier bands as TierBadge (borderColorFor), so
 * the two can never disagree; exceptional stays red. Decorative only
 * (aria-hidden): the TierBadge pill beside it already announces the tier.
 */
import { borderColorFor } from "@/lib/domain/rarity";
import type { Tier } from "@/lib/db/types";

export interface RarityBandProps {
  tier: Tier;
  isExceptional?: boolean;
}

export function RarityBand({ tier, isExceptional = false }: RarityBandProps) {
  const color = borderColorFor(tier, isExceptional);
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5"
        style={{ background: color, boxShadow: `0 0 8px ${color}66` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{ boxShadow: `inset 0 0 0 1px ${color}33` }}
      />
    </>
  );
}
