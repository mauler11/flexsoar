/**
 * components/admin/submissions/DecisionControls.tsx
 *
 * Approve and reject, side by side on the review bench — the same shape as the
 * grading bench's ItemActions, because they are the same kind of decision:
 * both confirm, both are irreversible, and both write something a real person
 * is shown afterwards.
 *
 * APPROVE IS THE HEAVIER ONE and the copy says so. It does three things in one
 * transaction — takes the shoe into custody on paper, mints a card carrying
 * the seller's declared float forever, and publishes it for sale — and none of
 * the three can be undone from this console. The confirm spells out all three
 * rather than saying "are you sure".
 *
 * Price is typed in integer cents, matching SkuForm exactly. It is the one
 * number on this screen that is a decision rather than a reading, so it is
 * seeded from the seller's asking price and then left alone: prefilled, not
 * enforced.
 */
"use client";

import { useState, useTransition } from "react";
import {
  approveSubmissionAction,
  rejectSubmissionAction,
} from "@/app/admin/submissions/actions";
import type { ActionResult } from "@/components/admin/action-result";
import { formatUsd } from "@/components/card/format";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { Cents, UUID } from "@/lib/db/types";

export interface DecisionControlsProps {
  itemId: UUID;
  /** "brand model · colorway · US size", for the confirm text. */
  itemLabel: string;
  /** Seeds the price field. */
  askingPriceCents: Cents | null;
  /** The SKU's oracle price, shown beside the field as a sanity check. */
  marketPriceCents: Cents | null;
  /** Blocks both actions with the reason shown (e.g. no longer pending). */
  blocked?: string | null;
}

function parseCents(raw: string): { ok: true; cents: number } | { ok: false; error: string } {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "required" };
  if (!/^\d+$/.test(text)) {
    return { ok: false, error: "integer cents only — 18999, never 189.99" };
  }
  const cents = Number(text);
  if (cents <= 0) {
    return { ok: false, error: "a listing needs a price above zero" };
  }
  if (!Number.isSafeInteger(cents)) {
    return { ok: false, error: "that is not a price" };
  }
  return { ok: true, cents };
}

/**
 * Exported so tests can reach this directly: both price texts render only
 * inside the approve confirm modal, which a static render never opens (no
 * jsdom in this suite to click "Approve and publish"), so the string has to
 * be testable on its own rather than through a DOM assertion.
 */
export function oracleHint(marketPriceCents: Cents | null): string {
  return marketPriceCents == null
    ? "Integer USD cents. 18999 = $189.99."
    : `Integer USD cents. SKU oracle price is ${formatUsd(marketPriceCents)}.`;
}

/** Same reasoning as oracleHint above. */
export function askingNote(askingPriceCents: Cents | null): string | null {
  return askingPriceCents == null
    ? null
    : `Seller asked ${formatUsd(askingPriceCents)}. Prefilled, not binding.`;
}

