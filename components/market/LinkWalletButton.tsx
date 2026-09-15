/**
 * components/market/LinkWalletButton.tsx
 *
 * Wallet-link proof runner: signs the caller-bound message
 * (GET /api/solana/link-wallet) through the given embedded signer and
 * stores the VERIFIED address (POST). The signer always comes from
 * EmbeddedLinkButton (Privy email login → embedded Solana wallet); this
 * component holds no wallet logic itself. The POST still verifies Ed25519
 * server-side, so a mismatched signer fails closed.
 *
 * On success calls onLinked (callers refresh server state from there).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import { base58Encode } from "@/lib/solana/base58";

export function LinkWalletButton({
  cta,
  onLinked,
  externalSigner,
}: {
  /** Button label, e.g. "Link wallet" or "Link wallet, then buy". */
  cta: string;
  /** Fired after the address stores. Defaults to a router refresh. */
  onLinked?: () => void;
  /** The embedded signer — address shown on success, key used for proof. */
  externalSigner: {
    address: string;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  async function link() {
    setError(null);
    setBusy(true);
    try {
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
      const address = externalSigner.address;
      const signature = await externalSigner.signMessage(messageBytes);
      if (!address) {
        setError("Wallet gave no address — try again.");
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
