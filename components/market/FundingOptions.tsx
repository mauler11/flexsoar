/**
 * components/market/FundingOptions.tsx
 *
 * Privy funding rails: card + crypto deposit methods in one `useAddFunds`
 * flow, Courtyard-arranged. Always live — the wallet-only decision made
 * funding the front door, so there is no flag gate. Deliberately narrower
 * than the reference screenshot: no Exchange / Cash App rows (provider-
 * and region-specific; Cash App is US-only), no promo rows. What renders
 * is what can actually run.
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

export function FundingOptions({ address }: { address: string }) {
  return <FundingOptionsInner address={address} />;
}

function FundingOptionsInner({ address }: { address: string }) {
  const { ready, authenticated, login } = usePrivy();
  const { addFunds } = useAddFunds();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!ready) {
    return (
      <p className="text-[11px] leading-snug text-muted">Preparing funding…</p>
    );
  }

  if (!authenticated) {
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
          onClick={() => login()}
          className="rounded-lg px-4 py-2.5 text-sm"
        >
          Continue with email
        </Button>
      </div>
    );
  }

  async function fund() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await addFunds({
        destination: {
          address,
          chain: FUNDING_CHAIN,
          asset: FUNDING_USDC_MINT,
        },
        fiat: {
          source: {
            assets: [...FUNDING_FIAT_ASSETS],
            defaultAsset: "usd",
          },
          environment: FUNDING_ENV,
          defaultAmount: "50",
        },
        crypto: {
          slippageBps: 100,
        },
      });
      if (result.method === "fiat") {
        setNotice(
          result.status === "confirmed"
            ? "Card purchase confirmed — funds arrive shortly, then buy with Balance."
            : "Card purchase submitted — it finalizes with the provider, then buy with Balance.",
        );
      } else {
        setNotice("Crypto deposit started — complete it in the flow, then buy with Balance.");
      }
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "Funding flow failed.");
    } finally {
      setBusy(false);
    }
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
        disabled={busy}
        onClick={fund}
        className="rounded-lg px-4 py-2.5 text-sm"
      >
        {busy ? "Opening funding…" : "Add Funds"}
      </Button>
      {notice && (
        <Banner tone="success" title="Funding underway">
          {notice}
        </Banner>
      )}
      {error && (
        <Banner tone="error" title="Funding didn't start">
          {error}
        </Banner>
      )}
    </div>
  );
}
