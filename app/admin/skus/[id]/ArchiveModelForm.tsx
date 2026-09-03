"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { archiveSkuModelAction } from "@/app/admin/skus/[id]/actions";

interface ArchiveModelFormProps {
  modelId: string;
  modelLabel: string;
}

export function ArchiveModelForm({ modelId, modelLabel }: ArchiveModelFormProps) {
  const [confirmed, setConfirmed] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const reason = formData.get("reason") as string;
    const confirm = formData.get("confirm") === "on";
    if (!reason || !confirm) return;

    const result = await archiveSkuModelAction(modelId, reason);
    if (!result.ok) {
      alert(result.error ?? "Failed to archive model");
      return;
    }
    window.location.reload();
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="border border-destructive/30 bg-destructive/5 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-bold text-destructive">
              Archive model (retire)
            </p>
            <p className="font-mono text-[10px] text-muted">
              {modelLabel}
            </p>
          </div>
          <Button
            type="submit"
            variant="danger"
            className="whitespace-nowrap"
            disabled={!confirmed}
          >
            Archive model
          </Button>
        </div>
        <p className="font-mono text-[10px] text-destructive/80 border-t border-destructive/20 pt-3">
          This action is IRREVERSIBLE. The model and all its variants will be
          hidden from the catalog and cannot be used for new mints. Existing
          cards are unaffected. A written reason is required for the audit trail.
        </p>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="confirm"
              className="mt-1"
              required
              onChange={(e) => setConfirmed(e.target.checked)}
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
              placeholder="Explain why this model is being archived..."
            />
          </label>
        </div>
      </div>
    </form>
  );
}