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

/**
 * How a seller will actually be paid for a given country selection — mirrors
 * fn_payout_method_for_user's own membership check against
 * cash_payout_countries (019b: `c.country_code = upper(btrim(u.country_code))`),
 * not a guess. Payout is geography, not a choice a seller makes
 * (AGENT_RULES.md section 5), so this is the single source of truth behind
 * both the read-only indicator in PricePayout and the value the wizard
 * submits. Falls back to the account's on-file `sellerPayoutMethod` only
 * before a valid country is picked here.
 */
export function derivePayoutPreview(
  countryCode: string | null,
  cashPayoutCountryCodes: readonly string[],
  sellerPayoutMethod?: PayoutMethod | null,
): PayoutMethod | null {
  if (isValidCountryCode(countryCode)) {
    return cashPayoutCountryCodes.includes(countryCode) ? "cash" : "credit";
  }
  return sellerPayoutMethod ?? null;
}

// ------------------------------------------------------------
// COUNTRY (payout routing)
// ------------------------------------------------------------

/**
 * ISO 3166-1 alpha-2. This is the seller's OWN country, captured at listing
 * time because `fn_payout_method_for_user` resolves a null `users.country_code`
 * to 'credit' with no error anywhere — a real signup produces exactly that
 * null, so every seller who never sets one is silently paid FSC instead of
 * cash. No entry defaults selected; the picker's placeholder option is not a
 * valid choice, deliberately, since a default here is the same bug pointed
 * the other way.
 */
export interface CountryOption {
  code: string;
  name: string;
}

export const COUNTRIES: readonly CountryOption[] = [
  { code: "AF", name: "Afghanistan" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BR", name: "Brazil" },
  { code: "BN", name: "Brunei" },
  { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" },
  { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" },
  { code: "CV", name: "Cape Verde" },
  { code: "CF", name: "Central African Republic" },
  { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" },
  { code: "CD", name: "Congo (DRC)" },
  { code: "CR", name: "Costa Rica" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" },
  { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "GQ", name: "Equatorial Guinea" },
  { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini" },
  { code: "ET", name: "Ethiopia" },
  { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GR", name: "Greece" },
  { code: "GD", name: "Grenada" },
  { code: "GT", name: "Guatemala" },
  { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" },
  { code: "HN", name: "Honduras" },
  { code: "HK", name: "Hong Kong" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran" },
  { code: "IQ", name: "Iraq" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" },
  { code: "KI", name: "Kiribati" },
  { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" },
  { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MO", name: "Macao" },
  { code: "MG", name: "Madagascar" },
  { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" },
  { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" },
  { code: "MT", name: "Malta" },
  { code: "MR", name: "Mauritania" },
  { code: "MU", name: "Mauritius" },
  { code: "MX", name: "Mexico" },
  { code: "MD", name: "Moldova" },
  { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" },
  { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" },
  { code: "MM", name: "Myanmar" },
  { code: "NA", name: "Namibia" },
  { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" },
  { code: "MK", name: "North Macedonia" },
  { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" },
  { code: "PK", name: "Pakistan" },
  { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "QA", name: "Qatar" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" },
  { code: "SC", name: "Seychelles" },
  { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "SB", name: "Solomon Islands" },
  { code: "SO", name: "Somalia" },
  { code: "ZA", name: "South Africa" },
  { code: "KR", name: "South Korea" },
  { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" },
  { code: "LK", name: "Sri Lanka" },
  { code: "SD", name: "Sudan" },
  { code: "SR", name: "Suriname" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria" },
  { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" },
  { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" },
  { code: "TL", name: "Timor-Leste" },
  { code: "TG", name: "Togo" },
  { code: "TO", name: "Tonga" },
  { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" },
  { code: "TR", name: "Turkey" },
  { code: "TM", name: "Turkmenistan" },
  { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" },
  { code: "UZ", name: "Uzbekistan" },
  { code: "VU", name: "Vanuatu" },
  { code: "VA", name: "Vatican City" },
  { code: "VE", name: "Venezuela" },
  { code: "VN", name: "Vietnam" },
  { code: "YE", name: "Yemen" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
];

const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));

/** True for exactly the codes in `COUNTRIES` — never true for blank/lowercase/unknown input. */
export function isValidCountryCode(code: string | null | undefined): code is string {
  return code != null && COUNTRY_CODES.has(code);
}

// ------------------------------------------------------------
// INTENTIONALLY PLACED BAND LABELS
// ------------------------------------------------------------

/** Copy shown under every self-declared float. Distinct from FlexSoar's own grade. */
export const SELF_DECLARED_DISCLAIMER =
  "This is your own assessment, not a FlexSoar grade. A grader re-checks the shoe at intake; that grade is what becomes the card.";
