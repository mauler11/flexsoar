// track/payment-security (080): seller review is shown apart from warehouse authentication, the
// fn_confirm_shipment source-state refusal maps to WRONG_STATUS, and the 080 migration keeps its
// founder-rule shape.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { contractErrorCode } from '@/lib/db/errors';
import { isVaulted, vaultState } from '@/app/(market)/vault-status';

const REVIEWED = '2026-09-25T06:56:12.503Z';
const AUTHENTICATED = '2026-10-01T08:30:00.000Z';

const mocks = vi.hoisted(() => ({
  reviewApprovals: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, id === 'item-seller' ? '2026-09-25T06:56:12.503Z' : null]))),
}));

vi.mock('@/components/admin/auth', () => ({ requireAdminPage: async () => undefined }));
vi.mock('@/components/admin/db-reads', () => ({ getItemReviewApprovals: mocks.reviewApprovals }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('@/lib/api/contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/contract')>();
  const sku = { id: 'sku-1', brand: 'Nike', model: 'Air Max 1', colorway: 'Seed Grey', size_us: 10, market_price_cents: 26000, art_url: null };
  return {
    ...actual,
    // The production shape after 080: seller-held, minted, pending_vault, review stamp moved off authenticated_at.
    getCard: async () => ({
      id: 'card-1',
      sku_id: 'sku-1',
      owner_id: 'seller-1',
      float_value: 0.12,
      condition_grade: 'near_mint',
      tier: 1,
      mint_number: 1,
      status: 'pending_vault',
      is_exceptional: false,
      minted_at: REVIEWED,
      sku,
      listing: null,
      exceptional_reason: null,
      owner: { id: 'seller-1', handle: 'seller', level: 1 },
      item: {
        id: 'item-seller',
        status: 'minted',
        photos: [],
        grading_notes: null,
        graded_at: REVIEWED,
        authenticated_at: null,
        custody_location: null,
        custody: 'seller',
      },
      oracle_value_cents: null,
      provenance: [],
    }),
    getConnectOnboardingStatus: async () => null,
    getConsignment: async () => ({
      id: 'consignment-1',
      consignor_id: 'consignor-1',
      consignor: { id: 'consignor-1', handle: 'sneakerhead', level: 2 },
      status: 'in_review',
      item_count: 2,
      intake_fee_cents: 1500,
      submitted_at: '2026-01-01T00:00:00Z',
      received_at: null,
      completed_at: null,
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      items: [
        { id: 'item-seller', status: 'minted', float_value: 0.12, graded_at: REVIEWED, authenticated_at: null, custody_location: null, photos: [], sku },
        { id: 'item-warehouse', status: 'minted', float_value: 0.2, graded_at: REVIEWED, authenticated_at: AUTHENTICATED, custody_location: 'A1', photos: [], sku },
      ],
      events: [],
    }),
  };
});

import CardDetailPage from '@/app/admin/cards/[id]/page';
import ConsignmentDetailPage from '@/app/admin/consignments/[id]/page';

/** The <dd> that follows a given <dt> label in the card page's Field list. */
function fieldValue(html: string, label: string): string | undefined {
  return html.match(new RegExp(`>${label}</dt><dd[^>]*>([^<]*)</dd>`))?.[1];
}

