/**
 * components/market/intake/SelfDeclaredCondition.tsx
 *
 * The live "your condition" preview inside the wizard. The task's hard rule:
 * a self-declared float must NEVER render like a FlexSoar-graded float. So
 * this is NOT the FloatBar / CardFrame used on minted cards — amber, dashed,
 * marked SELF-DECLARED, with a plain-language disclaimer on every render.
 *
 * Pure props: the computed float and, optionally, the per-component scores.
 */
import { formatFloat, floatBand, floatBandSpec } from "@/lib/domain/rarity";
import type { GradeComponents } from "@/lib/db/grading";
import { gradeFloatFromComponents } from "@/lib/db/grading";
import { SELF_DECLARED_DISCLAIMER } from "@/components/market/intake/intake-config";

export interface SelfDeclaredConditionProps {
  components: GradeComponents | null;
}

const ACCENT = "#E8B33A";

/** A simplified band strip, visually nothing like FloatBar. */
function BandStrip({ float }: { float: number }) {
  const pct = Math.min(100, Math.max(0, float * 100));
  return (
    <div className="relative h-2.5 overflow-hidden border border-dashed border-[#E8B33A]/50 bg-black/30">
      <span
        aria-hidden
        className="absolute inset-y-0 bg-[#E8B33A]/25"
        style={{ left: 0, width: `${pct}%` }}
      />
      <span
        aria-hidden
        className="absolute inset-y-0 w-[2px] bg-[#E8B33A]"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

export function SelfDeclaredCondition({
  components,
}: SelfDeclaredConditionProps) {
  if (!components) {
    return (
      <div className="border border-dashed border-[#E8B33A]/50 bg-[#E8B33A]/5 px-3 py-2 font-mono text-[10px] tracking-tight text-muted">
        Your condition preview appears here as you answer the six questions.
      </div>
    );
  }

  const float = gradeFloatFromComponents(components);
  const band = floatBand(float);
  const bandSpec = floatBandSpec(band);

  return (
    <div className="flex flex-col gap-2 border border-dashed border-[#E8B33A] bg-[#E8B33A]/10 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="border border-[#E8B33A] bg-black/40 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-tight text-[#E8B33A]">
          Self-declared
        </span>
        <span className="font-mono text-[9px] uppercase tracking-tight text-muted">
          Your assessment · not a FlexSoar grade
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className="font-mono text-2xl font-black tracking-tight"
          style={{ color: ACCENT }}
        >
          {formatFloat(float)}
        </span>
        <span className="font-mono text-[11px] font-bold uppercase tracking-tight text-foreground">
          {bandSpec.label}
        </span>
      </div>

      <BandStrip float={float} />

      <div className="flex justify-between font-mono text-[8px] uppercase tracking-tight text-muted">
        <span>Factory New 0.000</span>
        <span>Well Worn 1.000</span>
      </div>

      <p className="font-mono text-[9px] leading-snug tracking-tight text-muted">
        {SELF_DECLARED_DISCLAIMER}
      </p>
    </div>
  );
}