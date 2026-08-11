/**
 * components/admin/fulfilment/MarkShippedControl.tsx
 *
 * Carrier + tracking entry behind a confirm. Shipping is the physical exit of
 * the pipeline — fn_mark_shipped writes shipped_at once and moves the item to
 * `shipped`, and there is no un-ship — so it confirms like every other
 * irreversible step.
 *
 * WRONG_STATUS gets a sentence of context (someone else shipped it between
 * page load and click); everything else shows the server's words verbatim.
 */
"use client";

import { useState, useTransition } from "react";
import { markShippedAction } from "@/app/admin/fulfilment/actions";
import type { ActionResult } from "@/components/admin/action-result";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { UUID } from "@/lib/db/types";

export interface MarkShippedControlProps {
  redemptionId: UUID;
  /** "brand model · US size", for the confirm text. */
  cardLabel: string;
}

export function MarkShippedControl({
  redemptionId,
  cardLabel,
}: MarkShippedControlProps) {
  const [open, setOpen] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const incomplete = carrier.trim() === "" || tracking.trim() === "";

  function close() {
    if (pending) return;
    setOpen(false);
  }

  function confirm() {
    if (incomplete) return;
    startTransition(async () => {
      const outcome = await markShippedAction({ redemptionId, carrier, tracking });
      setResult(outcome);
      if (outcome.ok) setOpen(false);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={pending}>
        Mark shipped
      </Button>

      <div aria-live="polite">
        {result && !result.ok && (
          <div className="flex flex-col gap-1 border border-[#FF4444] bg-overlay p-2">
            <p className="font-mono text-[10px] uppercase tracking-tight text-[#FF4444]">
              Ship failed{result.code ? ` — ${result.code}` : ""}
            </p>
            <p className="font-mono text-[11px] leading-snug tracking-tight text-foreground">
              {result.message}
            </p>
            {result.code === "WRONG_STATUS" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                Most likely already shipped by someone else since this page
                loaded — reload to see the tracking they entered.
              </p>
            )}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={close}
        title="Mark shipped"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirm} disabled={pending || incomplete}>
              {pending ? "Working…" : "Confirm shipped"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] leading-snug tracking-tight">
            Ship {cardLabel}. This stamps shipped_at and moves the item out of
            custody — there is no un-ship.
          </p>
          <Input
            label="Carrier (required)"
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
            placeholder="e.g. DHL, Pos Laju"
            disabled={pending}
          />
          <Input
            label="Tracking number (required)"
            value={tracking}
            onChange={(event) => setTracking(event.target.value)}
            placeholder="What the redeemer will be shown"
            disabled={pending}
          />
        </div>
      </Modal>
    </div>
  );
}
