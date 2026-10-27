'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';

export function ManualOrderForm({ listingId }: { listingId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [complete, setComplete] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || complete) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/manual-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, name: fields.get('name'), email: fields.get('email'), phone: fields.get('phone'), country: fields.get('country'), website: fields.get('website') }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Request unavailable');
      setComplete(true);
      setMessage(`${result.reference ? `${result.reference}: ` : ''}${result.message}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Connection lost. Contact support before submitting again or paying.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="flex flex-col gap-4">
    <label>Name<input className="block w-full rounded border border-line bg-raised p-2" name="name" autoComplete="name" required minLength={2} maxLength={100} /></label>
    <label>Email<input className="block w-full rounded border border-line bg-raised p-2" name="email" type="email" autoComplete="email" required maxLength={254} /></label>
    <label>Phone<input className="block w-full rounded border border-line bg-raised p-2" name="phone" type="tel" autoComplete="tel" required maxLength={32} /></label>
    <label>Shipping country (two-letter code, e.g. MY)<input className="block w-full rounded border border-line bg-raised p-2 uppercase" name="country" autoComplete="country" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" defaultValue="MY" /></label>
    <div className="hidden" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    <p className="text-sm text-muted">Your contact details will be emailed to FlexSoar to arrange this order. An order request does not reserve the pair or transfer a card. Wait for availability confirmation before paying.</p>
    <Button type="submit" disabled={busy || complete}>{busy ? 'Sending…' : complete ? 'Request sent' : 'Request order'}</Button>
    <p role="status" className="text-sm">{message}</p>
  </form>;
}
