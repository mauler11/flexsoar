/**
 * app/dev/privy-sign-proof/_runner/ProofRunner.tsx
 *
 * Client UI for the Privy signMessage proof. All pass/fail logic is lib/solana/privy-proof.ts (unit-tested with signers that wrap,
 * re-encode, coerce or impersonate); this file only logs in, finds the embedded Solana wallet and shows the report.
 * Renders nothing outside development.
 */
"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
// The SOLANA hook: the package root's useWallets() returns Ethereum wallets only (see lib/solana/privy-wallet-detect.ts).
import { useWallets } from "@privy-io/react-auth/solana";
import { Button } from "@/components/ui/Button";
import { CreateWalletButton } from "@/components/market/EmbeddedWalletSection";
import { extractSignatureBytes } from "@/lib/solana/privy";
import { detectSolanaWallet } from "@/lib/solana/privy-wallet-detect";
import { runSignMessageProof, type ProofReport } from "@/lib/solana/privy-proof";

export function ProofRunner() {
  if (process.env.NODE_ENV !== "development") return null;
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-lg font-semibold">Privy signMessage proof</h1>
        <p className="mt-3 text-sm">
          NEXT_PUBLIC_PRIVY_APP_ID is not set. Put your own Privy <strong>development</strong> app id in <code>.env.local</code>, restart{" "}
          <code>npm run dev</code>, and reload. See docs/handoff/privy-sign-proof.md.
        </p>
      </main>
    );
  }
  return <Runner />;
}

function Runner() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const [report, setReport] = useState<ProofReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const detection = detectSolanaWallet({ privyReady: ready, walletsReady, authenticated, wallets });
  const wallet = detection.status === "found" ? detection.wallet : null;

  async function run() {
    if (!wallet || busy) return;
    setBusy(true); setReport(null); setCopied(false);
    try {
      setReport(await runSignMessageProof({
        address: wallet.address,
        signMessage: async (message: Uint8Array) => {
          const raw = await wallet.signMessage({ message });
          const bytes = extractSignatureBytes(raw);
          if (!bytes) throw new Error("the wallet returned something that is not signature bytes");
          return bytes;
        },
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Privy signMessage proof <span className="text-xs font-normal text-muted">(local development only)</span></h1>
      <p className="text-sm text-muted">
        Signs five 61-byte messages with your embedded Solana test wallet and checks the signatures over the exact bytes. It sends nothing
        anywhere and signs no transaction. Use a throwaway email and a Privy development app.
      </p>

      {detection.status === "waiting" && <p className="text-sm">Preparing Privy and wallets…</p>}
      {detection.status === "signed-out" && <div><Button type="button" variant="secondary" size="md" onClick={() => login()}>Log in (throwaway email)</Button></div>}
      {detection.status === "missing" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">Logged in and Privy is ready, but this session has no Solana wallet.</p>
          <p className="font-mono text-xs break-all">Solana hook returned {detection.seen.length} wallet(s){detection.seen.length ? ": " + detection.seen.join(", ") : ""}</p>
          <CreateWalletButton />
        </div>
      )}
      {detection.status === "found" && wallet && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">Solana embedded wallet (match this to the Privy dashboard): <span className="font-mono break-all">{detection.address}</span></p>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" size="md" disabled={busy} onClick={run}>{busy ? "Running… approve each prompt" : "Run proof (steps 1-5)"}</Button>
            <button type="button" className="text-sm underline" onClick={() => logout()}>Log out</button>
          </div>
        </div>
      )}

      {report && (
        <section className="flex flex-col gap-3">
          <div role="status" className={`rounded-lg border p-3 text-sm font-semibold ${report.passed ? "border-green-500" : "border-red-500"}`}>
            {report.passed
              ? "PROOF PASSED: the wallet signed the exact bytes in every step."
              : `STOP: step ${report.stop} failed. Do not use this signing method for listings, and do not change what the program verifies. Report this output.`}
          </div>
          <table className="w-full text-left text-xs">
            <thead><tr><th className="p-1">Step</th><th className="p-1">Check</th><th className="p-1">Result</th><th className="p-1">Detail</th></tr></thead>
            <tbody>
              {report.steps.map((s, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="p-1">{s.id}</td><td className="p-1">{s.title}</td>
                  <td className={`p-1 font-semibold ${s.ok ? "text-green-500" : "text-red-500"}`}>{s.ok ? "PASS" : "FAIL"}</td>
                  <td className="p-1 break-all font-mono">{s.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3">
            <button type="button" className="text-sm underline" onClick={async () => { await navigator.clipboard.writeText(JSON.stringify({ ...report, userAgent: navigator.userAgent }, null, 2)); setCopied(true); }}>
              Copy report as JSON
            </button>
            {copied && <span className="text-xs text-muted">copied (contains the public address, message and signature; no secrets)</span>}
          </div>
        </section>
      )}
    </main>
  );
}
