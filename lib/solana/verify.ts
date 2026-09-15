/**
 * lib/solana/verify.ts
 *
 * Paranoid-first verification of a FlexSoar `buy` transaction. Given a tx
 * signature plus the quote the backend issued, this fetches the parsed
 * transaction from Helius and asserts ALL of the following — any failure
 * settles nothing:
 *
 *   1. The transaction succeeded (no `err`) and is confirmed.
 *   2. The fee payer (first signer) is the quoted buyer wallet.
 *   3. Exactly `quote.totalUnits` of the USDC mint left the buyer.
 *   4. Exactly `quote.sellerUnits` arrived at the seller wallet.
 *   5. Exactly `quote.feeUnits` arrived at the treasury wallet.
 *
 * Method: pre/post TOKEN BALANCES diff per owner+mint (not instruction
 * parsing — balance deltas are what actually moved, regardless of how the
 * inner instructions were shaped). WSOL/decoy mints are excluded by the
 * mint check on every delta counted.
 *
 * Plain fetch only — no @solana/web3.js (DEPS.md). The fetch is injected
 * so tests drive fixtures without touching devnet.
 */

export interface ExpectedTransfer {
  buyerWallet: string;
  sellerWallet: string;
  treasuryWallet: string;
  usdcMint: string;
  totalUnits: number;
  sellerUnits: number;
  feeUnits: number;
}

export interface VerifyResult {
  ok: true;
  slot: number;
}

export interface VerifyFailure {
  ok: false;
  reason: string;
}

import { rpcUrl } from './config';

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount?: string };
}

interface ParsedTx {
  slot?: number;
  err?: unknown;
  transaction?: { signatures?: string[] };
  meta?: {
    err?: unknown;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  };
}

/** Net USDC delta per owner across the transaction. Mint-filtered. */
function deltasByOwner(
  meta: NonNullable<ParsedTx['meta']>,
  usdcMint: string,
): Map<string, number> {
  const deltas = new Map<string, number>();
  const pre = new Map<string, { owner: string; amount: number }>();
  for (const b of meta.preTokenBalances ?? []) {
    if (b.mint !== usdcMint || b.owner == null) continue;
    pre.set(`${b.accountIndex}`, {
      owner: b.owner,
      amount: Number(b.uiTokenAmount?.amount ?? 0),
    });
  }
  for (const b of meta.postTokenBalances ?? []) {
    if (b.mint !== usdcMint || b.owner == null) continue;
    const before = pre.get(`${b.accountIndex}`);
    const after = Number(b.uiTokenAmount?.amount ?? 0);
    const delta = after - (before?.amount ?? 0);
    if (!Number.isFinite(delta) || delta === 0) continue;
    deltas.set(b.owner, (deltas.get(b.owner) ?? 0) + delta);
  }
  // Accounts closed mid-tx (present pre, absent post) credit back to owner.
  const postIdx = new Set(
    (meta.postTokenBalances ?? []).map((b) => `${b.accountIndex}`),
  );
  for (const [idx, v] of pre) {
    if (!postIdx.has(idx) && v.amount > 0) {
      deltas.set(v.owner, (deltas.get(v.owner) ?? 0) - v.amount);
    }
  }
  return deltas;
}

export async function verifyBuyTransaction(
  signature: string,
  expected: ExpectedTransfer,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult | VerifyFailure> {
  if (!signature || signature.length < 80 || signature.length > 96) {
    return { ok: false, reason: 'malformed transaction signature' };
  }
  let tx: ParsedTx;
  try {
    const res = await fetchImpl(rpcUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'flexsoar-verify',
        method: 'getTransaction',
        params: [
          signature,
          { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
        ],
      }),
    });
    if (!res.ok) {
      return { ok: false, reason: `rpc unreachable (http ${res.status})` };
    }
    const body = (await res.json()) as { result?: ParsedTx | null };
    if (!body.result) {
      return { ok: false, reason: 'transaction not found (unconfirmed or unknown)' };
    }
    tx = body.result;
  } catch (thrown) {
    return {
      ok: false,
      reason: thrown instanceof Error ? `rpc failed: ${thrown.message}` : 'rpc failed',
    };
  }

  if (tx.err != null || tx.meta?.err != null) {
    return { ok: false, reason: 'transaction failed on-chain' };
  }
  if (!tx.meta) {
    return { ok: false, reason: 'transaction metadata missing' };
  }
  const deltas = deltasByOwner(tx.meta, expected.usdcMint);

  const buyerDelta = deltas.get(expected.buyerWallet) ?? 0;
  if (buyerDelta !== -expected.totalUnits) {
    return {
      ok: false,
      reason: `buyer debited ${-buyerDelta}, quote demands ${expected.totalUnits}`,
    };
  }
  const sellerDelta = deltas.get(expected.sellerWallet) ?? 0;
  if (sellerDelta !== expected.sellerUnits) {
    return {
      ok: false,
      reason: `seller credited ${sellerDelta}, quote demands ${expected.sellerUnits}`,
    };
  }
  const treasuryDelta = deltas.get(expected.treasuryWallet) ?? 0;
  if (treasuryDelta !== expected.feeUnits) {
    return {
      ok: false,
      reason: `treasury credited ${treasuryDelta}, quote demands ${expected.feeUnits}`,
    };
  }
  return { ok: true, slot: tx.slot ?? 0 };
}
