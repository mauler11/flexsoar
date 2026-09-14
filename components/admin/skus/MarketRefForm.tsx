/**
 * components/admin/skus/MarketRefForm.tsx
 *
 * One row on the model bench for pinning an external reference point onto
 * the model's trading tape: price in integer MYR sen plus a date (default
 * today, backfill older comps with older dates). Each entry is one dot on
 * the dashed market line buyers see — three to six spread over past months
 * gives a new model a credible fluctuation line before its first FlexSoar
 * sale. Writes through addMarketRefAction; the RLS policy is the real
 * guard, requireAdminAction() is the decent error.
 */
"use client";

import { useState, useTransition } from "react";
import { addMarketRefAction } from "@/app/admin/skus/actions";
import type { ActionResult } from "@/components/admin/action-result";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { UUID } from "@/lib/db/types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MarketRefForm({ modelId }: { modelId: UUID }) {
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today());
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const outcome = await addMarketRefAction({
        modelId,
        priceCents: Number(price),
        observedAt: date.trim() === "" ? null : date.trim(),
      });
      setResult(outcome);
      if (outcome.ok) {
        setPrice("");
        setDate(today());
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 border border-line bg-raised p-3">
      <h2 className="font-mono text-[13px] uppercase tracking-tight">
        Market reference
      </h2>
      <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
        Pin an observed market price onto this model&apos;s tape — an eBay
        sold listing, a checked market price. One dot per entry on the
        buyers&apos; chart; backfill older dates for history.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Price (cents)"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          inputMode="numeric"
          placeholder="26000"
          disabled={pending}
          hint="Integer MYR sen. 26000 = RM 260.00."
        />
        <Input
          label="Date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          disabled={pending}
          hint="Defaults to today. Older dates backfill history."
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={pending || price.trim() === ""}>
          {pending ? "Saving…" : "Add reference point"}
        </Button>
      </div>
      <div aria-live="polite">
        {result?.ok && (
          <p className="border border-accent bg-overlay p-2 font-mono text-[11px] tracking-tight text-accent">
            Pinned.
          </p>
        )}
        {result && !result.ok && (
          <p className="border border-[#FF4444] bg-overlay p-2 font-mono text-[11px] tracking-tight text-[#FF4444]">
            {result.message}
          </p>
        )}
      </div>
    </div>
  );
}
