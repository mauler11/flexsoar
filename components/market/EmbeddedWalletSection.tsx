/**
 * components/market/EmbeddedWalletSection.tsx
 *
 * The ONLY wallet entry: email-login embedded wallet creation plus linking
 * the embedded address into the FlexSoar account through the same
 * link-wallet proof every signing flow uses (Ed25519 signMessage verified
 * server-side — no trust shortcut for embedded keys). Renders nothing
 * (link button) or a setup note when NEXT_PUBLIC_PRIVY_APP_ID is unset:
 * hooks never run without the provider.
 *
 * Supabase stays the identity of record throughout: Privy only supplies
 * keys. The linked users.solana_address is what quotes pay and settle
 * verifies.
 */
"use client";

import { useRouter } from "next/navigation";
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
        <span className="text-xs font-semibold">FlexSoar wallet</span>
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
      <span className="text-xs font-semibold">FlexSoar wallet</span>
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

/**
 * Login-to-linked in one button for every surface that used to offer an
 * injected wallet: dashboard payout section, buy-panel link state, wallet
 * modal. Handles Privy email login, wallet provisioning wait, and the
 * link proof; calls onLinked (or refreshes) on success.
 */
export function EmbeddedLinkButton({
  cta,
  onLinked,
}: {
  cta: string;
  onLinked?: () => void;
}) {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <p className="text-[11px] text-muted">
        Wallet linking is unavailable — the wallet provider is not configured.
      </p>
    );
  }
  return <EmbeddedLinkButtonInner cta={cta} onLinked={onLinked} />;
}

function EmbeddedLinkButtonInner({
  cta,
  onLinked,
}: {
  cta: string;
  onLinked?: () => void;
}) {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();

  if (!ready) {
    return <p className="text-[11px] text-muted">Preparing wallet…</p>;
  }
  if (!authenticated) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" variant="secondary" size="lg" onClick={() => login()} className="py-3 text-base">
          {cta} — continue with email
        </Button>
        <p className="text-[11px] text-muted">
          Creates your FlexSoar wallet on first login — kept by you, never
          by FlexSoar.
        </p>
      </div>
    );
  }
  const embedded = firstSolanaWallet(wallets);
  if (!embedded) {
    return (
      <p className="text-[11px] text-muted">
        Signed in — minting your wallet, a few seconds…
      </p>
    );
  }
  return (
    <LinkWalletButton
      cta={cta}
      onLinked={onLinked ?? (() => router.refresh())}
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
  );
}
