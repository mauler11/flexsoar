/**
 * components/admin/fulfilment/SellerHeldControls.tsx
 *
 * The two outcomes of a seller-held redemption, in one cell: they shipped it,
 * or they didn't.
 *
 * Deliberately NOT MarkShippedControl with an extra button. The confirm reads
 * differently on this side of the warehouse wall — shipping here credits the
 * seller's fulfilment count, and defaulting here marks a person rather than a
 * row — and a control whose copy is honest about that is worth more than one
 * component reused into vagueness. The shape and the failure panel do match
 * MarkShippedControl, because operators should not have to learn two.
 *
 * Both actions are terminal and mutually exclusive: `shipped_at` and
 * `defaulted_at` are each written once and neither can be cleared, so a
 * settled row gets no buttons at all.
 */
"use client";

import { useState, useTransition } from "react";
import {
  confirmShipmentAction,
  markDefaultAction,
} from "@/app/admin/fulfilment/actions";
import type { ActionResult } from "@/components/admin/action-result";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { UUID } from "@/lib/db/types";

export interface SellerHeldControlsProps {
  redemptionId: UUID;
  /** "brand model · US size · #mint", for the confirm text. */
  cardLabel: string;
  /** The seller who owes the parcel, for the confirm text. */
  sellerHandle: string;
  /** Days past due, or null when not overdue / no deadline on record. */
  daysOverdue: number | null;
}

export function SellerHeldControls({
  redemptionId,
  cardLabel,
  sellerHandle,
  daysOverdue,
}: SellerHeldControlsProps) {
  const [confirming, setConfirming] = useState<"ship" | "default" | null>(null);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const shipIncomplete = carrier.trim() === "" || tracking.trim() === "";
  const noteMissing = note.trim() === "";

  function close() {
    if (pending) return;
    setConfirming(null);
  }

  function confirmShip() {
    if (shipIncomplete) return;
    startTransition(async () => {
      const outcome = await confirmShipmentAction({
        redemptionId,
        carrier,
        tracking,
      });
      setResult(outcome);
      if (outcome.ok) setConfirming(null);
    });
  }

  function confirmDefault() {
    if (noteMissing) return;
    startTransition(async () => {
      const outcome = await markDefaultAction({ redemptionId, note });
      setResult(outcome);
      if (outcome.ok) setConfirming(null);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setConfirming("ship")}
          disabled={pending}
        >
          Confirm shipped
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => setConfirming("default")}
          disabled={pending}
        >
          Mark default
        </Button>
      </div>

      <div aria-live="polite">
        {result && !result.ok && (
          <div className="flex flex-col gap-1 border border-[#FF4444] bg-overlay p-2">
            <p className="font-mono text-[10px] uppercase tracking-tight text-[#FF4444]">
              Action failed{result.code ? ` — ${result.code}` : ""}
            </p>
            <p className="font-mono text-[11px] leading-snug tracking-tight text-foreground">
              {result.message}
            </p>
            {result.code === "WRONG_STATUS" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                This redemption was already settled — shipped or defaulted — by
                someone else since the page loaded. Reload to see which.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---- ship confirm ---- */}
      <Modal
        open={confirming === "ship"}
        onClose={close}
        title="Confirm seller shipment"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={confirmShip}
              disabled={pending || shipIncomplete}
            >
              {pending ? "Working…" : "Confirm shipped"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] leading-snug tracking-tight">
            {sellerHandle} shipped {cardLabel}. This stamps shipped_at and
            credits their fulfilment count — the count that unlocks cash payout.
            There is no un-ship.
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

      {/* ---- default confirm ---- */}
      <Modal
        open={confirming === "default"}
        onClose={close}
        title="Mark default"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={confirmDefault}
              disabled={pending || noteMissing}
            >
              {pending ? "Working…" : "Mark defaulted"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] leading-snug tracking-tight">
            Record that {sellerHandle} did not ship {cardLabel}
            {daysOverdue == null
              ? "."
              : ` — ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} past the deadline.`}
          </p>
          <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
            This marks the person, not just this row: their defaults count goes
            up, it feeds the restriction flag, and every submission of theirs
            carries it from here on. Nothing in this console reverses it.
          </p>
          <label
            htmlFor="default-note"
            className="font-mono text-[10px] uppercase tracking-tight text-muted"
          >
            Reason (required)
          </label>
          <textarea
            id="default-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            disabled={pending}
            placeholder="What was tried, and when. This is the record the seller is answered with."
            className="border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[12px] tracking-tight text-foreground placeholder:text-muted/50 pixel-shadow-sm hover:border-muted disabled:cursor-not-allowed disabled:opacity-40"
          />
          {result && !result.ok && (
            <p className="font-mono text-[11px] leading-snug tracking-tight text-[#FF4444]">
              {result.message}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
