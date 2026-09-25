/**
 * components/market/SolanaBuyPanel.tsx
 *
 * USDC buy path: the server builds the unsigned `buy` transaction
 * (GET /api/solana/build-tx — quote + ATAs + blockhash), a wallet signs
 * AND the transaction lands on-chain, then POST /api/solana/settle
 * verifies balance deltas via Helius and records the ledger transfer.
 *
 * Two signing paths, same settlement:
 *   - Embedded (Privy): the linked embedded key signs AND broadcasts over
 *     its own connection (its RPC, not ours).
 *   - Injected (Phantom et al): the extension signs ONLY — we broadcast
 *     ourselves over the public RPC for OUR cluster, so the transaction
 *     cannot land on the wrong chain if the extension points elsewhere.
 *     This is the path for every user whose linked wallet is external,
 *     which Privy's session can never sign for.
 *
 * The Helius key never leaves the server: blockhash fetching happens in
 * build-tx; verification happens in settle.
 */
"use client";

import { useState } from "react";
import { Connection, Transaction } from "@solana/web3.js";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import { EmbeddedLinkButton } from "@/components/market/EmbeddedWalletSection";
import type { Quote } from "@/lib/solana/quotes";
import { base58Encode } from "@/lib/solana/base58";
import {
  SOLANA_CHAIN,
  asInjectedSolanaSigner,
  extractSignatureBytes,
  getInjectedSolana,
  publicRpcUrl,
  walletForAddress,
} from "@/lib/solana/privy";

interface BuildTxResponse {
  quote: Quote;
  unsignedTx: string;
  buyerWallet: string;
}

interface Receipt {
  signature: string;
  slot: number | null;
  orderId: string | null;
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
    "idle" | "building" | "ready" | "awaitingWallet" | "settling" | "done"
  >("idle");
  const [build, setBuild] = useState<BuildTxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLink, setNeedsLink] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const busy = phase === "building" || phase === "awaitingWallet" || phase === "settling";

  async function settle(signature: string, quote: Quote): Promise<boolean> {
    setPhase("settling");
    try {
      const settleRes = await fetch("/api/solana/settle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId, signature, quote }),
      });
      const settleBody = (await settleRes.json()) as {
        ok: boolean;
        orderId?: string;
        slot?: number;
        error?: string;
      };
      if (!settleRes.ok) {
        setError(
          settleBody.error
            ? `${settleBody.error} — signature ${signature.slice(0, 12)}… kept for support`
            : `settle failed (http ${settleRes.status})`,
        );
        setPhase("ready");
        return false;
      }
      setReceipt({
        signature,
        slot: settleBody.slot ?? null,
        orderId: settleBody.orderId ?? null,
      });
      setPhase("done");
      return true;
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "USDC buy failed");
      setPhase("ready");
      return false;
    }
  }

  async function startBuy() {
    setError(null);
    setReceipt(null);
    setBuild(null);
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
      setBuild({
        quote: buildBody.quote,
        unsignedTx: buildBody.unsignedTx,
        buyerWallet: buildBody.buyerWallet as string,
      });
      setPhase("ready");
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "USDC buy failed");
      setPhase("idle");
    }
  }

  async function signWithEmbedded() {
    if (!build) return;
    setError(null);
    // The linked wallet pays, so the linked embedded key must sign.
    const embedded = walletForAddress(privyWallets, build.buyerWallet);
    if (!embedded) {
      setError(
        "Sign in to your FlexSoar wallet first — open Wallet and continue with email, then retry.",
      );
      return;
    }
    setPhase("awaitingWallet");
    try {
      const tx = Transaction.from(Buffer.from(build.unsignedTx, "base64"));
      const raw = await embedded.signAndSendTransaction({
        chain: SOLANA_CHAIN,
        transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
        address: embedded.address,
      });
      const sigBytes = extractSignatureBytes(raw);
      if (!sigBytes) {
        setError("embedded wallet returned no usable signature — nothing was sent");
        setPhase("ready");
        return;
      }
      await settle(base58Encode(sigBytes), build.quote);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "USDC buy failed");
      setPhase("ready");
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

  if (needsLink) {
    return (
      <EmbeddedLinkButton
        cta="Link wallet, then buy"
        onLinked={() => {
          setNeedsLink(false);
          void startBuy();
        }}
      />
    );
  }

  if (phase === "idle" || phase === "building" || !build) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={busy}
          onClick={() => void startBuy()}
          className="py-3 text-base"
        >
          {phase === "building" ? "Quoting…" : "Buy"}
        </Button>
        {error && (
          <Banner tone="error" title="USDC buy didn't go through">
            {error}
          </Banner>
        )}
      </div>
    );
  }

  // Quote ready — pick the signer that matches the quoted buyer wallet.
  const embedded = walletForAddress(privyWallets, build.buyerWallet);
  if (embedded) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={busy}
          onClick={() => void signWithEmbedded()}
          className="py-3 text-base"
        >
          {phase === "awaitingWallet"
            ? "Confirm in wallet…"
            : phase === "settling"
              ? "Settling…"
              : "Buy"}
        </Button>
        {error && (
          <Banner tone="error" title="USDC buy didn't go through">
            {error}
          </Banner>
        )}
      </div>
    );
  }
  return (
    <PhantomSignSection
      buyerWallet={build.buyerWallet}
      busy={busy}
      disabled={phase !== "ready"}
      error={error}
      onSign={async () => {
        setError(null);
        setPhase("awaitingWallet");
        try {
          const signer = asInjectedSolanaSigner(getInjectedSolana());
          if (!signer) {
            setError("No Solana wallet found in this browser — install Phantom to pay with an external wallet.");
            setPhase("ready");
            return;
          }
          const tx = Transaction.from(Buffer.from(build.unsignedTx, "base64"));
          const signedRaw = await signer.signTransaction(tx);
          // Cross-bundle instanceof is unreliable (the extension builds
          // its own Transaction class), so accept any serialize() shape —
          // but never fall back to the UNSIGNED tx: broadcasting that
          // fails confusingly instead of loudly.
          const serializeFn = (signedRaw as { serialize?: unknown })?.serialize;
          if (typeof serializeFn !== "function") {
            throw new Error("wallet returned an unusable signed transaction — nothing was sent");
          }
          const signed =
            signedRaw instanceof Transaction
              ? signedRaw
              : Transaction.from(
                  (serializeFn as () => Uint8Array).call(signedRaw),
                );
          const connection = new Connection(publicRpcUrl(), "confirmed");
          const signature = await connection.sendRawTransaction(signed.serialize());
          await settle(signature, build.quote);
        } catch (thrown) {
          const msg = thrown instanceof Error ? thrown.message : "USDC buy failed";
          // A rejection in the extension is a cancel, not an error state.
          if (/reject|cancel|denied|dismiss/i.test(msg)) {
            setPhase("ready");
            return;
          }
          setError(msg);
          setPhase("ready");
        }
      }}
      buyerShort={`${build.buyerWallet.slice(0, 4)}…${build.buyerWallet.slice(-4)}`}
    />
  );
}

