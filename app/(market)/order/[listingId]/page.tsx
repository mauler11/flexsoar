import { notFound, redirect } from 'next/navigation';
import { getListing, getCard } from '@/lib/api/contract';
import { createServerSupabase } from '@/lib/supabase/server';
import { manualCheckoutStatus, manualPaymentConfig } from '@/lib/manual-checkout/config';
import { LISTING_ID, MANUAL_PAYMENT_INSTRUCTIONS, SELLER_HELD_DISCLOSURE } from '@/lib/manual-checkout/order';
import { ManualOrderForm } from '@/components/market/ManualOrderForm';
import { formatMyr } from '@/components/card/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Order request · FlexSoar', robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  if (!LISTING_ID.test(listingId)) notFound();
  const session = await createServerSupabase();
  const { data } = await session.auth.getUser();
  if (!data.user) redirect(`/sign-in?next=${encodeURIComponent(`/order/${listingId}`)}`);
  const status = manualCheckoutStatus(listingId);
  if (status !== 'open') return <div><h1>{status === 'reserved' ? 'Reserved' : 'Coming soon'}</h1><p>This listing is not accepting order requests.</p></div>;
  const listing = await getListing(listingId);
  if (!listing || listing.status !== 'public' || listing.order || listing.seller_id === data.user.id) notFound();
  const card = await getCard(listing.card_id);
  if (!card) notFound();
  const payment = manualPaymentConfig();
  const sku = listing.card.sku;
  return <section className="mx-auto flex w-full max-w-xl flex-col gap-5 p-4">
    <h1 className="text-2xl font-bold">Order request</h1>
    <h2>{sku.brand} {sku.model} {sku.colorway} · US {sku.size_us}</h2>
    <p className="text-xl font-semibold">{formatMyr(listing.price_cents)}</p>
    {card.item.custody === 'seller' && <p>{SELLER_HELD_DISCLOSURE}</p>}
    <ManualOrderForm listingId={listingId} />
    <h2 className="font-semibold">Payment instructions</h2>
    <p>{MANUAL_PAYMENT_INSTRUCTIONS}</p>
    <p>Submit your request to receive an order reference. Wait for FlexSoar to confirm availability before paying.</p>
    {/* Static local asset; intentionally a non-payable placeholder until replaced by the operator. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/payments/duitnow-qr.png" alt="DuitNow QR placeholder — contact FlexSoar for the verified payment QR" width={320} height={320} />
    <p className="break-all">USDC (Solana): {payment.address}</p>
    <p className="text-sm text-muted">Do not send SOL or USDC on another network. Confirm the USDC amount with FlexSoar against the MYR price before sending.</p>
  </section>;
}
