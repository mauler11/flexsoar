/**
 * components/market/EmbeddedWalletSection.tsx
 *
 * Privy embedded wallet entry inside the wallet modal: email-login wallet
 * creation for users without Phantom, plus linking the embedded address
 * into the FlexSoar account through the SAME link-wallet proof every other
 * wallet uses (Ed25519 signMessage verified server-side — no trust shortcut
 * for embedded keys). Renders nothing when NEXT_PUBLIC_PRIVY_APP_ID is
 * unset: hooks never run without the provider, Phantom-only mode intact.
 *
 * Supabase stays the identity of record throughout: Privy only supplies
 * keys. The linked users.solana_address is what quotes pay and settle
 * verifies — it cannot tell embedded and injected wallets apart, by design.
 */
"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { Button } from "@/components/ui/Button";
import { LinkWalletButton } from "./LinkWalletButton";
import { extractSignatureBytes, firstSolanaWallet } from "@/lib/solana/privy";

export function EmbeddedWalletSection() {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) return null;
  return <EmbeddedWalletSectionInner />;
}

function EmbeddedWalletSectionInner() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();

  if (!ready) {
    return (
      <p className="text-[11px] text-muted">Preparing embedded wallets…</p>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-background p-3">
        <span className="text-xs font-semibold">No Phantom? No problem</span>
        <p className="text-[11px] leading-snug text-muted">
          Log in with email to create your embedded Solana wallet — kept by
          you, never by FlexSoar.
        </p>
        <Button type="button" variant="secondary" size="md" onClick={() => login()}>
          Continue with email
        </Button>
      </div>
    );
  }

  const embedded = firstSolanaWallet(wallets);
  if (!embedded) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-background p-3">
        <p className="text-[11px] leading-snug text-muted">
          Signed in — minting your embedded wallet, a few seconds…
        </p>
        <button
          type="button"
          onClick={() => logout()}
          className="text-left text-[11px] text-muted underline-offset-2 hover:underline"
        >
          Log out of embedded wallet
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-background p-3">
      <span className="text-xs font-semibold">Embedded wallet</span>
      <span className="font-mono text-xs">
        {embedded.address.slice(0, 8)}…{embedded.address.slice(-6)}
      </span>
      <LinkWalletButton
        cta="Link embedded wallet"
        externalSigner={{
          address: embedded.address,
          signMessage: async (message: Uint8Array) => {
            const raw = await embedded.signMessage({ message, address: embedded.address });
            const bytes = extractSignatureBytes(raw);
            if (!bytes || bytes.length !== 64) {
              throw new Error("embedded wallet returned an unusable signature");
            }
            return bytes;
          },
        }}
      />
    </div>
  );
}
