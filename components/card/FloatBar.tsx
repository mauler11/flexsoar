/**
 * components/card/FloatBar.tsx
 *
 * Condition bar over the 0.000 (factory new) .. 1.000 (well worn) scale.
 * Segments follow FLOAT_BANDS; the marker sits at the float position; the
 * band label (FN/MW/FT/WW/BS) is read out above the marker and again in the
 * label row, where the active band is highlighted.
 *
 * Colour shifts green -> olive -> brown across the scale. The band label and
 * marker carry the meaning, so the bar is usable in greyscale too.
 */
import type { FloatValue } from "@/lib/db/types";
import { FLOAT_BANDS, floatBand, formatFloat } from "@/lib/domain/rarity";
import { cn } from "@/components/ui/cn";

/** Green -> olive -> brown, left to right. */
export const FLOAT_BAND_COLORS = {
  FN: "#41D987",
  MW: "#7CBF4E",
  FT: "#9BA24A",
  WW: "#A3793F",
  BS: "#8A5A3B",
} as const;

export interface FloatBarProps {
  float: FloatValue;
  /** Show the 0.000 + band label above the marker. Default true. */
  showValue?: boolean;
  className?: string;
}

export function FloatBar({ float, showValue = true, className }: FloatBarProps) {
  const band = floatBand(float);
  const pct = Math.min(100, Math.max(0, float * 100));
  return (
    <div className={cn("select-none font-mono", className)}>
      <div className="relative">
        {showValue && (
          <div className="relative h-4">
            <span
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] leading-4 tracking-tight"
              style={{ left: `${pct}%`, color: FLOAT_BAND_COLORS[band] }}
            >
              {formatFloat(float)} {band}
            </span>
          </div>
        )}
        <div className="relative h-3 overflow-hidden border border-line bg-overlay">
          {FLOAT_BANDS.map((b) => (
            <span
              key={b.band}
              className="absolute inset-y-0"
              style={{
                left: `${b.min * 100}%`,
                width: `${(b.max - b.min) * 100}%`,
                background: FLOAT_BAND_COLORS[b.band],
              }}
            />
          ))}
          <span
            aria-hidden
            className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-foreground mix-blend-difference"
            style={{ left: `${pct}%` }}
          />
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[9px] tracking-tight text-muted">
        {FLOAT_BANDS.map((b) => (
          <span
            key={b.band}
            className={cn(b.band === band && "font-bold")}
            style={b.band === band ? { color: FLOAT_BAND_COLORS[b.band] } : undefined}
          >
            {b.band}
          </span>
        ))}
      </div>
    </div>
  );
}
