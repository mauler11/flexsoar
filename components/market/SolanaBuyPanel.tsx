"use client";
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/market/Banner';
import { parseAttempt, type AttemptStatus } from '@/lib/db/payment-v2';

/** Deliberately no signing/broadcast path until protocol + schema + authorities
 * are verified. Existing attempts come from durable account-bound server state. */
export function SolanaBuyPanel({ listingId }: {
  listingId: string; priceCents: number; privyWallets?: readonly unknown[];
}) {
  const [attempts, setAttempts] = useState<AttemptStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<{orderId:string;reference:string|null;status:string}[]>([]);
  const [busy, setBusy] = useState(false);
  const recover = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [response,receipts] = await Promise.all([
        fetch(`/api/solana/attempts?listingId=${encodeURIComponent(listingId)}`, {cache:'no-store'}),
        fetch(`/api/solana/receipts?listingId=${encodeURIComponent(listingId)}`, {cache:'no-store'}),
      ]);
      const receiptBody=await receipts.json();
      if(receipts.ok&&Array.isArray(receiptBody.receipts))setLegacy(receiptBody.receipts);
      else throw new Error(receiptBody.error??'Receipt lookup unavailable');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Payment status unavailable');
      if (!Array.isArray(result.attempts)) throw new Error('Invalid payment status');
      setAttempts(result.attempts.map(parseAttempt));
    } catch (e) { setError(e instanceof Error ? e.message : 'Payment status unavailable'); }
    finally { setBusy(false); }
  }, [listingId]);
  useEffect(() => { void recover(); }, [recover]);
  return <div className="flex flex-col gap-3">
    <Banner tone="info" title="New purchases are paused">
      Seller-held purchases will hold USDC in escrow until the exact pair is accepted.
      Already-vaulted purchases will settle directly. Neither path is accepting new funding yet.
      If a payment may have been sent, recover its status. Do not pay again.
    </Banner>
    <Button type="button" disabled={busy} onClick={() => void recover()}>{busy ? 'Checking status…' : 'Recover payment status'}</Button>
    {error && <Banner tone="error" title="Recovery needs attention">{error} Preserve the original reference; an unavailable status does not mean payment failed.</Banner>}
    {legacy.map(r=><article key={r.orderId} className="rounded border p-3 text-sm">
      <p>Existing order {r.orderId} · {r.status}</p><p className="break-all">{r.reference}</p>
      <p>Historical database receipt only. This does not establish escrow or new chain verification. Do not repeat this purchase.</p>
    </article>)}
    {attempts.map(a => <article key={a.id} className="rounded border p-3 text-sm">
      <p>{a.mode === 'seller_held_escrow' ? 'Seller-held escrow' : 'Vaulted direct sale'} · Attempt {a.id}</p>
      <p>Funding: {a.funding} · Dispatch: {a.dispatch} · Authentication: {a.authentication}</p>
      <p>Seller settlement: {a.sellerSettlement} · Claim availability: {a.claim}</p>
      {a.operationPending && <p>Operation pending. Reconciliation will use the original payment.</p>}
      {a.signatures.map(s => <p key={s} className="break-all">Reference: {s}</p>)}
    </article>)}
  </div>;
}
