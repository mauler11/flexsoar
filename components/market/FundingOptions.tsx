/**
 * components/market/FundingOptions.tsx
 *
 * Privy funding rails via `useAddFunds`. Three entry points sharing one
 * hook (`useFundRail`):
 *
 *   - combined (checkout shortfall): destination + fiat + crypto legs, so
 *     Privy opens its own "Select method" screen;
 *   - fiat-only (Deposit with Card row): opens straight at Buy crypto;
 *   - crypto-only (Transfer Crypto row): opens straight at Add funds,
 *     with conversion/routing handled by Relay.
 *
 * Always live — the wallet-only decision made funding the front door.
 * Deliberately narrower than the reference screenshots: no Exchange /
 * Cash App rows (provider- and region-specific; Cash App is US-only), no
 * promo rows. What renders is what can actually run.
 *
 * Honest sequencing: card/crypto funding lands IN the wallet first
 * (minutes, provider-dependent), then the user buys with Balance.
 */
"use client";

import { useState } from "react";
import { useAddFunds, usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import {
  FUNDING_CHAIN,
  FUNDING_ENV,
  FUNDING_FIAT_ASSETS,
  FUNDING_USDC_MINT,
} from "@/lib/solana/privy";

export type FundMode = "all" | "fiat" | "crypto";

function destinationFor(address: string) {
  return {
    address,
    chain: FUNDING_CHAIN as `${string}:${string}`,
    asset: FUNDING_USDC_MINT,
  };
}

/** User bailed out of Privy's modal — not an error worth a banner. */
function isCancel(thrown: unknown): boolean {
  const msg = thrown instanceof Error ? thrown.message : String(thrown ?? "");
  return /cancell|dismiss|user closed|exited flow|user exited|modal closed/i.test(msg);
}

/**
 * Shared funding runner. `start("fiat")` opens Buy crypto, `start("crypto")`
 * opens Add funds, `start("all")` opens Privy's method picker. When the
 * user isn't logged in yet, call `login()` first — one tap, then funding.
 */
export function useFundRail(address: string) {
  const { ready, authenticated, login } = usePrivy();
  const { addFunds } = useAddFunds();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(mode: FundMode) {
    if (!ready || busy) return;
    if (!authenticated) {
      login();
      return;
    }
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      // One literal per mode — the SDK types addFunds as a union and
      // reject conditionally-spread optional legs.
      const dest = destinationFor(address);
      const fiatLeg = {
        fiat: {
          source: {
            assets: [...FUNDING_FIAT_ASSETS],
            defaultAsset: "usd" as const,
          },
          environment: FUNDING_ENV as "sandbox" | "production",
          defaultAmount: "50",
        },
      };
      const cryptoLeg = { crypto: { slippageBps: 100 } };
      const result =
        mode === "fiat"
          ? await addFunds({ destination: dest, ...fiatLeg })
          : mode === "crypto"
            ? await addFunds({ destination: dest, ...cryptoLeg })
            : await addFunds({ destination: dest, ...fiatLeg, ...cryptoLeg });
      if (result.method === "fiat") {
        setNotice(
          result.status === "confirmed"
            ? "Card purchase confirmed — funds arrive shortly, then spend from your balance."
            : "Card purchase submitted — it finalizes with the provider, then spend from your balance.",
        );
      } else {
        setNotice("Crypto deposit started — complete it in the flow, then spend from your balance.");
      }
    } catch (thrown) {
      if (!isCancel(thrown)) {
        setError(thrown instanceof Error ? thrown.message : "Funding flow failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    ready,
    needsLogin: ready && !authenticated,
    login,
    busy,
    notice,
    error,
    start,
  };
}

export function FundingOptions({ address }: { address: string }) {
  const rail = useFundRail(address);

  if (!rail.ready) {
    return (
      <p className="text-[11px] leading-snug text-muted">Preparing funding…</p>
    );
  }

  if (rail.needsLogin) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[11px] leading-snug text-muted">
          Card or crypto through Privy providers. Log in with email to set
          up your payment method — funds land here first, then you spend
          from your balance.
        </p>
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={() => rail.login()}
          className="rounded-lg px-4 py-2.5 text-sm"
        >
          Continue with email
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] leading-snug text-muted">
        Funds land here first — then you spend from your balance.
      </p>
      <Button
        type="button"
        variant="primary"
        size="md"
        disabled={rail.busy}
        onClick={() => rail.start("all")}
        className="rounded-lg px-4 py-2.5 text-sm"
      >
        {rail.busy ? "Opening funding…" : "Add Funds"}
      </Button>
      {rail.notice && (
        <Banner tone="success" title="Funding underway">
          {rail.notice}
        </Banner>
      )}
      {rail.error && (
        <Banner tone="error" title="Funding didn't start">
          {rail.error}
        </Banner>
      )}
    </div>
  );
}
