/**
 * components/admin/grading/rubric.ts
 *
 * docs/GRADING_RUBRIC.md v1 as data, plus the DISPLAY arithmetic the panel
 * runs live as the grader types. Pure — no React, no data access — and safe
 * to import from a client component, which the server-only contract is not.
 *
 * THE FLOAT THAT REACHES THE DATABASE DOES NOT COME FROM THIS FILE. The
 * server action derives it with the contract's gradeFloatFromComponents(),
 * the single authority that mirrors the items_grade_components_sum
 * constraint. This file exists so the panel can show the same number while
 * the grader is still typing; if the two ever disagreed, the database
 * rejects the save with GRADE_COMPONENTS_MISMATCH rather than storing
 * either one.
 *
 * WHY INTEGERS HERE: component scores are hundredths (0..100) and the float
 * is thousandths (0..1000), both held as integers. `numeric` arithmetic in
 * Postgres is exact and 0.1 + 0.2 in binary floating point is not 0.3;
 * integer space reproduces the constraint's exact rounding, including the
 * half-up ties.
 *
 * The float is COMPUTED from six human judgements. It is never typed directly
 * and never suggested: nothing here proposes a component score, and there is
 * no RNG in this codebase.
 */

export const RUBRIC_VERSION = "v1";

// ------------------------------------------------------------
// 1. THE SIX COMPONENTS — rubric §1
// ------------------------------------------------------------

export type ComponentId =
  | "outsole"
  | "midsole"
  | "creasing"
  | "upper"
  | "heel"
  | "accessories";

export interface RubricComponent {
  id: ComponentId;
  label: string;
  /** Integer percent. The six sum to 100. */
  weightPercent: number;
  /** What a 0.00 on this component looks like. */
  zero: string;
  /** What a 1.00 on this component looks like. */
  one: string;
}

export const RUBRIC_COMPONENTS: readonly RubricComponent[] = [
  {
    id: "outsole",
    label: "Outsole wear",
    weightPercent: 25,
    zero: "Full tread, factory texture intact, no ground contact marks",
    one: "Tread flat or worn through, pattern gone in high-wear zones",
  },
  {
    id: "midsole",
    label: "Midsole",
    weightPercent: 20,
    zero: "Bright, no yellowing, no scuffs, no compression",
    one: "Heavy yellowing, deep scuffing, visible compression or separation",
  },
  {
    id: "creasing",
    label: "Toe box creasing",
    weightPercent: 20,
    zero: "No creasing under flex",
    one: "Deep set creases, cracked or split material at the crease",
  },
  {
    id: "upper",
    label: "Upper condition",
    weightPercent: 20,
    zero: "No marks, stains, scuffs or discolouration",
    one: "Heavy soiling, tears, holes, or material failure",
  },
  {
    id: "heel",
    label: "Heel counter & collar",
    weightPercent: 10,
    zero: "No collapse, no heel drag, padding intact",
    one: "Collapsed counter, worn through lining, heavy heel drag",
  },
  {
    id: "accessories",
    label: "Accessories",
    weightPercent: 5,
    zero: "Original box in good shape, original laces, tags present",
    one: "No box, replacement laces, nothing original",
  },
] as const;

// A weighted sum over weights that do not total 100% is not a float, it is a
// bug with three decimal places. Fail at import rather than mint it.
const TOTAL_WEIGHT = RUBRIC_COMPONENTS.reduce((sum, c) => sum + c.weightPercent, 0);
if (TOTAL_WEIGHT !== 100) {
  throw new Error(
    `rubric weights must total 100%, got ${TOTAL_WEIGHT}% — see docs/GRADING_RUBRIC.md`,
  );
}

/** Component scores in hundredths: 0..100, where 100 = 1.00. */
export type ComponentScores = Record<ComponentId, number>;

// ------------------------------------------------------------
// 2. BAND ANCHORS — rubric §2
// ------------------------------------------------------------

export type BandId =
  | "deadstock"
  | "factory_new"
  | "minimal_wear"
  | "field_tested"
  | "well_worn"
  | "battle_scarred";

export interface BandAnchor {
  id: BandId;
  label: string;
  /** Inclusive bounds in thousandths. The six are contiguous over 0..1000. */
  minMilli: number;
  maxMilli: number;
  /** What a shoe in this band looks like, for the eyeball check. */
  look: string;
}

/**
 * The grader-facing bands. These are NOT `FLOAT_BANDS` in lib/domain/rarity.ts:
 * that set is the five-band display grouping the marketplace renders (FN/MW/FT/
 * WW/BS). The boundaries agree, but the rubric splits Factory New into
 * Deadstock (0.000–0.020) and Factory New (0.021–0.070) because the difference
 * between never-worn and tried-on is a grading decision, not a display one.
 * If a boundary moves in one file it has to move in the other.
 */
