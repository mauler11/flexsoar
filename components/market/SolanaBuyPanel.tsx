/**
 * components/market/SolanaBuyPanel.tsx
 *
 * Devnet USDC buy path: no new packages. The server builds the unsigned
 * `buy` transaction (GET /api/solana/build-tx — quote + ATAs + blockhash),
 * the buyer's injected wallet (Phantom / Solflare in devnet mode) signs
 * AND broadcasts it, then POST /api/solana/settle verifies balance deltas
 * via Helius and records the ledger transfer.
 *
 * The Helius key never leaves the server: blockhash fetching happens in
 * build-tx, and broadcasting happens inside the wallet's own
 * signAndSendTransaction (its RPC, not ours). Wallets exposing only
 * signTransaction (no broadcast) fail loudly with an honest message.
 */
"use client";

import { useState } from "react";
import { Transaction } from "@solana/web3.js";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import { base58Encode } from "@/lib/solana/base58";
import type { Quote } from "@/lib/solana/quotes";

interface InjectedSolana {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string };
  connect?: () => Promise<{ publicKey: { toBase58(): string } }>;
  signMessage?: (message: Uint8Array) => Promise<{ signature: Uint8Array }>;
  signAndSendTransaction?: (
    tx: Transaction,
  ) => Promise<{ signature: string } | string>;
}

declare global {
  interface Window {
    solana?: InjectedSolana;
  }
}

interface BuildTxResponse {
  quote: Quote;
  unsignedTx: string;
}

interface SettleResponse {
  ok: boolean;
  orderId?: string;
  slot?: number;
  error?: string;
}

function injectedWallet(): InjectedSolana | null {
  if (typeof window === "undefined") return null;
  return window.solana ?? null;
}

function extractSignature(
  result: { signature: string } | string,
): string {
  return typeof result === "string" ? result : result.signature;
}

export function SolanaBuyPanel({
  listingId,
  priceCents,
}: {
  listingId: string;
  priceCents: number;
}) {
  const [phase, setPhase] = useState<
    "idle" | "building" | "awaitingWallet" | "settling" | "linking" | "done"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsLink, setNeedsLink] = useState(false);
  const [receipt, setReceipt] = useState<{
    signature: string;
    slot: number | null;
    orderId: string | null;
  } | null>(null);

  const busy = phase === "building" || phase === "awaitingWallet" || phase === "settling" || phase === "linking";

  async function linkWallet(): Promise<boolean> {
    const wallet = injectedWallet();
    if (!wallet) {
      setError("No Solana wallet found — install Phantom and switch it to devnet before linking.");
      return false;
    }
    setPhase("linking");
    setError(null);
    try {
      if (!wallet.publicKey && wallet.connect) await wallet.connect();
      const msgRes = await fetch("/api/solana/link-wallet", { method: "GET" });
      const msgBody = (await msgRes.json()) as {
        message?: string;
        issuedAt?: string;
        error?: string;
      };
      if (!msgRes.ok || !msgBody.message || !msgBody.issuedAt) {
        setError(msgBody.error ?? "could not start wallet link");
        setPhase("idle");
        return false;
      }
      if (!wallet.signMessage) {
        setError("This wallet cannot sign messages — use Phantom or Solflare.");
        setPhase("idle");
        return false;
      }
      const { signature } = await wallet.signMessage(
        new TextEncoder().encode(msgBody.message),
      );
      const address = wallet.publicKey?.toBase58() ?? null;
      if (!address) {
        setError("Wallet gave no address — connect it first, then retry.");
        setPhase("idle");
        return false;
      }
      const linkRes = await fetch("/api/solana/link-wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          signature: base58Encode(signature),
          issuedAt: msgBody.issuedAt,
        }),
      });
      const linkBody = (await linkRes.json()) as { error?: string };
      if (!linkRes.ok) {
        setError(linkBody.error ?? "wallet link failed");
        setPhase("idle");
        return false;
      }
      setNeedsLink(false);
      setPhase("idle");
      return true;
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "wallet link failed");
      setPhase("idle");
      return false;
    }
  }

  async function buyWithUsdc() {
    setError(null);
    setReceipt(null);
    const wallet = injectedWallet();
    if (!wallet) {
      setError("No Solana wallet found — install Phantom, switch it to devnet, then retry.");
      return;
    }
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
      if (!wallet.signAndSendTransaction) {
        setError("This wallet cannot broadcast — use Phantom or Solflare (signAndSendTransaction).");
        setPhase("idle");
        return;
      }
      setPhase("awaitingWallet");
      const tx = Transaction.from(Buffer.from(buildBody.unsignedTx, "base64"));
      const sendResult = await wallet.signAndSendTransaction(tx);
      const signature = extractSignature(sendResult);
      if (!signature) {
        setError("wallet returned no signature — nothing was sent");
        setPhase("idle");
        return;
      }
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
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted">
        <span className="h-px flex-1 bg-line" />
        <span>or pay with USDC · {priceCents > 0 ? "devnet" : "devnet"}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      {needsLink ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={busy}
          onClick={() =>
            linkWallet().then((ok) => {
              if (ok) buyWithUsdc();
            })
          }
          className="py-3 text-base"
        >
          {phase === "linking" ? "Linking wallet…" : "Link wallet, then buy"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
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
                : "Buy with USDC (Solana)"}
        </Button>
      )}
      {error && (
        <Banner tone="error" title="USDC buy didn't go through">
          {error}
        </Banner>
      )}
      <p className="text-[11px] text-muted">
        Non-custodial: 95% to the seller, 5% to FlexSoar, split atomically
        on-chain. Needs Phantom in devnet mode until mainnet launch.
      </p>
    </div>
  );
}
