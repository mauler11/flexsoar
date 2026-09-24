/**
 * components/market/SolanaBuyPanel.tsx
 *
 * USDC buy path: the server builds the unsigned `buy` transaction
 * (GET /api/solana/build-tx — quote + ATAs + blockhash), the buyer's
 * embedded FlexSoar wallet signs AND broadcasts it, then POST
 * /api/solana/settle verifies balance deltas via Helius and records the
 * ledger transfer.
 *
 * The Helius key never leaves the server: blockhash fetching happens in
 * build-tx, and broadcasting happens inside the wallet's own
 * signAndSendTransaction (its RPC, not ours).
 */
"use client";

import { useState } from "react";
import { Transaction } from "@solana/web3.js";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import { EmbeddedLinkButton } from "@/components/market/EmbeddedWalletSection";
import type { Quote } from "@/lib/solana/quotes";
import { base58Encode } from "@/lib/solana/base58";
import {
  SOLANA_CHAIN,
  extractSignatureBytes,
  walletForAddress,
} from "@/lib/solana/privy";

interface BuildTxResponse {
  quote: Quote;
  unsignedTx: string;
  buyerWallet: string;
}

interface SettleResponse {
  ok: boolean;
  orderId?: string;
  slot?: number;
  error?: string;
}

export function SolanaBuyPanel({
  listingId,
  priceCents,
  privyWallets = [],
}: {
  listingId: string;
  priceCents: number;
  /** useWallets() output from the bridge — [] when Privy is unconfigured. */
  privyWallets?: readonly unknown[];
}) {
  const [phase, setPhase] = useState<
    "idle" | "building" | "awaitingWallet" | "settling" | "done"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsLink, setNeedsLink] = useState(false);
  const [receipt, setReceipt] = useState<{
    signature: string;
    slot: number | null;
    orderId: string | null;
  } | null>(null);

  const busy = phase === "building" || phase === "awaitingWallet" || phase === "settling";

  async function buyWithUsdc() {
    setError(null);
    setReceipt(null);
    setPhase("building");
    try {
      const buildRes = await fetch(
        `/api/solana/build-tx?listingId=${encodeURIComponent(listingId)}`,
      );
      const buildBody = (await buildRes.json()) as Partial<BuildTxResponse> & {
        error?: string;
      };
      if (!buildRes.ok || !buildBody.quote || !buildBody.unsignedTx) {
        if (buildRes.status === 409 && (buildBody.error ?? "").includes("link your wallet")) {
          setNeedsLink(true);
          setError("Link your wallet first — one signature proves you own it, then buy.");
        } else {
          setError(buildBody.error ?? `quote failed (http ${buildRes.status})`);
        }
        setPhase("idle");
        return;
      }
      // The linked wallet pays, so the linked embedded key must sign.
      const embedded =
        buildBody.buyerWallet != null
          ? walletForAddress(privyWallets, buildBody.buyerWallet)
          : null;
      if (!embedded) {
        setError(
          "Sign in to your FlexSoar wallet first — open Wallet and continue with email, then retry.",
        );
        setPhase("idle");
        return;
      }
      setPhase("awaitingWallet");
      const tx = Transaction.from(Buffer.from(buildBody.unsignedTx, "base64"));
      const raw = await embedded.signAndSendTransaction({
        chain: SOLANA_CHAIN,
        transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
        address: embedded.address,
      });
      const sigBytes = extractSignatureBytes(raw);
      if (!sigBytes) {
        setError("embedded wallet returned no usable signature — nothing was sent");
        setPhase("idle");
        return;
      }
      const signature = base58Encode(sigBytes);
      setPhase("settling");
      const settleRes = await fetch("/api/solana/settle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId,
          signature,
          quote: buildBody.quote,
        }),
      });
      const settleBody = (await settleRes.json()) as SettleResponse;
      if (!settleRes.ok) {
        setError(
          settleBody.error
            ? `${settleBody.error} — signature ${signature.slice(0, 12)}… kept for support`
            : `settle failed (http ${settleRes.status})`,
        );
        setPhase("idle");
        return;
      }
      setReceipt({
        signature,
        slot: settleBody.slot ?? null,
        orderId: settleBody.orderId ?? null,
      });
      setPhase("done");
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "USDC buy failed");
      setPhase("idle");
    }
  }

  if (receipt) {
    return (
      <Banner tone="success" title="Paid with USDC — card is yours">
        Signature {receipt.signature.slice(0, 16)}…
        {receipt.slot != null ? ` · slot ${receipt.slot}` : ""}. The ledger
        recorded the transfer; this page will show the new owner on refresh.
      </Banner>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {needsLink ? (
        <EmbeddedLinkButton
          cta="Link wallet, then buy"
          onLinked={() => {
            setNeedsLink(false);
            buyWithUsdc();
          }}
        />
      ) : (
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={busy}
          onClick={buyWithUsdc}
          className="py-3 text-base"
        >
          {phase === "building"
            ? "Quoting…"
            : phase === "awaitingWallet"
              ? "Confirm in wallet…"
              : phase === "settling"
                ? "Settling…"
                : "Buy with Balance"}
        </Button>
      )}
      {error && (
        <Banner tone="error" title="USDC buy didn't go through">
          {error}
        </Banner>
      )}
    </div>
  );
}
