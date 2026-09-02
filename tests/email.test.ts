import { describe, expect, it, vi } from 'vitest';
import {
  buildSubmissionApprovedEmail,
  buildCardSoldEmail,
} from '@/lib/email/send';

describe('email templates', () => {
  describe('buildSubmissionApprovedEmail', () => {
    const baseInput = {
      consignorEmail: 'seller@example.com',
      consignorHandle: 'testconsignor',
      shoeBrand: 'Nike',
      shoeModel: 'Air Jordan 1',
      shoeColorway: 'Chicago',
      shoeSizeUs: 10.5,
      listingUrl: 'https://flexsoar.net/market/abc123',
    };

    it('renders the subject with shoe details', () => {
      const { subject } = buildSubmissionApprovedEmail(baseInput);
      expect(subject).toContain('Your submission is live');
      expect(subject).toContain('Nike');
      expect(subject).toContain('Air Jordan 1');
      expect(subject).toContain('Chicago');
      expect(subject).toContain('US 10.5');
    });

    it('renders HTML with all shoe details and listing URL', () => {
      const { html } = buildSubmissionApprovedEmail(baseInput);
      expect(html).toContain('testconsignor');
      expect(html).toContain('Nike');
      expect(html).toContain('Air Jordan 1');
      expect(html).toContain('Chicago');
      expect(html).toContain('US 10.5');
      expect(html).toContain('https://flexsoar.net/market/abc123');
      expect(html).toContain('approved and is now live');
    });

    it('renders text version with all details', () => {
      const { text } = buildSubmissionApprovedEmail(baseInput);
      expect(text).toContain('testconsignor');
      expect(text).toContain('Nike');
      expect(text).toContain('Air Jordan 1');
      expect(text).toContain('Chicago');
      expect(text).toContain('US 10.5');
      expect(text).toContain('https://flexsoar.net/market/abc123');
      expect(text).toContain('approved and is now live');
    });

    it('includes support email contact', () => {
      const { html, text } = buildSubmissionApprovedEmail(baseInput);
      expect(html).toContain('info@flexsoar.net');
      expect(text).toContain('info@flexsoar.net');
    });
  });

  describe('buildCardSoldEmail', () => {
    const baseInput = {
      consignorEmail: 'seller@example.com',
      consignorHandle: 'testconsignor',
      shoeBrand: 'Nike',
      shoeModel: 'Air Jordan 1',
      shoeColorway: 'Chicago',
      shoeSizeUs: 10.5,
      salePriceCents: 25000,
      dueBy: '2026-09-03T14:30:00.000Z',
      listingUrl: 'https://flexsoar.net/market/abc123',
    };

    it('renders the subject with shoe details and urgency', () => {
      const { subject } = buildCardSoldEmail(baseInput);
      expect(subject).toContain('Your card sold');
      expect(subject).toContain('ship within 48 hours');
      expect(subject).toContain('Nike');
      expect(subject).toContain('Air Jordan 1');
      expect(subject).toContain('Chicago');
      expect(subject).toContain('US 10.5');
    });

    it('renders HTML with all shoe details, price, and deadline', () => {
      const { html } = buildCardSoldEmail(baseInput);
      expect(html).toContain('testconsignor');
      expect(html).toContain('Nike');
      expect(html).toContain('Air Jordan 1');
      expect(html).toContain('Chicago');
      expect(html).toContain('US 10.5');
      expect(html).toContain('$250.00');
      // formatDueBy outputs "Thu, Sep 3, 2026, 02:30 PM UTC" for 2026-09-03T14:30:00.000Z
      expect(html).toContain('Sep 3, 2026');
      expect(html).toContain('https://flexsoar.net/market/abc123');
    });

    it('states consignor arranges and pays their own shipping', () => {
      const { html, text } = buildCardSoldEmail(baseInput);
      expect(html).toContain('You cover the shipping cost');
      expect(html).toContain('does not pay for consignor-to-vault shipping');
      expect(text).toContain('You cover the shipping cost');
      expect(text).toContain('does not pay for consignor-to-vault shipping');
    });

    it('does NOT claim FlexSoar covers consignor shipping', () => {
      const { html, text } = buildCardSoldEmail(baseInput);
      expect(html).not.toContain('we cover');
      expect(html).not.toContain('we pay');
      expect(text).not.toContain('we cover');
      expect(text).not.toContain('we pay');
    });

    it('states consequences of not shipping in time', () => {
      const { html, text } = buildCardSoldEmail(baseInput);
      expect(html).toContain('sale is cancelled');
      expect(html).toContain('buyer is refunded');
      expect(html).toContain('Card is destroyed');
      expect(html).toContain('payout is cancelled');
      expect(html).toContain('account is restricted');
      expect(html).toContain('listings are removed');
      expect(text).toContain('sale is cancelled');
      expect(text).toContain('buyer is refunded');
      expect(text).toContain('Card is destroyed');
      expect(text).toContain('payout is cancelled');
      expect(text).toContain('account is restricted');
      expect(text).toContain('listings are removed');
    });

    it('states tracking is required and explains the protection', () => {
      const { html, text } = buildCardSoldEmail(baseInput);
      expect(html).toContain('Tracking is required');
      expect(html).toContain('Tracking is required — not optional');
      expect(html).toContain('with tracking');
      expect(html).toContain('courier loses the parcel, FlexSoar absorbs the loss');
      expect(text).toContain('Tracking is required');
      expect(text).toContain('Tracking is required — not optional');
      expect(text).toContain('with tracking');
      expect(text).toContain('courier loses the parcel, FlexSoar absorbs the loss');
    });

    it('includes support email and phone for courier questions', () => {
      const { html, text } = buildCardSoldEmail(baseInput);
      expect(html).toContain('info@flexsoar.net');
      expect(html).toContain('+601128375246');
      expect(text).toContain('info@flexsoar.net');
      expect(text).toContain('+601128375246');
    });

    it('uses the exact due_by from vault_intakes, not a recalculated value', () => {
      const { html, text } = buildCardSoldEmail(baseInput);
      expect(html).toContain('Sep 3, 2026');
      expect(text).toContain('Sep 3, 2026');
    });

    it('formats price correctly in dollars and cents', () => {
      const { html, text } = buildCardSoldEmail({
        ...baseInput,
        salePriceCents: 12345,
      });
      expect(html).toContain('$123.45');
      expect(text).toContain('$123.45');
    });

    it('formats price correctly for whole dollar amounts', () => {
      const { html, text } = buildCardSoldEmail({
        ...baseInput,
        salePriceCents: 10000,
      });
      expect(html).toContain('$100.00');
      expect(text).toContain('$100.00');
    });
  });
});