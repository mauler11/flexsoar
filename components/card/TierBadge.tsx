/**
 * components/card/TierBadge.tsx
 *
 * The tier name in its frame colour. Exceptional keeps the tier name (tier
 * still drives everything else) but renders red with a "1 OF 1" chip.
 */
import type { Tier } from "@/lib/db/types";
import { borderColorFor, tierName } from "@/lib/domain/rarity";
import { cn } from "@/components/ui/cn";

export interface TierBadgeProps {
  tier: Tier;
  isExceptional?: boolean;
  className?: string;
}

export function TierBadge({
  tier,
  isExceptional = false,
  className,
}: TierBadgeProps) {
  const color = borderColorFor(tier, isExceptional);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-tight",
        isExceptional && "font-bold",
        className,
      )}
      style={{
        borderColor: color,
        color,
        background: "rgba(0, 0, 0, 0.55)",
      }}
    >
      {isExceptional && (
        <span aria-hidden className="h-1.5 w-1.5 bg-[#FF4444]" />
      )}
      {isExceptional ? `1 OF 1 · ${tierName(tier)}` : tierName(tier)}
    </span>
  );
}
