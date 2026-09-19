"use client";

/**
 * components/market/RedeemForm.tsx
 *
 * The owner's physical redemption: a "Redeem Card" button opening a popup.
 * Step 1 takes the Malaysian shipping address (country locked — quotes
 * cover MY postcodes only). Step 2 shows the frozen quote — zone courier
 * rate plus the live handling fee — and Confirm & Pay redirects to a
 * Stripe Checkout for exactly that total. Nothing burns until payment is
 * verified on return (completeRedemptionAction); bailing at Stripe costs
 * nothing. The card burns and the confirmation email sends only after.
 */

import { useState, useTransition } from "react";
import {
  completeRedemptionAction,
  createRedemptionCheckoutAction,
  getRedemptionQuoteAction,
  type RedemptionQuote,
} from "@/app/(market)/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Banner } from "@/components/market/Banner";
import { Modal } from "@/components/market/Modal";
import { formatMyr } from "@/components/card/format";

export function RedeemButton({ cardId }: { cardId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="lg"
        onClick={() => setOpen(true)}
        className="w-full py-3 text-base"
      >
        Redeem Card
      </Button>
      {open && (
        <Modal onClose={() => setOpen(false)} closeLabel="Close redemption" panelClassName="max-w-lg">
          <RedeemModal cardId={cardId} onClose={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}

function RedeemModal({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const [step, setStep] = useState<"address" | "quote">("address");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<RedemptionQuote | null>(null);

  const [recipientName, setRecipientName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [phone, setPhone] = useState("");

  function requestQuote() {
    if (!recipientName.trim() || !line1.trim() || !city.trim() || !postalCode.trim()) {
      setError("Recipient name, address line 1, city and postal code are required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await getRedemptionQuoteAction(postalCode.trim());
      if (!result.ok) {
        setError(result.message ?? "Shipping quote failed.");
        return;
      }
      setQuote(result.quote);
      setStep("quote");
    });
  }

  function pay() {
    setError(null);
    const data = new FormData();
    data.set("card_id", cardId);
    data.set("recipient_name", recipientName);
    data.set("line1", line1);
    data.set("line2", line2);
    data.set("city", city);
    data.set("state", stateName);
    data.set("postal_code", postalCode);
    data.set("phone", phone);
    // Server action redirects: to Stripe on success, back to the card with
    // ?error= on failure. No client navigation here.
    startTransition(() => createRedemptionCheckoutAction(data));
  }

  return (
    <div className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Redeem physical pair</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-lg leading-none text-muted transition hover:text-foreground"
        >
          ×
        </button>
      </div>

      {step === "address" ? (
        <>
          <p className="text-[13px] leading-snug text-muted">
            Ships anywhere in Malaysia from Damansara Damai. The card claim
            burns and the shoes ship to you.
          </p>
          <div className="flex flex-col gap-2">
            <Input
              label="Recipient name"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              disabled={pending}
            />
            <Input
              label="Address line 1"
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              disabled={pending}
            />
            <Input
              label="Address line 2 (optional)"
              value={line2}
              onChange={(e) => setLine2(e.target.value)}
              disabled={pending}
              aria-required={false}
            />
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                label="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={pending}
              />
              <Input
                label="State"
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                disabled={pending}
              />
              <Input
                label="Postcode"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                disabled={pending}
                inputMode="numeric"
                placeholder="e.g. 47830"
              />
            </div>
            <Input
              label="Phone (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={pending}
            />
          </div>
          {error && <Banner tone="error" title={error} />}
          <Button
            type="button"
            size="lg"
            disabled={pending}
            onClick={requestQuote}
            className="py-3 text-base"
          >
            {pending ? "Quoting…" : "See shipping quote"}
          </Button>
        </>
      ) : (
        quote && (
          <>
            <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-background p-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted">Shipping · {quote.zoneName}</span>
                <span className="font-semibold">{formatMyr(quote.rateCents)}</span>
              </div>
              {quote.handlingCents > 0 ? (
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted">Handling fee</span>
                  <span className="font-semibold">{formatMyr(quote.handlingCents)}</span>
                </div>
              ) : (
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted">Handling fee</span>
                  <span className="font-semibold text-accent">Free</span>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-line pt-2 text-sm font-bold">
                <span>You pay</span>
                <span>{formatMyr(quote.totalCents)}</span>
              </div>
              <p className="text-[11px] leading-snug text-muted">
                {quote.etaNote}. Ships to {recipientName.trim()}, {postalCode.trim()}{" "}
                {city.trim()}. One pair, boxed, up to 2kg billable.
              </p>
            </div>
            {error && <Banner tone="error" title={error} />}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setStep("address");
                }}
                className="py-3 text-base"
              >
                Back
              </Button>
              <Button
                type="button"
                size="lg"
                disabled={pending}
                onClick={pay}
                className="flex-1 py-3 text-base"
              >
                {pending ? "Redirecting…" : `Confirm & Pay ${formatMyr(quote.totalCents)}`}
              </Button>
            </div>
          </>
        )
      )}
    </div>
  );
}

/**
 * Rendered on the card page after Stripe returns
 * (?shipping=paid&session_id=…): one button completes the redemption —
 * verifies payment server-side, burns, emails. Idempotent; safe to retry.
 */
export function CompleteRedemption({
  cardId,
  sessionId,
}: {
  cardId: string;
  sessionId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    ok: boolean;
    message?: string;
    mailed?: boolean;
    mailError?: string;
  } | null>(null);

  function complete() {
    startTransition(async () => {
      setResult(await completeRedemptionAction(sessionId, cardId));
    });
  }

  if (result?.ok) {
    return (
      <div className="flex flex-col gap-2">
        <Banner tone="success" title="Redemption requested">
          Payment confirmed — the card claim is burned and the physical
          shoes are being prepared for shipping.
        </Banner>
        {result.mailed === false && (
          <Banner tone="warn" title="Confirmation email didn't send">
            {result.mailError ?? "Email failed."} Your redemption still went
            through — contact support if you need the receipt re-sent.
          </Banner>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-accent/60 bg-accent/5 p-4">
      <p className="text-sm font-semibold">
        Payment received — tap once to burn the claim and request shipping.
      </p>
      {result && !result.ok && (
        <Banner tone="error" title="Couldn't complete it">
          {result.message ?? "Unknown error."}
        </Banner>
      )}
      <Button
        type="button"
        size="lg"
        disabled={pending}
        onClick={complete}
        className="py-3 text-base"
      >
        {pending ? "Completing…" : "Complete redemption"}
      </Button>
    </div>
  );
}