export function DecisionControls({
  itemId,
  itemLabel,
  askingPriceCents,
  marketPriceCents,
  blocked,
}: DecisionControlsProps) {
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null);
  const [price, setPrice] = useState(
    askingPriceCents == null ? "" : String(askingPriceCents),
  );
  const [fairPrice, setFairPrice] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseCents(price);
  const reasonMissing = reason.trim() === "";

  function close() {
    if (pending) return;
    setConfirming(null);
  }

  function confirmApprove() {
    if (!parsed.ok) return;
    const fairParsed = fairPrice.trim() === "" ? { ok: true as const, cents: null } : parseCents(fairPrice);
    if (!fairParsed.ok) return;
    startTransition(async () => {
      const outcome = await approveSubmissionAction({
        itemId,
        priceCents: parsed.cents,
        fairPriceCents: fairParsed.cents ?? undefined,
      });
      setResult(outcome);
      if (outcome.ok) setConfirming(null);
    });
  }

  function confirmReject() {
    if (reasonMissing) return;
    startTransition(async () => {
      const outcome = await rejectSubmissionAction({ itemId, reason });
      setResult(outcome);
      if (outcome.ok) setConfirming(null);
    });
  }

  return (
    <div className="flex flex-col gap-2 border border-line bg-raised p-3">
      <h2 className="font-mono text-[13px] uppercase tracking-tight">
        Decision
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => setConfirming("approve")}
          disabled={pending || Boolean(blocked)}
          title={blocked ?? undefined}
        >
          Approve and publish
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => setConfirming("reject")}
          disabled={pending || Boolean(blocked)}
          title={blocked ?? undefined}
        >
          Reject
        </Button>
      </div>

      {blocked && (
        <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
          {blocked}
        </p>
      )}

      <div aria-live="polite">
        {result && !result.ok && (
          <div className="flex flex-col gap-1 border border-[#FF4444] bg-overlay p-2">
            <p className="font-mono text-[10px] uppercase tracking-tight text-[#FF4444]">
              Decision failed{result.code ? ` — ${result.code}` : ""}
            </p>
            <p className="font-mono text-[11px] leading-snug tracking-tight text-foreground">
              {result.message}
            </p>
            {result.code === "WRONG_STATUS" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                This submission was most likely decided by someone else since
                the page loaded — reload to see what they did.
              </p>
            )}
            {result.code === "NOT_GRADED" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                The row carries no float, so there is nothing to mint. A
                submission with no declared components cannot be approved —
                reject it and ask the seller to grade it.
              </p>
            )}
            {result.code === "NO_ORACLE_PRICE" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                Tier comes from the SKU&apos;s market price and this SKU has
                none. Set an oracle price on the SKU first, then approve.
              </p>
            )}
            {result.code === "MINT_CAP_REACHED" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                This SKU is at its mint cap. Raising the cap is a catalog
                decision, on the SKU screen.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---- approve confirm ---- */}
      <Modal
        open={confirming === "approve"}
        onClose={close}
        title="Approve and publish"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={confirmApprove}
              disabled={pending || !parsed.ok || (fairPrice.trim() !== "" && !parseCents(fairPrice).ok)}
            >
              {pending ? "Working…" : "Mint and publish"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] leading-snug tracking-tight">
            Accept {itemLabel}. One transaction, three permanent things:
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-4 font-mono text-[11px] leading-snug tracking-tight text-muted">
            <li>the item is taken into custody and stamped authentic;</li>
            <li>
              a card is minted carrying the seller&apos;s declared float — float
              is immutable after mint, and nothing here can re-grade it;
            </li>
            <li>the card is listed publicly at the price below.</li>
          </ul>
          <Input
            label="Listing price (cents)"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="numeric"
            placeholder="18999"
            disabled={pending}
            error={price.trim() === "" ? null : parsed.ok ? null : parsed.error}
            hint={oracleHint(marketPriceCents)}
          />
          <Input
            label="Fair price (cents, optional)"
            value={fairPrice}
            onChange={(event) => setFairPrice(event.target.value)}
            inputMode="numeric"
            placeholder="Leave blank to omit"
            disabled={pending}
            error={fairPrice.trim() === "" ? null : parseCents(fairPrice).ok ? null : (parseCents(fairPrice) as { ok: false; error: string }).error}
            hint="Admin-set fair price for this card's condition. Shown to buyers as 'Fair: $X'."
          />
          {askingNote(askingPriceCents) && (
            <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
              {askingNote(askingPriceCents)}
            </p>
          )}
        </div>
      </Modal>

      {/* ---- reject confirm ---- */}
      <Modal
        open={confirming === "reject"}
        onClose={close}
        title="Reject submission"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={confirmReject}
              disabled={pending || reasonMissing}
            >
              {pending ? "Working…" : "Reject submission"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] leading-snug tracking-tight">
            Decline {itemLabel}. Nothing is minted and the seller keeps the
            shoe. There is no way back from returned_to_consignor.
          </p>
          <label
            htmlFor="submission-reject-reason"
            className="font-mono text-[10px] uppercase tracking-tight text-muted"
          >
            Reason (required)
          </label>
          <textarea
            id="submission-reject-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            disabled={pending}
            placeholder="Written for the seller — it lands in the permanent record."
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