describe('080: admin item pages show "Review approved at" apart from "Authenticated at"', () => {
  it('card page: a seller-reviewed card shows the review time, and "—" for authentication', async () => {
    // RetireCardForm reads `document` while rendering (pre-existing; reported in the 080 handoff). Stub it for this render only.
    vi.stubGlobal('document', { querySelector: () => null });
    const html = renderToStaticMarkup(await CardDetailPage({ params: Promise.resolve({ id: 'card-1' }) }));
    expect(fieldValue(html, 'Review approved at')).toBe('2026-09-25 06:56');
    expect(fieldValue(html, 'Authenticated at')).toBe('—');
    expect(mocks.reviewApprovals).toHaveBeenCalledWith(['item-seller']);
    vi.unstubAllGlobals();
  });

  it('consignment page: separate columns; the warehouse item is authenticated, not review-approved', async () => {
    const html = renderToStaticMarkup(await ConsignmentDetailPage({ params: Promise.resolve({ id: 'consignment-1' }) }));
    const header = html.indexOf('>Review approved</th>');
    expect(header).toBeGreaterThan(-1);
    expect(html.indexOf('>Authenticated</th>')).toBeGreaterThan(header);
    const cells = (row: number) =>
      [...html.split('<tbody')[1].split('</tr>')[row].matchAll(/<td[^>]*>([^<]*(?:<span[^>]*>[^<]*<\/span>[^<]*)*)<\/td>/g)].map((m) => m[1]);
    // SKU, Status, Float, Graded, Review approved, Authenticated, Custody, Photos
    expect(cells(0).slice(4, 6)).toEqual(['2026-09-25 06:56', '—']);
    expect(cells(1).slice(4, 6)).toEqual(['—', '2026-10-01 08:30']);
  });
});

describe('080: a review approval never makes an item Vaulted', () => {
  it('seller custody with a review approval and no authentication is held by seller', () => {
    const item = { custody: 'seller' as const, authenticated_at: null, review_approved_at: REVIEWED };
    expect(vaultState(item)).toBe('held_by_seller');
    expect(isVaulted(item)).toBe(false);
  });

  it('warehouse custody needs authenticated_at; a review approval alone is awaiting intake', () => {
    const reviewedOnly = { custody: 'warehouse' as const, authenticated_at: null, review_approved_at: REVIEWED };
    const authenticated = { custody: 'warehouse' as const, authenticated_at: AUTHENTICATED, review_approved_at: null };
    expect(vaultState(reviewedOnly)).toBe('awaiting_intake');
    expect(vaultState(authenticated)).toBe('vaulted');
  });
});

describe('080: fn_confirm_shipment source-state refusals map to WRONG_STATUS', () => {
  it.each([
    'redemption 55aa8048-4790-47d6-83ff-9da4cbf7f1cc is defaulted, expected awaiting_seller',
    'redemption 55aa8048-4790-47d6-83ff-9da4cbf7f1cc is defaulted, expected requested',
    'redemption 55aa8048-4790-47d6-83ff-9da4cbf7f1cc is requested, expected awaiting_seller',
    'redemption 55aa8048-4790-47d6-83ff-9da4cbf7f1cc is awaiting_seller, expected awaiting_seller',
  ])('"%s"', (message) => {
    expect(contractErrorCode({ message, code: 'P0001' })).toBe('WRONG_STATUS');
  });

  it('the holder refusal keeps its own code', () => {
    expect(contractErrorCode({ message: 'only the holder of this item can confirm shipment' })).toBe('NOT_FULFILLER');
  });
});

describe('080 migration file: founder-rule shape', () => {
  const sql = readFileSync(resolve(__dirname, '../supabase/migrations/080_post_079_cleanup.sql'), 'utf8');
  const code = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

  it('is ASCII with LF line ends, and one transaction', () => {
    expect(sql).not.toMatch(/\r/);
    expect(sql).toMatch(/^[\x00-\x7f]*$/);
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('hard-codes no row ids', () => {
    expect(code).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('moves stamps only off non-warehouse items, never derives vaulted from anything but custody + authenticated_at', () => {
    expect(code).toContain("WHERE i.custody<>'warehouse' AND i.authenticated_at IS NOT NULL AND i.review_approved_at IS NULL");
    expect(code).toContain("d.action IN('authentication_pass','review_authentication_pass')");
    // The only write to items is the move, and it never sets custody.
    expect(code.match(/UPDATE public\.items/g)).toHaveLength(1);
    expect(code).not.toMatch(/SET[^;]*custody\s*=/);
  });

  it('revokes EXECUTE on fn_approve_submission from PUBLIC and anon only', () => {
    expect(code.match(/^REVOKE .*$/gm)).toEqual(['REVOKE EXECUTE ON FUNCTION public.fn_approve_submission(uuid,integer,integer) FROM PUBLIC, anon;']);
    expect(code).not.toMatch(/^GRANT /m);
  });
});
