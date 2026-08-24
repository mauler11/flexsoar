"use client";

/**
 * components/market/intake/IntakeWizard.tsx
 *
 * The self-serve listing wizard: SKU -> photos -> condition -> price/payout ->
 * review & submit. Pure client state, everything built from the server page's
 * props (the live SKU catalog + payout eligibility), everything written
 * through the actions in app/(market)/list.
 *
 * The submit renders an "in review" promise — tracked by the seller
 * dashboard — because the intake RPC (handoff M1) is what turns the submission
 * into a held item. Until it's shipped, submit returns INTAKE_NOT_WIRED and
 * nothing is recorded.
 */

import { useMemo, useState, useTransition } from "react";
import type { Sku } from "@/lib/db/types";
import { Button } from "@/components/ui/Button";
import { SkuPicker } from "@/components/market/intake/SkuPicker";
import { SkuRequestForm } from "@/components/market/intake/SkuRequestForm";
import { PhotoUploader } from "@/components/market/intake/PhotoUploader";
import { ConditionWizard } from "@/components/market/intake/ConditionWizard";
import { PricePayout } from "@/components/market/intake/PricePayout";
import {
  CONDITION_QUESTIONS,
  REQUIRED_PHOTO_COUNT,
  type IntakePhoto,
  type PayoutMethod,
} from "@/components/market/intake/intake-config";
import {
  submitListingIntakeAction,
  type PayoutEligibility,
} from "@/app/(market)/list/actions";
import type { GradeComponents } from "@/lib/db/grading";
import { gradeFloatFromComponents } from "@/lib/db/grading";
import { formatUsd } from "@/components/card/format";

export interface IntakeWizardProps {
  skus: readonly Sku[];
  payoutEligibility: PayoutEligibility | null;
  signedIn: boolean;
  /**
   * How THIS seller is actually paid — fn_payout_method_for_user, derived
   * from their country. Distinct from `payout` (the buyer settlement method
   * this listing accepts, chosen in PricePayout below): this is the seller's
   * own payout route and is never a choice. Null when signed out.
   */
  sellerPayoutMethod?: "cash" | "credit" | null;
}

const STEPS = ["SKU", "Photos", "Condition", "Price", "Review"] as const;
type StepIndex = number;

