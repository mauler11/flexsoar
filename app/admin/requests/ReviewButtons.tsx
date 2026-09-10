"use client";

/**
 * app/admin/requests/ReviewButtons.tsx
 *
 * Approve / reject controls for one pending request. Optional note first
 * (rejections should say why); approve mints the model + variant server-side.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { reviewSkuRequestAction } from "@/app/admin/requests/actions";

export function ReviewButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function decide(decision: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const result = await reviewSkuRequestAction({
        requestId,
        decision,
        note,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="Note for the requester (optional, shown on reject)"
        aria-label="Review note"
        className="rounded-xl border border-line-strong bg-overlay px-2.5 py-2 text-[13px] text-foreground placeholder:text-muted/50"
      />
      {error && (
        <p role="alert" className="text-[13px] text-[#FF4444]">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => decide("approve")}
        >
          {isPending ? "Working…" : "Approve + create model"}
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={isPending}
          onClick={() => decide("reject")}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
