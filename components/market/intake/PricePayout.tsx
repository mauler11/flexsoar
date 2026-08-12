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
 */

import type { Sku } from "@/lib/db/types";
import { floatMultiplier } from "@/components/card/value";
import { formatFsc, formatUsd } from "@/components/card/format";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { PayoutMethod } from "@/components/market/intake/intake-config";
import type { PayoutEligibility } from "@/app/(market)/list/actions";

export interface PricePayoutProps {
  sku: Sku;
  declaredFloat: number | null;
  priceCents: number | null;
  onPriceChange: (cents: number) => void;
  payout: PayoutMethod | null;
  onPayoutChange: (method: PayoutMethod) => void;
  eligibility: PayoutEligibility | null;
}

export function PricePayout({
  sku,
  declaredFloat,
  priceCents,
  onPriceChange,
  payout,
  onPayoutChange,
  eligibility,
}: PricePayoutProps) {
  const oracle = sku.market_price_cents;
  const estimate =
    oracle != null && declaredFloat != null
      ? Math.floor(oracle * floatMultiplier(declaredFloat))
      : null;

  const priceDollars =
    priceCents != null ? String((priceCents / 100).toFixed(2)) : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 border border-line-strong bg-overlay p-3">
        <span className="font-mono text-[10px] font-bold uppercase tracking-tight text-muted">
          {sku.brand} {sku.model} · {sku.colorway} · US {sku.size_us}
        </span>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[11px] tracking-tight text-muted">
            Oracle reference value (deadstock)
          </span>
          <span className="font-mono text-[13px] font-bold tracking-tight text-accent">
            {oracle != null ? formatFsc(oracle) : "unpriced"}
            {oracle != null && (
              <span className="ml-1 text-[9px] font-normal text-muted">
                {formatUsd(oracle)}
              </span>
            )}
          </span>
        </div>
        {estimate != null && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] tracking-tight text-muted">
              At your self-declared condition
            </span>
            <span className="font-mono text-[11px] font-bold tracking-tight text-foreground">
              ≈ {formatFsc(estimate)}
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