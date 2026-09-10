"use client";

/**
 * components/market/OnboardingTour.tsx
 *
 * First-visit guide overlay: what FlexSoar is and how it works, in plain
 * terms, before the market can overwhelm. Arrows move through the slides;
 * only the last slide carries the Terms checkbox, and only a checked box
 * enables the Welcome button that dismisses the tour. Seen-state lives in
 * localStorage (per device) — there is no account to hang it on for
 * signed-out visitors, who are exactly who need the tour.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { TierBadge } from "@/components/card/TierBadge";
import { ConditionBadge } from "@/components/card/ConditionBadge";
import type { Tier } from "@/lib/db/types";
import type { FloatBand } from "@/lib/domain/rarity";

export const TOUR_STORAGE_KEY = "flexsoar-tour-seen-v1";

export function hasSeenTour(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTourSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    // Private mode etc. — the tour just shows again next visit.
  }
}

interface TourSlide {
  eyebrow: string;
  title: string;
  body: string;
  visual: React.ReactNode;
}

const CONDITION_BANDS: ReadonlyArray<{ band: FloatBand; label: string }> = [
  { band: "FN", label: "Factory New" },
  { band: "MW", label: "Minimal Wear" },
  { band: "FT", label: "Field-Tested" },
  { band: "WW", label: "Well Worn" },
  { band: "BS", label: "Battle-Scarred" },
];

const TIERS: ReadonlyArray<{ tier: Tier; name: string }> = [
  { tier: 1, name: "Common" },
  { tier: 2, name: "Uncommon" },
  { tier: 3, name: "Rare" },
  { tier: 4, name: "Epic" },
  { tier: 5, name: "Legendary" },
];

export const TOUR_SLIDES: readonly Omit<TourSlide, "visual">[] = [
  {
    eyebrow: "Welcome to FlexSoar",
    title: "Buy. Sell. Redeem.",
    body: "Tokenized sneakers backed by real pairs. Every card on the market represents physical shoes — nothing here is a picture of a shoe.",
  },
  {
    eyebrow: "How it works",
    title: "One card, one pair",
    body: "When a card is minted, exactly one physical pair is tied to it. Buy the card and you own the claim; the shoes sit in custody until you redeem them.",
  },
  {
    eyebrow: "Condition",
    title: "Graded, then labelled",
    body: "Every pair is graded from Factory New to Battle-Scarred. The badge on a card is a human grade, not a guess — it never changes after mint.",
  },
  {
    eyebrow: "Rarity",
    title: "Tier is value",
    body: "Tiers run Common to Legendary by market value — never by condition. A mint Common is still a Common. Red 1 OF 1 marks the exceptional few.",
  },
  {
    eyebrow: "Vaulted",
    title: "First sales freeze",
    body: "A first sale locks the card as pending vault until the physical shoe reaches us. The seller has 48 hours to ship — miss it and the sale cancels with a full refund to you.",
  },
  {
    eyebrow: "Redemption",
    title: "Claim the physical pair",
    body: "Own a card? Redeem it any time and the actual shoes ship to you for a handling fee. The card is destroyed; the shoes are yours.",
  },
  {
    eyebrow: "The fine print",
    title: "Agree to the Terms",
    body: "Cards are claims on physical sneakers, not investments. Prices are asks between people, and sales are final once the vault confirms receipt.",
  },
];

function SlideVisual({ index }: { index: number }) {
  switch (index) {
    case 0:
      return (
        <p className="text-4xl font-extrabold tracking-tight">
          Buy. <span className="text-accent">Sell.</span> Redeem.
        </p>
      );
    case 1:
      return <Badge tone="accent">1 card = 1 pair</Badge>;
    case 2:
      return (
        <div className="flex flex-wrap justify-center gap-1.5">
          {CONDITION_BANDS.map((c) => (
            <ConditionBadge key={c.band} band={c.band} label={c.label} />
          ))}
        </div>
      );
    case 3:
      return (
        <div className="flex flex-wrap justify-center gap-1.5">
          {TIERS.map((t) => (
            <TierBadge key={t.tier} tier={t.tier} />
          ))}
        </div>
      );
    case 4:
      return <Badge tone="info">Pending vault</Badge>;
    case 5:
      return <Badge tone="warn">Ships to you</Badge>;
    default:
      return null;
  }
}

export function OnboardingTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [agreed, setAgreed] = useState(false);

  // Client-side first-visit check after mount: prerendered HTML never
  // flashes the overlay at returning visitors.
  useEffect(() => {
    if (!hasSeenTour()) setVisible(true);
  }, []);

  const last = step === TOUR_SLIDES.length - 1;
  const slide = TOUR_SLIDES[step];

  return (
    <>
      {visible && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to FlexSoar"
        >
          <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-line bg-raised p-6 shadow-soft">
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl bg-overlay px-4 py-6 text-center">
              <SlideVisual index={step} />
            </div>

            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-accent">
                {slide.eyebrow}
              </p>
              <h2 className="mt-1 text-xl font-extrabold tracking-tight">
                {slide.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {slide.body}
              </p>
            </div>

            {last ? (
              <div className="flex flex-col gap-3">
                <label className="flex cursor-pointer items-start gap-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#35F07A]"
                  />
                  <span>
                    I agree to the{" "}
                    <Link href="/terms" className="text-accent hover:underline">
                      Terms of Service
                    </Link>
                  </span>
                </label>
                <button
                  type="button"
                  disabled={!agreed}
                  onClick={() => {
                    markTourSeen();
                    setVisible(false);
                  }}
                  className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-3 text-sm font-bold text-[#0B0B0B] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Welcome
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  disabled={step === 0}
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  aria-label="Previous slide"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong text-muted transition hover:border-muted hover:text-foreground disabled:opacity-30"
                >
                  ←
                </button>
                <div
                  className="flex items-center gap-1.5"
                  aria-label={`Slide ${step + 1} of ${TOUR_SLIDES.length}`}
                >
                  {TOUR_SLIDES.map((_, i) => (
                    <span
                      key={i}
                      aria-hidden="true"
                      className={
                        i === step
                          ? "h-1.5 w-5 rounded-full bg-accent"
                          : "h-1.5 w-1.5 rounded-full bg-line-strong"
                      }
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(TOUR_SLIDES.length - 1, s + 1))}
                  aria-label="Next slide"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong text-muted transition hover:border-muted hover:text-foreground"
                >
                  →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