export const BAND_ANCHORS: readonly BandAnchor[] = [
  {
    id: "deadstock",
    label: "Deadstock",
    minMilli: 0,
    maxMilli: 20,
    look: "Never worn. Original laces unlaced or factory-laced, tags on, no flex creasing anywhere, outsole factory-clean including the texture in the tread grooves",
  },
  {
    id: "factory_new",
    label: "Factory New",
    minMilli: 21,
    maxMilli: 70,
    look: "Tried on, walked indoors at most. No creasing visible at rest, faint sole contact marks only",
  },
  {
    id: "minimal_wear",
    label: "Minimal Wear",
    minMilli: 71,
    maxMilli: 150,
    look: "A handful of wears. Light creasing visible under flex, tread fully intact, midsole clean",
  },
  {
    id: "field_tested",
    label: "Field Tested",
    minMilli: 151,
    maxMilli: 380,
    look: "Regularly worn but cared for. Obvious creasing at rest, tread wear visible in high-contact zones, minor midsole marks",
  },
  {
    id: "well_worn",
    label: "Well Worn",
    minMilli: 381,
    maxMilli: 450,
    look: "Heavy use. Deep creasing, significant tread loss, yellowing or scuffing throughout",
  },
  {
    id: "battle_scarred",
    label: "Battle Scarred",
    minMilli: 451,
    maxMilli: 1000,
    look: "Structural wear. Material failure, sole separation, tread worn through, heavy permanent soiling",
  },
] as const;

export function bandAnchor(id: BandId): BandAnchor {
  const anchor = BAND_ANCHORS.find((b) => b.id === id);
  if (!anchor) throw new Error(`unknown band ${id}`);
  return anchor;
}

/** The band a computed float lands in. Out-of-range clamps to an end band. */
export function bandForFloatMilli(milli: number): BandAnchor {
  for (const anchor of BAND_ANCHORS) {
    if (milli >= anchor.minMilli && milli <= anchor.maxMilli) return anchor;
  }
  return milli < 0 ? BAND_ANCHORS[0] : BAND_ANCHORS[BAND_ANCHORS.length - 1];
}

// ------------------------------------------------------------
// 3. ARITHMETIC — rubric §1, "Float = weighted sum, round to 3 decimals"
// ------------------------------------------------------------

/**
 * One component's contribution, in ten-thousandths. Hundredths × percent lands
 * exactly there: 0.10 × 25% = 10 × 25 = 250 = 0.0250.
 */
export function contributionTenThousandths(
  hundredths: number,
  weightPercent: number,
): number {
  return hundredths * weightPercent;
}

/**
 * The float, in thousandths, rounded half-up — the same direction Postgres
 * rounds `numeric(4,3)`, so what the panel shows survives the write unchanged.
 *
 * Worked example from the rubric: 0.10/0.15/0.20/0.05/0.10/0.00
 *   → 250 + 300 + 400 + 100 + 100 + 0 = 1150 ten-thousandths → 115 → 0.115
 */
export function computeFloatMilli(scores: ComponentScores): number {
  let tenThousandths = 0;
  for (const component of RUBRIC_COMPONENTS) {
    tenThousandths += contributionTenThousandths(
      scores[component.id],
      component.weightPercent,
    );
  }
  return Math.round(tenThousandths / 10);
}

/** '0.115'. Always 3 decimals, matching numeric(4,3). */
export function formatFloat3(milli: number): string {
  return (milli / 1000).toFixed(3);
}

/** '0.10'. Always 2 decimals — how components are graded. */
export function formatScore2(hundredths: number): string {
  return (hundredths / 100).toFixed(2);
}

/** '0.0250'. Contributions need 4 decimals to stay exact (0.05 × 25%). */
export function formatContribution4(tenThousandths: number): string {
  return (tenThousandths / 10000).toFixed(4);
}

/** '0.000–0.020', for the anchor table. */
export function formatBandRange(anchor: BandAnchor): string {
  return `${formatFloat3(anchor.minMilli)}–${formatFloat3(anchor.maxMilli)}`;
}

// ------------------------------------------------------------
// 4. INPUT PARSING
// ------------------------------------------------------------

export type ParsedScore =
  | { ok: true; hundredths: number }
  | { ok: false; error: string };

/**
 * A typed component score, 0.00–1.00 at two decimals. Rejects rather than
 * rounds: '0.125' is a grader who has not decided between 0.12 and 0.13, and
 * the rubric says take the worse one deliberately, not silently.
 */
export function parseComponentScore(raw: string): ParsedScore {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "required" };
  if (!/^\d(\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: "0.00 to 1.00, two decimals" };
  }
  const [whole, frac = ""] = text.split(".");
  const hundredths = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (hundredths > 100) return { ok: false, error: "0.00 to 1.00" };
  return { ok: true, hundredths };
}

// The JSON-in-grading_notes interim storage that used to live here is gone:
// 008 gave the six components real columns (grade_outsole .. grade_accessories)
// before anything was written in the old shape, so there is nothing to parse
// back and no backfill to run.
