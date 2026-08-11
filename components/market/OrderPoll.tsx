/**
 * components/market/OrderPoll.tsx
 *
 * The "your payment went through, the sale is being recorded" panel. After
 * Stripe Checkout the buyer lands back on the card with ?order=<listing id>;
 * this polls getListingForOrderAction until the webhook's fn_purchase_card has
 * stamped the order settled. The client never touches the contract.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getListingForOrderAction } from "@/app/(market)/actions";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import { formatFsc } from "@/components/card/format";

type Phase = "waiting" | "polling" | "settled" | "refused" | "lost";

const POLL_EVERY_MS = 2000;
const POLL_TRIES = 30;

export interface OrderPollProps {
  listingId: string;
  cardId: string;
  priceCents: number;
}

export function OrderPoll({ listingId, cardId, priceCents }: OrderPollProps) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [orderId, setOrderId] = useState<string | null>(null);
  const attempts = useRef(0);

  const poll = useCallback(async () => {
    const result = await getListingForOrderAction(listingId);
    if (!result) {
      setPhase("lost");
      return;
    }
    const status = result.orderStatus;
    if (status === "settled") {
      setOrderId(result.orderId);
      setPhase("settled");
    } else if (status === "refunded" || status === "failed") {
      setPhase("refused");
    } else if (attempts.current >= POLL_TRIES) {
      setPhase("waiting");
      attempts.current = 0;
    } else {
      setPhase("polling");
    }
  }, [listingId]);

  useEffect(() => {
    attempts.current = 0;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      await poll();
      if (cancelled) return;
      timer = window.setTimeout(tick, POLL_EVERY_MS);
    };

    timer = window.setTimeout(tick, 0);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [poll]);

  return (
    <div className="flex flex-col gap-3 border border-line bg-overlay p-3">
      {phase === "settled" ? (
        <>
          <Banner tone="success" title="Purchase settled">
            Your payment was recorded. {orderId ? `Order ${orderId.slice(0, 8)}…` : ""}
          </Banner>
          <div className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Paid {formatFsc(priceCents)} · the card is now yours
          </div>
          <Button href={`/card/${cardId}`} size="sm">
            View card
          </Button>
        </>
      ) : phase === "refused" ? (
        <Banner tone="error" title="Payment failed">
          The order did not settle. You were not charged.
        </Banner>
      ) : phase === "lost" ? (
        <Banner tone="error" title="Listing changed">
          This listing is no longer visible. You were not charged.
        </Banner>
      ) : (
        <>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-tight text-muted">
            <span
              aria-hidden
              className="inline-block h-2 w-2 animate-pulse bg-[#E8B33A]"
            />
            Waiting for payment to settle…
          </div>
          <p className="font-mono text-[9px] uppercase tracking-tight text-muted">
            Polling the ledger — the sale is recorded server-side by the
            webhook, not by this page.
          </p>
        </>
      )}
    </div>
  );
}