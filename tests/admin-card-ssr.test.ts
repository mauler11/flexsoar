// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CardDetailPage from '@/app/admin/cards/[id]/page';

vi.mock('@/components/admin/auth', () => ({
  requireAdminPage: vi.fn(async () => undefined),
}));

// 080 added this server-side read alongside getCard.
vi.mock('@/components/admin/db-reads', () => ({
  getItemReviewApprovals: vi.fn(async () => new Map<string, string | null>()),
}));

vi.mock('@/lib/api/contract', () => ({
  getCard: vi.fn(async () => ({
    id: 'card-1',
    status: 'active',
    sku: { brand: 'Nike', model: 'Air Max 1', colorway: 'Grey', size_us: 10 },
    owner: { handle: 'seller', level: 1 },
    mint_number: 1,
    tier: 1,
    float_value: 0.05,
    condition_grade: 'factory_new',
    minted_at: null,
    oracle_value_cents: 21500,
    is_exceptional: false,
    exceptional_reason: null,
    listing: null,
    item: {
      id: 'item-1', status: 'minted', graded_at: null,
      authenticated_at: null, custody_location: null,
    },
    provenance: [],
  })),
}));

// The server action must never run while rendering the retirement form.
vi.mock('@/app/admin/cards/[id]/actions', () => ({
  burnCardAction: vi.fn(),
}));

describe('C12: admin card detail server render', () => {
  it('renders the retirement form without browser globals or invoking the burn action', async () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
    const page = await CardDetailPage({ params: Promise.resolve({ id: 'card-1' }) });
    let html = '';
    expect(() => { html = renderToStaticMarkup(page); }).not.toThrow();
    expect(html).toContain('Retire card (burn)');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Burn card<\/button>/);
    expect(html).toContain('name="confirm"');
    expect(html).toContain('name="reason"');
    const { burnCardAction } = await import('@/app/admin/cards/[id]/actions');
    expect(burnCardAction).not.toHaveBeenCalled();
  });
});
