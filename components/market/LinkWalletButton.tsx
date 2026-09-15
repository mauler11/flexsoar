/**
 * components/market/LinkWalletButton.tsx
 *
 * Standalone wallet-link flow: proves ownership of a Solana address by
 * signing the caller-bound message (GET /api/solana/link-wallet) and
 * stores the VERIFIED address (POST). Used in two places:
 *
 *   - the seller dashboard's "USDC payout wallet" section — sellers never
 *     see the buy panel on their own listings, so without this they have
 *     no path to link the payout wallet quotes pay to;
 *   - SolanaBuyPanel's "link your wallet first" state (buyer side).
 *
 * Needs an injected wallet (Phantom / Solflare, devnet mode for testing).
 * On success calls onLinked (callers refresh server state from there).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Transaction } from "@solana/web3.js";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import { base58Encode } from "@/lib/solana/base58";

/** Minimal injected-wallet surface (Phantom / Solflare). Shared with SolanaBuyPanel. */
export interface InjectedSolana {
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

export function LinkWalletButton({
  cta,
  onLinked,
  externalSigner = null,
}: {
  /** Button label, e.g. "Link wallet" or "Link wallet, then buy". */
  cta: string;
  /** Fired after the address stores. Defaults to a router refresh. */
  onLinked?: () => void;
  /**
   * Embedded-wallet signer (Privy). When provided, the injected wallet is
   * never consulted: the address comes from the prop and the message is
   * signed through it. The POST still verifies Ed25519 server-side, so a
   * mismatched signer fails closed exactly like a bad Phantom signature.
   */
  externalSigner?: {
    address: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  async function link() {
    setError(null);
    const wallet =
      externalSigner == null && typeof window !== "undefined"
        ? (window.solana ?? null)
        : null;
    if (!externalSigner && !wallet) {
      setError("No Solana wallet found — install Phantom and switch it to devnet first.");
      return;
    }
    setBusy(true);
    try {
      if (!externalSigner && !wallet!.publicKey && wallet!.connect) await wallet!.connect();
      const msgRes = await fetch("/api/solana/link-wallet", { method: "GET" });
      const msgBody = (await msgRes.json()) as {
        message?: string;
        issuedAt?: string;
        error?: string;
      };
      if (!msgRes.ok || !msgBody.message || !msgBody.issuedAt) {
        setError(msgBody.error ?? "could not start wallet link");
        setBusy(false);
        return;
      }
      const messageBytes = new TextEncoder().encode(msgBody.message);
      let address: string | null;
      let signature: Uint8Array;
      if (externalSigner) {
        address = externalSigner.address;
        signature = await externalSigner.signMessage(messageBytes);
      } else if (wallet?.signMessage) {
        if (!wallet.publicKey && wallet.connect) await wallet.connect();
        const signed = await wallet.signMessage(messageBytes);
        signature = signed.signature;
        address = wallet.publicKey?.toBase58() ?? null;
      } else {
        setError("This wallet cannot sign messages — use Phantom or Solflare.");
        setBusy(false);
        return;
      }
      if (!address) {
        setError("Wallet gave no address — connect it first, then retry.");
        setBusy(false);
        return;
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
      const linkBody = (await linkRes.json()) as { error?: string; address?: string };
      if (!linkRes.ok) {
        setError(linkBody.error ?? "wallet link failed");
        setBusy(false);
        return;
      }
      setLinked(linkBody.address ?? address);
      setBusy(false);
      if (onLinked) onLinked();
      else router.refresh();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "wallet link failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        size="lg"
        disabled={busy}
        onClick={link}
        className="py-3 text-base"
      >
        {busy ? "Linking wallet…" : cta}
      </Button>
      {linked && (
        <p className="text-[11px] text-muted">
          Linked {linked.slice(0, 8)}…{linked.slice(-6)} — USDC payouts go here.
        </p>
      )}
      {error && (
        <Banner tone="error" title="Wallet link didn't go through">
          {error}
        </Banner>
      )}
    </div>
  );
}
