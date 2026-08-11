/**
 * components/market/ListForm.tsx
 *
 * The owner's "list this card" form. Price is entered in display unit and
 * submitted as integer cents. The 15%-below-oracle warning is shown, and it
 * is exactly that — a warning. A below-oracle ask is a seller's prerogative
 * and fn_list_card accepts it; the warning makes the choice an informed one.
 */
"use client";

import { useState, useTransition } from "react";
import { listCardAction } from "@/app/(market)/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Banner } from "@/components/market/Banner";
import { formatFsc, formatMyr } from "@/components/card/format";

export interface ListFormProps {
  cardId: string;
  oracleValueCents: number | null;
}

function toCents(text: string): number | null {
  const parsed = Number(text.trim());
  if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed <= 0) return null;
  const cents = Math.round(parsed * 100);
  return cents > 0 ? cents : null;
}

export function ListForm({ cardId, oracleValueCents }: ListFormProps) {
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cents = toCents(price);
  const belowOracle =
    cents != null && oracleValueCents != null && cents < oracleValueCents * 0.85;

  function submit() {
    const value = toCents(price);
    if (value == null) {
      setError("Enter a price in FSC (whole cents, > 0).");
      return;
    }
    setError(null);
    const data = new FormData();
    data.set("card_id", cardId);
    data.set("price_cents", String(value));
    startTransition(() => listCardAction(data));
  }

  return (
    <div className="flex flex-col gap-2 border border-line bg-overlay p-3">
      {oracleValueCents != null && (
        <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-tight text-muted">
          <span>Oracle fair value</span>
          <span className="text-foreground">
            {formatFsc(oracleValueCents)} <span className="text-muted">{formatMyr(oracleValueCents)}</span>
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
          disabled={pending || cents == null}
          onClick={submit}
        >
          {pending ? "Listing…" : "List card"}
        </Button>
      </div>
    </div>
  );
}