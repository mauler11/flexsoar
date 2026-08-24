"use client";

/**
 * components/market/intake/PricePayout.tsx
 *
 * Step 4 of the intake wizard: the reserve price and the payout method.
 *
 * Price sits NEXT TO the SKU's oracle value (market_price_cents) so the seller
 * prices against a reference, and shows the estimated value at their
 * self-declared float as a hint. The oracle reference is the "what the shoe is
 * worth new at the oracle" figure — never the seller's own estimate.
 *
 * Payout: credit always available; cash is gated on completed fulfilments
 * (server re-checks at submit, this is the convenience lock).
 *
 * Country: `fn_payout_method_for_user` resolves a null `users.country_code`
 * to 'credit' with no error — a real signup produces exactly that null, so a
 * seller who never sets a country is silently paid FSC instead of cash. This
 * step is the first place payout is actually disclosed, so it is where the
 * country is asked for. The disclosure banner below reacts to whichever
 * country is currently selected, via `cashPayoutCountryCodes` (a live read of
 * `cash_payout_countries`, not a hardcoded guess), so a seller sees the real
 * outcome before submitting — not `sellerPayoutMethod`, which only reflects
 * whatever is already saved and does not move as they pick a country here.
 *
 * NOTE (see docs/handoff/market.md): selecting a country here validates and
 * blocks submission, but does not yet WRITE `users.country_code` — no
 * contract export exists to save it, and `users`' self-update grant
 * (007_profile_updates.sql) covers only `handle`. That is a track/data +
 * migration ask, filed in the handoff; this step is ready to call it the
 * moment it lands.
 */

import type { Sku } from "@/lib/db/types";
import { floatMultiplier } from "@/components/card/value";
import { formatUsd } from "@/components/card/format";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import {
  COUNTRIES,
  isValidCountryCode,
  type PayoutMethod,
} from "@/components/market/intake/intake-config";
import type { PayoutEligibility } from "@/app/(market)/list/actions";

export interface PricePayoutProps {
  sku: Sku;
  declaredFloat: number | null;
  priceCents: number | null;
  onPriceChange: (cents: number) => void;
  payout: PayoutMethod | null;
  onPayoutChange: (method: PayoutMethod) => void;
  eligibility: PayoutEligibility | null;
  /**
   * How the SELLER (not the listing's buyer-settlement election below) is
   * actually paid — fn_payout_method_for_user, derived from their country.
   * Distinct from `payout`/`onPayoutChange`, which is the buyer's own
   * payment method for this listing. Only used as a fallback before a
   * country is selected below; once one is, the selection wins.
   */
  sellerPayoutMethod?: "cash" | "credit" | null;
  /** The seller's own country — required, real choice, no default. */
  countryCode: string | null;
  onCountryChange: (code: string) => void;
  /** Live membership list for the disclosure preview — see the file doc comment. */
  cashPayoutCountryCodes?: readonly string[];
}

export function PricePayout({
  sku,
  declaredFloat,
  priceCents,
  onPriceChange,
  payout,
  onPayoutChange,
  eligibility,
  sellerPayoutMethod,
  countryCode,
  onCountryChange,
  cashPayoutCountryCodes = [],
}: PricePayoutProps) {
  const oracle = sku.market_price_cents;
  const estimate =
    oracle != null && declaredFloat != null
      ? Math.floor(oracle * floatMultiplier(declaredFloat))
      : null;

  const priceDollars =
    priceCents != null ? String((priceCents / 100).toFixed(2)) : "";

  // The selection in this step always wins over the account's saved payout
  // method once one is made — that saved value is stale the moment the
  // seller picks a different country here.
  const previewedPayoutMethod: "cash" | "credit" | null = isValidCountryCode(countryCode)
    ? cashPayoutCountryCodes.includes(countryCode)
      ? "cash"
      : "credit"
    : (sellerPayoutMethod ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-tight text-muted">
          Your country
        </span>
        <select
          aria-label="Your country"
          value={countryCode ?? ""}
          onChange={(e) => onCountryChange(e.target.value)}
          className="border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[12px] tracking-tight text-foreground"
        >
          <option value="" disabled>
            Select your country…
          </option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="font-mono text-[10px] tracking-tight text-muted">
          Decides whether this sale pays you in cash or FSC. Required to
          submit.
        </span>
      </div>

      {previewedPayoutMethod === "credit" && (
        <Banner tone="info" title="You'll be paid in FSC, not cash">
          FSC is store credit — 1 FSC = 1 USD, earned by selling, spendable on
          FlexSoar. It cannot be cashed out to a bank. Your country is outside
          the Stripe corridor this platform can settle cash through, so a sale
          here pays out in FSC, not cash. Know that now, before you list, not
          after this sells.
        </Banner>
      )}
      {previewedPayoutMethod === "cash" && (
        <Banner tone="info" title="You'll be paid in cash">
          Your country routes to a cash bank payout.
        </Banner>
      )}

      <div className="flex flex-col gap-1 border border-line-strong bg-overlay p-3">
        <span className="font-mono text-[10px] font-bold uppercase tracking-tight text-muted">
          {sku.brand} {sku.model} · {sku.colorway} · US {sku.size_us}
        </span>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[11px] tracking-tight text-muted">
            Oracle reference value (deadstock)
          </span>
          <span className="font-mono text-[13px] font-bold tracking-tight text-accent">
            {oracle != null ? formatUsd(oracle) : "unpriced"}
          </span>
        </div>
        {estimate != null && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] tracking-tight text-muted">
              At your self-declared condition
            </span>
            <span className="font-mono text-[11px] font-bold tracking-tight text-foreground">
              ≈ {formatUsd(estimate)}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Your price (USD)"
          type="number"
          min="0"
          step="0.01"
          placeholder="e.g. 215.00"
          value={priceDollars}
          onChange={(e) => {
            const dollars = Number(e.target.value);
            if (Number.isFinite(dollars) && dollars >= 0) {
              onPriceChange(Math.round(dollars * 100));
            } else {
              onPriceChange(0);
            }
          }}
          hint="Reserve price — what you must clear to sell."
        />
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Payout method
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant={payout === "credit" ? "primary" : "secondary"}
              size="md"
              onClick={() => onPayoutChange("credit")}
            >
              credit
            </Button>
            <Button
              variant={payout === "cash" ? "primary" : "secondary"}
              size="md"
              disabled={!eligibility?.cashEligible}
              onClick={() => onPayoutChange("cash")}
            >
              cash
            </Button>
          </div>
        </div>
      </div>

      <div className="border border-dashed border-line-strong bg-raised px-3 py-2 font-mono text-[10px] leading-relaxed tracking-tight text-muted">
        {payout === "credit"
          ? "Credit lands on your FlexSoar balance the moment the sale settles — usable in checkout immediately."
          : payout === "cash"
            ? "Cash is a bank payout after the sale clears. It unlocks once you've completed fulfilments — a payout ledger is pending (handoff M4), the gate uses shipped redemptions for now."
            : "Credit is instant and always available. Cash unlocks after completed fulfilments."}
        {payout !== "cash" &&
          eligibility &&
          !eligibility.cashEligible &&
          ` Cash unlocks at ${eligibility.threshold} completed fulfilment(s); you have ${eligibility.fulfilledShipments}.`}
        {!eligibility &&
          " Sign in to unlock payout choices on submit."}
      </div>
    </div>
  );
}