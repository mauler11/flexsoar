/**
 * components/card/ConditionBadge.tsx
 *
 * The published condition: the named grade only (Factory New .. Battle-
 * Scarred), no numeric float, no percentile. This is what renders while
 * `platform_config.show_numeric_float` is false — at launch every float is a
 * seller's self-assessment, and three decimals of published precision on a
 * guess is indefensible in a dispute. `FloatBar` (the numeric gradient +
 * value) only renders once that flag flips true.
 */
import type { FloatBand } from "@/lib/domain/rarity";
import { FLOAT_BAND_COLORS } from "./FloatBar";
import { cn } from "@/components/ui/cn";

export interface ConditionBadgeProps {
  band: FloatBand;
  label: string;
  className?: string;
}

export function ConditionBadge({ band, label, className }: ConditionBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-tight",
        className,
      )}
      style={{ borderColor: FLOAT_BAND_COLORS[band], color: FLOAT_BAND_COLORS[band] }}
    >
      {label}
    </span>
  );
}
