/**
 * components/admin/consignments/TransitionControls.tsx
 *
 * One button per legal edge out of the current status, each behind a confirm.
 *
 * Illegal edges are not rendered disabled-with-a-tooltip, they are not
 * rendered: the machine allows at most two moves from any status, so a row of
 * ten mostly-dead buttons would be noise. What the operator sees is what the
 * database will accept — the table is mirrored from the CASE block in
 * fn_advance_consignment.
 *
 * Failures are shown verbatim. A transition can fail for reasons this screen
 * cannot see (the row moved, the session is not admin), and the operator needs
 * the server's own words, not a paraphrase.
 */
"use client";

import { useState, useTransition } from "react";
import { advanceConsignmentAction } from "@/app/admin/consignments/actions";
import type { ActionResult } from "@/components/admin/action-result";
import {
  allowedTransitions,
  isDestructive,
  statusLabel,
} from "@/components/admin/consignments/transitions";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { ConsignmentStatus, UUID } from "@/lib/db/types";

export interface TransitionControlsProps {
  consignmentId: UUID;
  status: ConsignmentStatus;
}

export function TransitionControls({
  consignmentId,
  status,
}: TransitionControlsProps) {
  const [target, setTarget] = useState<ConsignmentStatus | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const edges = allowedTransitions(status);

  function open(to: ConsignmentStatus) {
    setTarget(to);
    setNote("");
    setResult(null);
  }

  function close() {
    if (pending) return;
    setTarget(null);
  }

  // A rejection is the one transition a consignor will be shown and will argue
  // with. It goes into an append-only event row, so it gets written once, now,
  // with a reason — the server action holds the same rule.
  const noteRequired = target === "rejected";
  const noteMissing = noteRequired && note.trim() === "";

  function confirm() {
    if (!target || noteMissing) return;
    startTransition(async () => {
      const outcome = await advanceConsignmentAction({
        consignmentId,
        from: status,
        to: target,
        note,
      });
      setResult(outcome);
      if (outcome.ok) setTarget(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {edges.length === 0 ? (
        <p className="font-mono text-[10px] tracking-tight text-muted">
          {statusLabel(status)} is terminal — nothing moves a consignment out of
          it.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {edges.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={isDestructive(to) ? "danger" : "secondary"}
              onClick={() => open(to)}
              disabled={pending}
            >
              {statusLabel(to)}
            </Button>
          ))}
        </div>
      )}

      {/* Failures survive the modal closing, so they stay readable. */}
      <div aria-live="polite">
        {result && !result.ok && (
          <div className="flex flex-col gap-1 border border-[#FF4444] bg-overlay p-2">
            <p className="font-mono text-[10px] uppercase tracking-tight text-[#FF4444]">
              Transition failed{result.code ? ` — ${result.code}` : ""}
            </p>
            <p className="font-mono text-[11px] leading-snug tracking-tight text-foreground">
              {result.message}
            </p>
          </div>
        )}
      </div>

      <Modal
        open={target !== null}
        onClose={close}
        title={
          target ? `${statusLabel(status)} → ${statusLabel(target)}` : undefined
        }
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={target && isDestructive(target) ? "danger" : "primary"}
              onClick={confirm}
              disabled={pending || noteMissing}
            >
              {pending ? "Working…" : "Confirm"}
            </Button>
          </>
        }
      >
        {target && (
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11px] leading-snug tracking-tight">
              Move this consignment to{" "}
              <span className="font-bold">{statusLabel(target)}</span>.
            </p>
            <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
              {isDestructive(target)
                ? "This cannot be undone from the admin UI — the state machine has no edge back."
                : "This writes a consignment_events row that cannot be deleted."}
            </p>

            <label
              htmlFor="transition-note"
              className="font-mono text-[10px] uppercase tracking-tight text-muted"
            >
              Note {noteRequired ? "(required)" : "(optional)"}
            </label>
            <textarea
              id="transition-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder={
                noteRequired
                  ? "Why is this being rejected? The consignor may be shown this."
                  : "Recorded against the event."
              }
              className="border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[12px] tracking-tight text-foreground placeholder:text-muted/50 pixel-shadow-sm hover:border-muted"
            />

            {result && !result.ok && (
              <p className="font-mono text-[11px] leading-snug tracking-tight text-[#FF4444]">
                {result.message}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