/**
 * Injected-wallet signing UI. Three states, all honest: no provider
 * (install prompt), locked/wrong account (connect-or-switch prompt), and
 * ready (signs ONLY — broadcast happens over our cluster RPC in the
 * handler above, never the extension's network).
 */
function PhantomSignSection({
  buyerWallet,
  buyerShort,
  busy,
  disabled,
  error,
  onSign,
}: {
  buyerWallet: string;
  buyerShort: string;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onSign: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const signer = asInjectedSolanaSigner(getInjectedSolana());

  if (!signer) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[11px] leading-snug text-muted">
          This purchase pays from {buyerShort} — no Solana wallet detected
          in this browser. Install Phantom (or open this page where yours
          lives) to continue.
        </p>
        {error && (
          <Banner tone="error" title="USDC buy didn't go through">
            {error}
          </Banner>
        )}
      </div>
    );
  }

  if (!signer.publicKeyText) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[11px] leading-snug text-muted">
          Connect the wallet holding {buyerShort} — your keys sign, FlexSoar
          never touches them.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={connecting}
          onClick={() => {
            setConnecting(true);
            signer
              .connect()
              .catch(() => {})
              .finally(() => setConnecting(false));
          }}
          className="py-3 text-base"
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </Button>
        {error && (
          <Banner tone="error" title="USDC buy didn't go through">
            {error}
          </Banner>
        )}
      </div>
    );
  }

  if (signer.publicKeyText !== buyerWallet) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[11px] leading-snug text-muted">
          This purchase pays from {buyerShort}, but the connected wallet is{" "}
          {signer.publicKeyText.slice(0, 4)}…{signer.publicKeyText.slice(-4)}.
          Switch accounts in your wallet, then retry.
        </p>
        {error && (
          <Banner tone="error" title="USDC buy didn't go through">
            {error}
          </Banner>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="primary"
        size="lg"
        disabled={busy || disabled}
        onClick={onSign}
        className="py-3 text-base"
      >
        {busy ? "Confirm in wallet…" : "Buy"}
      </Button>
      {error && (
        <Banner tone="error" title="USDC buy didn't go through">
          {error}
        </Banner>
      )}
    </div>
  );
}
