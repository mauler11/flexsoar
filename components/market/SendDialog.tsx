/**
 * components/market/SendDialog.tsx
 *
 * Crypto withdrawal for the linked wallet (the "withdraw" half of the
 * FlexSoar wallet): send USDC to any Solana address. The linked embedded
 * key signs — same rule as the buy panel. No backend involved:
 * a plain wallet-to-wallet SPL transfer, verified by the chain itself.
 *
 * Honest limits, stated in-UI, not buried: USDC only (SOL stays put for
 * fees — draining it bricks the wallet), and the recipient's USDC account
 * must already exist (any wallet creates it on first receive; we check and
 * refuse loudly instead of burning fees on a doomed transaction).
 *
 * Paused while `fundingAvailable()` is false (payments not live, or no
 * Privy provider): renders FundingPausedNotice and never mounts the signing
 * path or the Privy hook.
 */
"use client";

import { useState } from "react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
// The SOLANA hook: the package root's useWallets() returns Ethereum wallets only (see lib/solana/privy-wallet-detect.ts).
import { useWallets } from "@privy-io/react-auth/solana";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";
import { FundingPausedNotice, fundingAvailable } from "@/components/market/FundingOptions";
import { base58Encode } from "@/lib/solana/base58";
import { decodeAddress } from "@/lib/solana/base58";
import { associatedTokenAddress } from "@/lib/solana/sdk";
import { SOLANA_CHAIN, extractSignatureBytes } from "@/lib/solana/privy";
import {
  detectSolanaWallet,
  isSolanaSendingWallet,
  type SolanaWalletDetection,
} from "@/lib/solana/privy-wallet-detect";
import { buildUsdcTransferIx } from "@/lib/solana/transfers";
import { formatUsdc } from "@/lib/solana/balances";

/** Public RPC for preflight reads only — sends go out over each wallet's own connection. */
const DEVNET_RPC = "https://api.devnet.solana.com";
const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
/** Mainnet USDC mint — matches lib/solana/config.ts's mainnet default. */
const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * Chain pointers derived from the USDC mint the backend settled: a devnet
 * mint means devnet RPC + devnet explorer, anything else means mainnet. The
 * mint is the one trustworthy cluster signal client-side — a hardcoded
 * devnet RPC here once built mainnet transactions with devnet blockhashes
 * and pointed users at the wrong explorer.
 */
function chainForMint(usdcMint: string): { rpc: string; explorerSuffix: string } {
  if (usdcMint === MAINNET_USDC_MINT) {
    return { rpc: MAINNET_RPC, explorerSuffix: "" };
  }
  return { rpc: DEVNET_RPC, explorerSuffix: "?cluster=devnet" };
}

export function SendDialog({
  walletAddress,
  usdcMint,
  usdcUnits,
  onClose,
}: {
  walletAddress: string;
  usdcMint: string;
  usdcUnits: number;
  onClose: () => void;
}) {
  if (!fundingAvailable()) return <FundingPausedNotice />;
  return (
    <PrivySendDialogInner
      walletAddress={walletAddress}
      usdcMint={usdcMint}
      usdcUnits={usdcUnits}
      onClose={onClose}
    />
  );
}

function PrivySendDialogInner(props: {
  walletAddress: string;
  usdcMint: string;
  usdcUnits: number;
  onClose: () => void;
}) {
  const { ready, authenticated } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const detection = detectSolanaWallet({
    privyReady: ready,
    walletsReady,
    authenticated,
    wallets,
    address: props.walletAddress,
  });
  return <SendDialogInner {...props} detection={detection} />;
}

function SendDialogInner({
  walletAddress,
  usdcMint,
  usdcUnits,
  onClose,
  detection,
}: {
  walletAddress: string;
  usdcMint: string;
  usdcUnits: number;
  onClose: () => void;
  detection: SolanaWalletDetection;
}) {
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  async function send() {
    setError(null);
    setSignature(null);
    let destBytes: Uint8Array;
    try {
      destBytes = decodeAddress(dest.trim());
      void destBytes;
    } catch {
      setError("Destination is not a valid Solana address.");
      return;
    }
    const units = Math.round(Number(amount) * 1_000_000);
    if (!Number.isFinite(units) || units <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (units > usdcUnits) {
      setError(`Insufficient balance — you hold ${formatUsdc(usdcUnits)} USDC.`);
      return;
    }
    if (detection.status === "waiting") {
      setError("Your wallet is still loading — try again in a moment.");
      return;
    }
    if (detection.status !== "found" || !isSolanaSendingWallet(detection.wallet)) {
      setError("Sign in to your FlexSoar wallet first, then retry.");
      return;
    }
    const embedded = detection.wallet;
    setBusy(true);
    try {
      const chain = chainForMint(usdcMint);
      const connection = new Connection(chain.rpc, "confirmed");
      const destAta = associatedTokenAddress(dest.trim(), usdcMint);
      const destInfo = await connection.getAccountInfo(new PublicKey(destAta));
      if (!destInfo) {
        setError(
          "Recipient has no USDC account yet — their wallet creates it on first receive. Ask them to receive once, then retry.",
        );
        setBusy(false);
        return;
      }
      const sourceAta = associatedTokenAddress(walletAddress, usdcMint);
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: new PublicKey(walletAddress),
      });
      tx.add(
        buildUsdcTransferIx({
          sourceAta,
          destAta,
          owner: walletAddress,
          amountUnits: units,
        }),
      );

      const raw = await embedded.signAndSendTransaction({
        chain: SOLANA_CHAIN,
        transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
      });
      const sigBytes = extractSignatureBytes(raw);
      if (!sigBytes) throw new Error("wallet returned no usable signature");
      setSignature(base58Encode(sigBytes));
      setBusy(false);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "Send failed.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold tracking-tight">Send USDC</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-lg leading-none text-muted transition hover:text-foreground"
        >
          ×
        </button>
      </div>
      <p className="text-[11px] text-muted">
        From {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)} · balance{" "}
        {formatUsdc(usdcUnits)} USDC
      </p>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="send-dest"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          To address
        </label>
        <input
          id="send-dest"
          type="text"
          value={dest}
          onChange={(e) => setDest(e.target.value.trim())}
          placeholder="Solana address"
          autoComplete="off"
          className="w-full rounded-xl border border-line-strong bg-background px-3 py-2.5 font-mono text-xs text-foreground placeholder:text-muted/50 focus:outline-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="send-amount"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          Amount (USDC)
        </label>
        <input
          id="send-amount"
          type="number"
          min="0"
          step="0.000001"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-xl border border-line-strong bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:outline-none"
        />
      </div>
      {error && (
        <Banner tone="error" title="Send didn't go through">
          {error}
        </Banner>
      )}
      {signature && (
        <Banner tone="success" title="Sent">
          Signature {signature.slice(0, 16)}… —{" "}
          <a
            href={`https://solscan.io/tx/${signature}${chainForMint(usdcMint).explorerSuffix}`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            view on Solscan
          </a>
        </Banner>
      )}
      <Button
        type="button"
        disabled={busy || detection.status === "waiting"}
        onClick={send}
        className="w-full py-3.5 text-lg"
      >
        {busy ? "Sending…" : detection.status === "waiting" ? "Preparing wallet…" : "Send"}
      </Button>
      <p className="text-[11px] text-muted">
        USDC only — SOL stays for fees. Your wallet signs; FlexSoar never
        touches the keys.
      </p>
    </div>
  );
}
