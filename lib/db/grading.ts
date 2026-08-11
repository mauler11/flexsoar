/**
 * lib/db/grading.ts
 *
 * The rubric arithmetic behind fn_grade_item, as pure functions.
 *
 * Split out of lib/api/contract.ts so it is testable: the contract module
 * reaches next/headers through lib/supabase/server.ts, and this arithmetic
 * must be provable in a plain test runner — the items_grade_components_sum
 * constraint recomputes it in Postgres `numeric` and rejects any float that
 * disagrees, so "close" is a hard failure, not a rendering nit. The contract
 * re-exports both names; import from either.
 *
 * If 008's constraint or docs/GRADING_RUBRIC.md ever changes weights, change
 * GRADE_WEIGHTS here and the sweep in tests/invariants.test.ts pins the rest.
 */

import type { FloatValue } from '@/lib/db/types';

/**
 * The six rubric components, 0.00 .. 1.00 each. All six or none —
 * items_grade_components_complete rejects a partial set.
 *
 * The float is their weighted sum and the database checks it, so compute it
 * with gradeFloatFromComponents() rather than asking the grader for a total.
 */
export interface GradeComponents {
  outsole: number;
  midsole: number;
  creasing: number;
  upper: number;
  heel: number;
  accessories: number;
}

/**
 * The rubric weights from 008_grading.sql, which are the ones in
 * docs/GRADING_RUBRIC.md. Kept here so a UI can show the arithmetic live as
 * the grader scores each component.
 */
export const GRADE_WEIGHTS: Readonly<Record<keyof GradeComponents, number>> = {
  outsole: 0.25,
  midsole: 0.2,
  creasing: 0.2,
  upper: 0.2,
  heel: 0.1,
  accessories: 0.05,
};

/**
 * The float implied by a set of component scores, to 3dp.
 *
 * Mirrors the items_grade_components_sum constraint exactly. Use it to fill the
 * float field rather than asking the grader for a total: the rubric is explicit
 * that scoring the components comes first and the float falls out, and the
 * database rejects any other combination with GRADE_COMPONENTS_MISMATCH.
 *
 * INTEGER ARITHMETIC, DELIBERATELY. The constraint recomputes this sum in
 * Postgres `numeric`, which is exact decimal; a binary-FP version of this
 * function rounded every exact half-milli tie DOWN (the product lands a hair
 * under .5 in binary) while numeric rounds half away from zero — so ~3% of
 * valid 2dp grades produced a float the database then rejected. Smallest case:
 * accessories 0.29 alone is 0.0145, numeric says 0.015, FP said 0.014.
 *
 * So: components to exact hundredths, weights as whole percents, products
 * summed in ten-thousandths — all integers, nothing lost — and one half-up
 * rounding at the end. Half-up equals numeric's half-away-from-zero because a
 * score is never negative. Math.round(x * 100) mirrors what Postgres itself
 * does to a component on assignment to numeric(3,2).
 *
 * The percent weights are derived from GRADE_WEIGHTS at module load rather
 * than written as second copies of 25/20/20/20/10/5, so the two cannot drift.
 */
const GRADE_WEIGHT_PERCENTS: Readonly<Record<keyof GradeComponents, number>> = {
  outsole: Math.round(GRADE_WEIGHTS.outsole * 100),
  midsole: Math.round(GRADE_WEIGHTS.midsole * 100),
  creasing: Math.round(GRADE_WEIGHTS.creasing * 100),
  upper: Math.round(GRADE_WEIGHTS.upper * 100),
  heel: Math.round(GRADE_WEIGHTS.heel * 100),
  accessories: Math.round(GRADE_WEIGHTS.accessories * 100),
};

export function gradeFloatFromComponents(components: GradeComponents): FloatValue {
  const tenThousandths =
    Math.round(components.outsole * 100) * GRADE_WEIGHT_PERCENTS.outsole +
    Math.round(components.midsole * 100) * GRADE_WEIGHT_PERCENTS.midsole +
    Math.round(components.creasing * 100) * GRADE_WEIGHT_PERCENTS.creasing +
    Math.round(components.upper * 100) * GRADE_WEIGHT_PERCENTS.upper +
    Math.round(components.heel * 100) * GRADE_WEIGHT_PERCENTS.heel +
    Math.round(components.accessories * 100) * GRADE_WEIGHT_PERCENTS.accessories;

  // Integer millis, half-up. tenThousandths % 10 is exact — everything above
  // is integer arithmetic well inside Number.MAX_SAFE_INTEGER.
  const millis =
    Math.floor(tenThousandths / 10) + (tenThousandths % 10 >= 5 ? 1 : 0);
  return millis / 1000;
}
