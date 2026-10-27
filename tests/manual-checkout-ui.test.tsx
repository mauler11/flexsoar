import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/components/market/Fiat', () => ({ FiatAmount: ({ cents }: { cents: number }) => <span>{cents}</span> }));
vi.mock('@/components/market/CheckoutModal', () => ({ CheckoutButton: () => <button>Payment status</button> }));
import { BuyPanel } from '@/components/market/BuyPanel';

describe('manual listing actions', () => {
  const listing = { id: 'listing', cardId: 'card', priceCents: 12300, fairPriceCents: null, oracleValueCents: null, status: 'public', sellerId: 'seller' };
  it.each([
    ['open', 'Order now'], ['reserved', 'Reserved'], ['unavailable', 'Coming soon'],
  ] as const)('renders %s and retains payment recovery', (manualStatus, text) => {
    const html = renderToStaticMarkup(<BuyPanel listing={listing} manualStatus={manualStatus} firstSalePending />);
    expect(html).toContain(text);
    expect(html).toContain('Payment status');
    expect(html).toContain('FlexSoar collects and authenticates every pair before your card transfers.');
    expect(html.includes('href="/order/listing"')).toBe(manualStatus === 'open');
    expect(html).not.toContain('48 hours');
  });
  it('defaults to coming soon and omits seller-held disclosure for vaulted items', () => {
    const html = renderToStaticMarkup(<BuyPanel listing={listing} firstSalePending={false} />);
    expect(html).toContain('Coming soon');
    expect(html).not.toContain('Held by the seller.');
  });
});
