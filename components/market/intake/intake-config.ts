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
  required: boolean;
}

/** Required first: a buyer must see the four money views. */
export const PHOTO_ANGLES: readonly PhotoAngle[] = [
  { key: "toe", label: "Toe", hint: "Top-down, straight over the toe box", required: true },
  { key: "lateral_left", label: "Left side", hint: "Medial side of the left shoe, full length", required: true },
  { key: "lateral_right", label: "Right side", hint: "Lateral side of the right shoe, full length", required: true },
  { key: "heel", label: "Heel", hint: "Heel counter, dead-on from behind", required: true },
  { key: "outsole", label: "Outsole", hint: "Tread, showing wear across the whole sole", required: false },
  { key: "insole", label: "Insole / size tag", hint: "Inside the shoe — size tag if you can", required: false },
  { key: "box_label", label: "Box label", hint: "The sticker on the box with style and size", required: false },
  { key: "accessories", label: "Extras", hint: "Extra laces, tags, tote — everything that came with it", required: false },
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

/** Four everyday answer levels, one per component. */
const WEAR_LEVELS: readonly ConditionOption[] = [
  { label: "Like new", score: 0.05 },
  { label: "Light wear", score: 0.25 },
  { label: "Noticeable wear", score: 0.55 },
  { label: "Heavy wear", score: 0.85 },
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
    options: WEAR_LEVELS,
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
