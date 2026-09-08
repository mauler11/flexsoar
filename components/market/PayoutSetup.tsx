"use client";

/**
 * components/market/PayoutSetup.tsx
 *
 * Client island for the dashboard "Payout setup" section. The page (server)
 * passes the stored Connect status; this component owns the button
 * interaction: POST /api/consignor/connect, then redirect to Stripe's
 * onboarding URL. Account links expire, so the link is minted on click —
 * never pre-generated at page render.
 */

import { useState } from "react";

import { Button } from "@/components/ui/Button";

export interface PayoutSetupProps {
  accountId: string | null;
  payoutsEnabled: boolean;
  isConsignor: boolean;
  countryCode: string | null;
}

export function PayoutSetup({
  accountId,
  payoutsEnabled,
  isConsignor,
  countryCode,
}: PayoutSetupProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const connected = payoutsEnabled && accountId != null;

  const handleSetup = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/consignor/connect", {
        method: "POST",
      });
      const body = (await response.json()) as {
        onboardingUrl?: string;
        error?: string;
        code?: string;
      };
      if (!response.ok || !body.onboardingUrl) {
        setError(body.error ?? "Could not start payout setup. Try again.");
        setIsLoading(false);
        return;
      }
      window.location.href = body.onboardingUrl;
    } catch {
      setError("Network error. Try again.");
      setIsLoading(false);
    }
  };

  if (connected) {
    return (
      <div className="border border-line bg-overlay/50 px-3 py-3 font-mono text-[11px] tracking-tight">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" aria-hidden="true" />
            <span className="font-medium text-green-500">Connected</span>
            <span className="text-muted">
              Account{" "}
              <code className="text-[10px] bg-overlay px-1 rounded">
                {accountId?.slice(-8)}
              </code>
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted">
            <span>Payouts: enabled</span>
          </div>
        </div>
      </div>
    );
  }

  const needsCountry = !countryCode;
  const blockedCountry =
    countryCode != null && countryCode.toUpperCase() !== "MY";

  return (
    <div className="border border-dashed border-line-strong px-3 py-3 font-mono text-[11px] tracking-tight">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#FF4444]" aria-hidden="true" />
          <span className="font-medium text-[#FF4444]">
            {accountId ? "Onboarding incomplete" : "Not connected"}
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSetup}
          disabled={isLoading}
        >
          {isLoading ? "Opening Stripe…" : "Set up payouts"}
        </Button>
      </div>
      {!isConsignor && (
        <p className="mt-2 text-[9px] text-muted">
          Payouts are for consignors — list your first shoe to become one.
        </p>
      )}
      {needsCountry && isConsignor && (
        <p className="mt-2 text-[9px] text-muted">
          Set your country first (Connect onboarding is Malaysia-only right
          now).
        </p>
      )}
      {blockedCountry && (
        <p className="mt-2 text-[9px] text-muted">
          Connect onboarding is Malaysia-only right now (your country:{" "}
          {countryCode}).
        </p>
      )}
      {accountId && !payoutsEnabled && (
        <p className="mt-2 text-[9px] text-muted">
          Account created — finish Stripe&apos;s onboarding steps to enable
          payouts.
        </p>
      )}
      <p className="mt-2 text-[9px] text-muted">
        Connect your Stripe account to receive payouts. Payout method (cash vs
        credit) is determined by your country — see TERMS.md §10.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-[10px] text-[#FF4444]">
          {error}
        </p>
      )}
    </div>
  );
}
