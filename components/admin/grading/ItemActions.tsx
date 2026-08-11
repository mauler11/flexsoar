/**
 * components/admin/grading/ItemActions.tsx
 *
 * Authenticate and reject, side by side on the item page.
 *
 * "Authenticate toggle" is the spec's phrase, but the machine has no
 * un-authenticate: fn_authenticate_item stamps authenticated_at/by and nothing
 * clears it. So an unauthenticated item gets the confirm-and-stamp flow, and
 * an authenticated one shows who and when, immutably. Rendering a switch that
 * can only move one way would be a lie.
 *
 * Reject is the destructive arm — returned_to_consignor has no way back — so
 * it confirms, requires a reason, and is styled as danger. The reason lands in
 * grading_notes as a permanent `REJECTED: …` line the consignor can be shown.
 */
"use client";

import { useState, useTransition } from "react";
import {
  authenticateItemAction,
  rejectItemAction,
} from "@/app/admin/grading/actions";
import type { ActionResult } from "@/components/admin/action-result";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { UUID } from "@/lib/db/types";

export interface ItemActionsProps {
  itemId: UUID;
  authenticatedAt: string | null;
  custodyLocation: string | null;
  /** Blocks both actions with the reason shown (e.g. already minted). */
  blocked?: string | null;
}

export function ItemActions({
  itemId,
  authenticatedAt,
  custodyLocation,
  blocked,
}: ItemActionsProps) {
  const [confirming, setConfirming] = useState<"authenticate" | "reject" | null>(null);
  const [location, setLocation] = useState(custodyLocation ?? "");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setConfirming(null);
  }

  function confirmAuthenticate() {
    startTransition(async () => {
      const outcome = await authenticateItemAction({ itemId, location });
      setResult(outcome);
      if (outcome.ok) setConfirming(null);
    });
  }

  const reasonMissing = reason.trim() === "";

  function confirmReject() {
    if (reasonMissing) return;
    startTransition(async () => {
      const outcome = await rejectItemAction({ itemId, reason });
      setResult(outcome);
      if (outcome.ok) setConfirming(null);
    });
  }

  return (
    <div className="flex flex-col gap-2 border border-line bg-raised p-3">
      <h2 className="font-mono text-[13px] uppercase tracking-tight">
        Authentication
      </h2>

      {authenticatedAt ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Authentic</Badge>
          <span className="font-mono text-[10px] tracking-tight text-muted">
            stamped {new Date(authenticatedAt).toISOString().replace("T", " ").slice(0, 16)}
            {custodyLocation ? ` · held at ${custodyLocation}` : ""} — a stamp,
            not a toggle; there is no un-authenticate.
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setConfirming("authenticate")}
            disabled={pending || Boolean(blocked)}
            title={blocked ?? undefined}
          >
            Mark authentic
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
          {blocked && (
            <span className="font-mono text-[10px] tracking-tight text-muted">
              {blocked}
            </span>
          )}
        </div>
      )}

      <div aria-live="polite">
        {result && !result.ok && (
          <div className="flex flex-col gap-1 border border-[#FF4444] bg-overlay p-2">
            <p className="font-mono text-[10px] uppercase tracking-tight text-[#FF4444]">
              Action failed{result.code ? ` — ${result.code}` : ""}
            </p>
            <p className="font-mono text-[11px] leading-snug tracking-tight text-foreground">
              {result.message}
            </p>
          </div>
        )}
      </div>

      {/* ---- authenticate confirm ---- */}
      <Modal
        open={confirming === "authenticate"}
        onClose={close}
        title="Mark authentic"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmAuthenticate} disabled={pending}>
              {pending ? "Working…" : "Confirm"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] leading-snug tracking-tight">
            Stamp this item authentic under your account. This cannot be undone
            from the admin UI.
          </p>
          <Input
            label="Custody location (optional)"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="e.g. KL vault, shelf 4"
            disabled={pending}
          />
        </div>
      </Modal>

      {/* ---- reject confirm ---- */}
      <Modal
        open={confirming === "reject"}
        onClose={close}
        title="Reject item"
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
              {pending ? "Working…" : "Reject and return"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] leading-snug tracking-tight">
            Fail authentication and return this item to the consignor. There is
            no way back from returned_to_consignor.
          </p>
          <label
            htmlFor="reject-reason"
            className="font-mono text-[10px] uppercase tracking-tight text-muted"
          >
            Reason (required)
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            disabled={pending}
            placeholder="Written for the consignor — it lands in the permanent record."
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
