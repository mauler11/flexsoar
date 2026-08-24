/**
 * components/market/ListForm.tsx
 *
 * The owner's "list this card" form. Price is entered in display unit and
 * submitted as integer cents. The 15%-below-oracle warning is shown, and it
 * is exactly that — a warning. A below-oracle ask is a seller's prerogative
 * and fn_list_card accepts it; the warning makes the choice an informed one.
 *
 * Country: fn_list_card calls fn_payout_method_for_user internally (right in
 * the listings insert, 019c_settlement.sql:360), which (025) now raises
 * COUNTRY_NOT_SET for a seller with none on file instead of silently
 * resolving to 'credit'. The self-serve intake wizard
 * (components/market/intake/PricePayout.tsx) is where a NEW item's country
 * gets asked and persisted — but relisting a card this owner already holds
 * (bought it, or it predates 025) never goes through that wizard, so without
 * this the owner would hit fn_list_card's raise with no field anywhere on
 * this screen to fix it. `countryCode` (the account's country on file, or
 * null) decides whether this picker renders at all.
 */
"use client";

import { useState, useTransition } from "react";
import { listCardAction } from "@/app/(market)/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Banner } from "@/components/market/Banner";
import { formatUsd } from "@/components/card/format";
import { COUNTRIES, isValidCountryCode } from "@/components/market/intake/intake-config";

export interface ListFormProps {
  cardId: string;
  oracleValueCents: number | null;
  /**
   * fn_payout_method_for_user's answer for this seller — 'cash' or 'credit',
   * derived from their country, never a choice. Null when it couldn't be
   * read (signed out, or the read failed) — the disclosure is simply
   * omitted in that case rather than guessed at.
   */
  sellerPayoutMethod?: "cash" | "credit" | null;
  /**
   * The account's users.country_code on file, or null. Not valid ⇒ this form
   * renders a required country picker and sends it along with the listing
   * request; listCardAction persists it (setCountry) before calling
   * fn_list_card. Already valid ⇒ no picker, nothing extra sent.
   */
  countryCode?: string | null;
}

function toCents(text: string): number | null {
  const parsed = Number(text.trim());
  if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed <= 0) return null;
  const cents = Math.round(parsed * 100);
  return cents > 0 ? cents : null;
}

export function ListForm({
  cardId,
  oracleValueCents,
  sellerPayoutMethod,
  countryCode,
}: ListFormProps) {
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const needsCountry = !isValidCountryCode(countryCode);
  const [selectedCountry, setSelectedCountry] = useState("");

  const cents = toCents(price);
  const belowOracle =
    cents != null && oracleValueCents != null && cents < oracleValueCents * 0.85;

  function submit() {
    const value = toCents(price);
    if (value == null) {
      setError("Enter a price in FSC (whole cents, > 0).");
      return;
    }
    if (needsCountry && !isValidCountryCode(selectedCountry)) {
      setError("Select your country before listing — it decides whether you're paid in cash or FSC.");
      return;
    }
    setError(null);
    const data = new FormData();
    data.set("card_id", cardId);
    data.set("price_cents", String(value));
    if (needsCountry) data.set("country_code", selectedCountry);
    startTransition(() => listCardAction(data));
  }

  return (
    <div className="flex flex-col gap-2 border border-line bg-overlay p-3">
      {sellerPayoutMethod === "credit" && (
        <Banner tone="info" title="You'll be paid in FSC">
          Your account routes to FSC payout, not cash — determined by your
          country, not a choice made here. Find that out now, not after this
          sells.
        </Banner>
      )}
      {sellerPayoutMethod === "cash" && (
        <Banner tone="info" title="You'll be paid in cash">
          Your account routes to a cash bank payout.
        </Banner>
      )}

      {needsCountry && (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Your country
          </span>
          <select
            aria-label="Your country"
            value={selectedCountry}
            onChange={(e) => {
              setSelectedCountry(e.target.value);
              if (e.target.value) setError(null);
            }}
            disabled={pending}
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
            No country on file yet — decides whether this sale pays you in
            cash or FSC. Required to list.
          </span>
        </div>
      )}

      {oracleValueCents != null && (
        <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-tight text-muted">
          <span>Oracle fair value</span>
          <span className="text-foreground">
            {formatUsd(oracleValueCents)}
          </span>
        </div>
      )}

      <Input
        type="text"
        inputMode="decimal"
        placeholder="Ask price in FSC"
        value={price}
        onChange={(e) => {
          setPrice(e.target.value);
          if (e.target.value) setError(null);
        }}
        disabled={pending}
        aria-label="Ask price in FSC"
      />

      {belowOracle && (
        <Banner tone="warn" title="15% below oracle value">
          Buyers compare every ask to the oracle — a below-oracle list sells
          the fastest. This is a warning, not a block.
        </Banner>
      )}
      {error && <Banner tone="error" title={error} />}

      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="font-mono text-[9px] uppercase tracking-tight text-muted">
          Listing opens a level-gated window, then becomes public
        </p>
        <Button
          type="button"
          size="sm"
          disabled={
            pending ||
            cents == null ||
            (needsCountry && !isValidCountryCode(selectedCountry))
          }
          onClick={submit}
        >
          {pending ? "Listing…" : "List card"}
        </Button>
      </div>
    </div>
  );
}