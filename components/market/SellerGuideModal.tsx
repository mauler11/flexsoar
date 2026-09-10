"use client";

/**
 * components/market/SellerGuideModal.tsx
 *
 * SELLER GUIDE popup: how selling on FlexSoar actually works — submit with
 * photos, authentication, listing goes live, ship in 48h on sale, payout
 * after the clearing hold, fees by level. Written from the real flow
 * (TERMS.md), not marketplace boilerplate.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "1. Submit your pair",
    body: "Pick your size, upload 4+ photos, grade honestly, set your price. Your submission goes to review — nothing lists until it passes.",
  },
  {
    title: "2. We authenticate",
    body: "A grader verifies the shoe against your photos. Approved submissions mint a card and the listing goes live on the market.",
  },
  {
    title: "3. Ship within 48 hours when it sells",
    body: "A sale locks the card and starts your clock. Arrange tracked courier at your own cost — miss the window and the sale is cancelled, the buyer refunded, and your account restricted.",
  },
  {
    title: "4. Get paid after the hold clears",
    body: "Payout is price minus your level fee, released after the 7-day clearing hold once the vault confirms receipt. Malaysian sellers are paid cash to bank; everyone else earns FSC credit.",
  },
  {
    title: "5. Sell more, pay less",
    body: "Every sale earns XP. Higher levels cut your seller fee, so volume directly raises your margins.",
  },
];

export function SellerGuideButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[13px] font-bold uppercase tracking-wide text-accent hover:underline"
      >
        Seller guide
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Seller guide"
        className="max-w-lg"
        footer={
          <Button variant="secondary" size="md" href="/terms">
            Read the full terms
          </Button>
        }
      >
          <div className="flex flex-col gap-4">
            {STEPS.map((step) => (
              <div key={step.title}>
                <h3 className="text-sm font-extrabold tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
      </Modal>
    </>
  );
}
