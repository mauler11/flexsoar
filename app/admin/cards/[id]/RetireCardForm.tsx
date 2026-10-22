"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

interface RetireCardFormProps {
  cardId: string;
  cardLabel: string;
}

export function RetireCardForm({ cardId, cardLabel }: RetireCardFormProps) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form onReset={() => setConfirmed(false)} action={async (formData: FormData) => {
      const reason = formData.get("reason") as string;
      const confirm = formData.get("confirm") === "on";
      if (!reason || !confirm) return;
      await import("./actions").then((m) => m.burnCardAction(cardId, reason));
    }}>
      <div className="border border-destructive/30 bg-destructive/5 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-bold text-destructive">
                Retire card (burn)
              </p>
              <p className="font-mono text-[10px] text-muted">
                {cardLabel}
              </p>
            </div>
            <Button
              type="submit"
              variant="danger"
              className="whitespace-nowrap"
              disabled={!confirmed}
            >
              Burn card
            </Button>
          </div>
          <p className="font-mono text-[10px] text-destructive/80 border-t border-destructive/20 pt-3">
            This action is IRREVERSIBLE. The card will be permanently burned and
            cannot be restored. A written reason is required for the audit trail.
          </p>
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="confirm"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1"
                required
              />
              <span className="font-mono text-[11px]">
                I understand this cannot be undone
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-tight text-muted">
                Reason (required)
              </span>
              <textarea
                name="reason"
                rows={3}
                required
                className="border border-line bg-input font-mono text-[11px] px-2 py-1.5 focus:border-accent focus:outline-none"
                placeholder="Explain why this card is being retired..."
              />
            </label>
          </div>
        </div>
    </form>
  );
}