export function IntakeWizard({
  skus,
  payoutEligibility,
  signedIn,
  sellerPayoutMethod,
}: IntakeWizardProps) {
  const [step, setStep] = useState<StepIndex>(0);
  const [selectedSku, setSelectedSku] = useState<Sku | null>(null);
  const [requestingMissing, setRequestingMissing] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<IntakePhoto[]>([]);
  const [answers, setAnswers] = useState<Partial<GradeComponents>>({});
  const [priceCents, setPriceCents] = useState<number | null>(null);
  const [payout, setPayout] = useState<PayoutMethod | null>(null);
  const [notes, setNotes] = useState("");
  const [submit, setSubmit] = useState<{
    state: "idle" | "running" | "done";
    itemId: string | null;
    error: string | null;
  }>({ state: "idle", itemId: null, error: null });
  const [isPending, startTransition] = useTransition();

  const declaredFloat = useMemo(() => {
    if (!CONDITION_QUESTIONS.every((q) => answers[q.key] != null)) return null;
    return gradeFloatFromComponents(answers as GradeComponents);
  }, [answers]);

  const canNext = (() => {
    switch (step) {
      case 0: return selectedSku != null || requestingMissing;
      case 1: return photos.filter((p) => p.url.startsWith("https://")).length >= REQUIRED_PHOTO_COUNT;
      case 2: return declaredFloat != null;
      case 3:
        return (
          priceCents != null &&
          priceCents > 0 &&
          payout != null &&
          (payout !== "cash" || payoutEligibility?.cashEligible === true)
        );
      default: return true;
    }
  })();

  function next() {
    if (!canNext) return;
    setSubmit({ state: "idle", itemId: null, error: null });
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function doSubmit() {
    if (!selectedSku || payout == null || priceCents == null) return;
    setSubmit({ state: "running", itemId: null, error: null });
    const formData = new FormData();
    formData.set("sku_id", selectedSku.id);
    formData.set("photos", JSON.stringify(photos));
    formData.set("components", JSON.stringify(answers));
    formData.set("reserve_price_cents", String(priceCents));
    formData.set("payout_method", payout);
    formData.set("notes", notes);

    startTransition(async () => {
      const result = await submitListingIntakeAction(formData);
      if (!result.ok) {
        setSubmit({ state: "idle", itemId: null, error: result.message });
        return;
      }
      setSubmit({ state: "done", itemId: result.itemId, error: null });
    });
  }

  if (submit.state === "done") {
    return <DoneState sku={selectedSku} itemId={submit.itemId} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-1.5 border border-line-strong bg-overlay p-2">
        {STEPS.map((label, i) => {
          const active = i === step;
          const reached = i <= step || (i < step && canStepReached(i));
          return (
            <li key={label} className="flex items-center gap-1.5">
              <Button
                variant={active ? "primary" : reached && i < step ? "secondary" : "ghost"}
                size="sm"
                onClick={() => i < step && setStep(i)}
              >
                {i + 1}. {label}
              </Button>
              {i < STEPS.length - 1 && (
                <span className="font-mono text-[9px] text-muted">/</span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Steps */}
      {step === 0 &&
        (requestingMissing ? (
          <SkuRequestForm
            initialBrand={selectedSku?.brand}
            initialModel={selectedSku?.model}
            onDone={(id) => {
              setRequestId(id);
              setRequestingMissing(false);
            }}
            onBack={() => setRequestingMissing(false)}
          />
        ) : (
          <SkuPicker
            skus={skus}
            selected={selectedSku}
            onSelect={(sku) => setSelectedSku(sku)}
            onRequestMissing={() => setRequestingMissing(true)}
          />
        ))}

      {step === 1 && (
        <>
          <PhotoUploader onChange={setPhotos} />
          <div className="border-t border-line-strong pt-2 font-mono text-[10px] tracking-tight text-muted">
            Live at intake review — a grader verifies against your uploads.
          </div>
        </>
      )}

      {step === 2 && <ConditionWizard answers={answers} onChange={setAnswers} />}

      {step === 3 && (
        <PricePayout
          sku={selectedSku!}
          declaredFloat={declaredFloat}
          priceCents={priceCents}
          onPriceChange={setPriceCents}
          payout={payout}
          onPayoutChange={setPayout}
          eligibility={payoutEligibility}
          sellerPayoutMethod={sellerPayoutMethod}
        />
      )}

      {step === 4 && (
        <ReviewPane
          sku={selectedSku!}
          photos={photos}
          declaredFloat={declaredFloat!}
          priceCents={priceCents!}
          payout={payout!}
          payoutEligibility={payoutEligibility}
          notes={notes}
          onNotesChange={setNotes}
          error={submit.error}
        />
      )}

      {!signedIn && step > 0 && (
        <div className="border border-dashed border-[#E8B33A]/60 bg-[#E8B33A]/5 px-3 py-2 font-mono text-[10px] tracking-tight text-muted">
          You&apos;re not signed in — submit will require an account.
        </div>
      )}

      {requestId && step === 0 && !requestingMissing && (
        <div className="border border-dashed border-accent/50 bg-accent/5 px-3 py-2 font-mono text-[10px] tracking-tight text-foreground">
          Request filed ({requestId}) — we&apos;ll notify you when the SKU is
          priced. Pick a listed shoe above or keep browsing.
        </div>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between border-t border-line-strong pt-3">
        <Button variant="ghost" size="md" onClick={back} disabled={step === 0}>
          back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" size="md" onClick={next} disabled={!canNext}>
            {step === 1
              ? `next · ${photos.filter((p) => p.url.startsWith("https://")).length}/${REQUIRED_PHOTO_COUNT} photos`
              : step === 2 && !canNext
                ? "next · answer all six"
                : "next"}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onClick={doSubmit}
            disabled={submit.state === "running" || isPending}
          >
            {submit.state === "running" || isPending ? "submitting…" : "submit in review"}
          </Button>
        )}
      </div>
    </div>
  );

  function canStepReached(i: number): boolean {
    if (i === 0) return selectedSku != null || requestingMissing;
    if (i === 1)
      return photos.filter((p) => p.url.startsWith("https://")).length >= REQUIRED_PHOTO_COUNT;
    if (i === 2) return declaredFloat != null;
    return true;
  }
}

function ReviewPane({
  sku,
  photos,
  declaredFloat,
  priceCents,
  payout,
  payoutEligibility,
  notes,
  onNotesChange,
  error,
}: {
  sku: Sku;
  photos: IntakePhoto[];
  declaredFloat: number;
  priceCents: number;
  payout: PayoutMethod;
  payoutEligibility: PayoutEligibility | null;
  notes: string;
  onNotesChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Detail label="Shoe" value={`${sku.brand} ${sku.model} · ${sku.colorway} · US ${sku.size_us}`} />
        <Detail
          label="Photos"
          value={`${photos.filter((p) => p.url.startsWith("https://")).length} uploaded (${REQUIRED_PHOTO_COUNT} required)`}
        />
        <Detail label="Self-declared float" value={declaredFloat.toFixed(3)} />
        <Detail label="Reserve price" value={formatUsd(priceCents)} />
        <Detail label="Payout" value={payout === "cash" ? "cash" : "credit"} />
        <Detail
          label="Cash gate"
          value={
            payoutEligibility
              ? payoutEligibility.cashEligible
                ? `unlocked (${payoutEligibility.fulfilledShipments} fulfilments)`
                : `locked — ${payoutEligibility.fulfilledShipments}/${payoutEligibility.threshold} fulfilments`
              : "sign in to unlock"
          }
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="notes-input"
          className="font-mono text-[10px] uppercase tracking-tight text-muted"
        >
          Notes for the grader (optional)
        </label>
        <textarea
          id="notes-input"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
          placeholder="Worn once, box included, bought new this season…"
          className="border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[12px] tracking-tight text-foreground placeholder:text-muted/50"
        />
      </div>

      {error && (
        <div className="border border-[#FF4444]/60 bg-[#FF4444]/10 px-3 py-2 font-mono text-[10px] tracking-tight text-[#FF4444]">
          {error}
        </div>
      )}

      <div className="border border-dashed border-[#E8B33A]/60 bg-[#E8B33A]/5 px-3 py-2 font-mono text-[10px] leading-relaxed tracking-tight text-muted">
        Submit takes the listing to review. A grader re-checks the shoe against
        your photos and answers; the human grade is what becomes the card. You
        can track this submission from your dashboard.
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border border-line-strong bg-overlay px-2 py-1.5">
      <span className="font-mono text-[9px] uppercase tracking-tight text-muted">
        {label}
      </span>
      <span className="font-mono text-[11px] font-bold tracking-tight text-foreground">
        {value}
      </span>
    </div>
  );
}

function DoneState({
  sku,
  itemId,
}: {
  sku: Sku | null;
  itemId: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 border border-accent bg-accent/10 p-4">
      <h3 className="font-mono text-sm font-black uppercase tracking-tight text-foreground">
        In review — live within the hour
      </h3>
      <p className="font-mono text-[11px] tracking-tight text-muted">
        Your {sku ? `${sku.brand} ${sku.model}` : "listing"} is queued
        for intake grading{itemId ? ` (ref ${itemId})` : ""}. A
        grader verifies condition against your photos, then the card goes live
        in your dashboard. You&apos;ll be notified either way.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" size="md" href="/">
          back to market
        </Button>
        <Button variant="secondary" size="md" href="/dashboard">
          your dashboard
        </Button>
      </div>
    </div>
  );
}