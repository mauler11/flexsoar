/**
 * components/admin/submissions/DeclaredGrade.tsx
 *
 * The seller's six declared component scores, the float they imply, and the
 * band that float lands in.
 *
 * NOT A GRADING PANEL. Nothing here is editable and nothing here proposes a
 * score. The grading bench at /admin/grading is where a float is decided by a
 * human with the shoe in front of them; this screen is where a reviewer
 * decides whether to BELIEVE a float decided by someone who is keeping the
 * shoe. So the numbers are laid out to be checked against the photos — every
 * component, its weight, and what it contributed — rather than typed into.
 *
 * The float is derived with `gradeFloatFromComponents()` from lib/db/grading —
 * the same exact-integer arithmetic the `items_grade_components_sum`
 * constraint recomputes in Postgres — and NOT with the display helpers in
 * components/admin/grading/rubric.ts. Those exist for a panel doing live
 * arithmetic while a grader types; here the number is already stored and the
 * question is whether it is the right one, which only the authority can
 * answer.
 *
 * Server-safe: pure presentation over pure functions, no interaction, no
 * data access.
 */

import { Badge } from "@/components/ui/Badge";
import {
  bandForFloatMilli,
  formatBandRange,
  RUBRIC_COMPONENTS,
} from "@/components/admin/grading/rubric";
import { gradeFloatFromComponents, type GradeComponents } from "@/lib/db/grading";
import type { FloatValue } from "@/lib/db/types";

export interface DeclaredGradeProps {
  /** The six declared scores, or null when the seller declared none. */
  grade: GradeComponents | null;
  /** `items.float_value` as stored, for the agreement check. */
  storedFloat: FloatValue | null;
  /** 'seller_declared' or 'flexsoar' — who these numbers came from. */
  declared: boolean;
}

export function DeclaredGrade({
  grade,
  storedFloat,
  declared,
}: DeclaredGradeProps) {
  if (!grade) {
    return (
      <div className="flex flex-col gap-2 border border-line bg-raised p-3">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Declared condition
        </h2>
        <p className="border border-[#E8B33A] bg-overlay p-2 font-mono text-[11px] leading-snug tracking-tight text-[#E8B33A]">
          No component scores on this row. All six or none —
          items_grade_components_complete makes a partial set impossible — so
          this submission carries no declared grade at all, and approving it
          would mint a card with no float behind it.
        </p>
      </div>
    );
  }

  const computed = gradeFloatFromComponents(grade);
  const computedMilli = Math.round(computed * 1000);
  const band = bandForFloatMilli(computedMilli);

  // Stored vs computed. The constraint means these agree on every row the
  // database accepted, so a disagreement is either a row written before 008 or
  // something this screen does not understand. Either way, say so rather than
  // quietly showing one of them.
  const storedMilli = storedFloat == null ? null : Math.round(storedFloat * 1000);
  const disagrees = storedMilli !== null && storedMilli !== computedMilli;

  return (
    <div className="flex flex-col gap-2 border border-line bg-raised p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Declared condition
        </h2>
        {declared ? (
          <Badge tone="warn">Seller declared</Badge>
        ) : (
          <Badge tone="info">FlexSoar graded</Badge>
        )}
      </div>

      {declared && (
        <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
          These are the seller&apos;s own scores. Check each one against the
          photos before approving — the float is copied to the card at mint and
          is immutable after.
        </p>
      )}

      <table className="w-full border-collapse text-left font-mono text-[11px] tracking-tight">
        <thead className="border-b border-line text-[10px] uppercase tracking-tight text-muted">
          <tr>
            <th scope="col" className="py-1 font-normal">
              Component
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Weight
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Declared
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Contributes
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {RUBRIC_COMPONENTS.map((component) => {
            const score = grade[component.id];
            // Hundredths x whole percent lands exactly in ten-thousandths,
            // which is the same space the authority sums in.
            const contribution =
              (Math.round(score * 100) * component.weightPercent) / 10000;
            return (
              <tr key={component.id}>
                <td className="py-1">{component.label}</td>
                <td className="py-1 text-right tabular-nums text-muted">
                  {component.weightPercent}%
                </td>
                <td className="py-1 text-right tabular-nums">
                  {score.toFixed(2)}
                </td>
                <td className="py-1 text-right tabular-nums text-muted">
                  {contribution.toFixed(4)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Computed float
          </p>
          <p className="font-mono text-xl tabular-nums">
            {computed.toFixed(3)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
            {band.label}
          </p>
          <p className="font-mono text-[10px] tabular-nums tracking-tight text-muted">
            {formatBandRange(band)}
          </p>
        </div>
      </div>

      <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
        {band.look}
      </p>

      {disagrees && (
        <p className="border border-[#FF4444] bg-overlay p-2 font-mono text-[11px] leading-snug tracking-tight text-[#FF4444]">
          Stored float is {storedFloat?.toFixed(3)} but the six components sum
          to {computed.toFixed(3)}. The card mints from what the database holds,
          not from this screen — do not approve until that is explained.
        </p>
      )}
    </div>
  );
}
