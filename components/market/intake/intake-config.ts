/**
 * components/market/intake/intake-config.ts
 *
 * Pure data for the self-serve listing flow. No state, no IO — the wizard,
 * the condition questions, and the photo angle guide all read from here so
 * copy and structure live in one place.
 *
 * The condition questions map to the six rubric components (lib/db/grading)
 * but are phrased for a seller who has never read a rubric. The score behind
 * each answer feeds gradeFloatFromComponents() for the live, self-declared
 * float preview. That float is a HONEST-SELF-ASSESSMENT ONLY — FlexSoar
 * re-grades at intake and the human grade is the one that becomes a card.
 */

import type { GradeComponents } from "@/lib/db/grading";

// ------------------------------------------------------------
// PHOTO ANGLES
// ------------------------------------------------------------

export interface PhotoAngle {
  key: string;
  label: string;
  hint: string;
}

/**
 * Exactly four — the count fn_submit_listing actually enforces. Chosen for
 * the most information per shot: toe (creasing, the first thing a buyer
 * checks), both full-length sides (upper condition, shape), and the outsole
 * (tread wear, a resale-critical view a buyer can't otherwise judge). No
 * optional angles — four is the whole photo step, not a floor under a
 * longer wishlist.
 */
export const PHOTO_ANGLES: readonly PhotoAngle[] = [
  { key: "toe", label: "Toe", hint: "Top-down, straight over the toe box" },
  { key: "lateral_left", label: "Left side", hint: "Full length, lateral side of the left shoe" },
  { key: "lateral_right", label: "Right side", hint: "Full length, lateral side of the right shoe" },
  { key: "outsole", label: "Outsole", hint: "Tread, showing wear across the whole sole" },
];

export const REQUIRED_PHOTO_COUNT = 4;

/** The photos payload is a { url, angle }[] — same shape the admin photo viewer reads. */
export interface IntakePhoto {
  url: string;
  angle: string;
}

// ------------------------------------------------------------
// CONDITION QUESTIONS
// ------------------------------------------------------------

export interface ConditionOption {
  label: string;
  /** The component score behind the answer, 0.00 .. 1.00. */
  score: number;
}

export interface ConditionQuestion {
  key: keyof GradeComponents;
  question: string;
  hint: string;
  options: readonly ConditionOption[];
}

/** Four everyday answer levels, one per wear component. */
const WEAR_LEVELS: readonly ConditionOption[] = [
  { label: "Like new", score: 0.05 },
  { label: "Light wear", score: 0.25 },
  { label: "Noticeable wear", score: 0.55 },
  { label: "Heavy wear", score: 0.85 },
];

/**
 * Accessories asks a possession question, not a wear question — it does not
 * belong on the WEAR_LEVELS scale ("Like new" answering "do you have the
 * box?" reads as a bug). Three options because the rubric calls out the
 * box-damaged-or-partial case by name and it is common enough to earn its
 * own slot, not get rounded to "yes" or "no."
 */
const ACCESSORIES_LEVELS: readonly ConditionOption[] = [
  { label: "Yes — box, tags, everything", score: 0.0 },
  { label: "Box only", score: 0.4 },
  { label: "No box or extras", score: 1.0 },
];

/** Plain-language, in buyer order: money views first, accessories last. */
export const CONDITION_QUESTIONS: readonly ConditionQuestion[] = [
  {
    key: "outsole",
    question: "How worn is the rubber on the bottom?",
    hint: "Flattened tread or bald patches are wear. Scuffs on the sole edge are normal and barely count.",
    options: WEAR_LEVELS,
  },
  {
    key: "midsole",
    question: "How is the foam between the sole and the upper?",
    hint: "Check for yellowing, crushed foam, or cracks along the sides.",
    options: WEAR_LEVELS,
  },
  {
    key: "creasing",
    question: "How creased is the toe box and the upper?",
    hint: "Creases across the toe are the first thing a buyer checks. Slight creasing from a few wears is normal.",
    options: WEAR_LEVELS,
  },
  {
    key: "upper",
    question: "What shape is the fabric, leather, or knit on top?",
    hint: "Stains, scuffs, tears, and embedded dirt all count here.",
    options: WEAR_LEVELS,
  },
  {
    key: "heel",
    question: "How worn is the heel, inside and out?",
    hint: "Heel drag on the outside, collar stretch on the inside.",
    options: WEAR_LEVELS,
  },
  {
    key: "accessories",
    question: "Do you have the box, tags, and any extras?",
    hint: "Missing or damaged extras cost value — be honest, it protects you at review.",
    options: ACCESSORIES_LEVELS,
  },
];

/** A complete self-declared condition: all six answers. */
export type SelfDeclaredCondition = GradeComponents;

// ------------------------------------------------------------
// PAYOUT
// ------------------------------------------------------------

export type PayoutMethod = "credit" | "cash";

// ------------------------------------------------------------
// INTENTIONALLY PLACED BAND LABELS
// ------------------------------------------------------------

/** Copy shown under every self-declared float. Distinct from FlexSoar's own grade. */
export const SELF_DECLARED_DISCLAIMER =
  "This is your own assessment, not a FlexSoar grade. A grader re-checks the shoe at intake; that grade is what becomes the card.";
