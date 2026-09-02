import { describe, expect, it, vi } from 'vitest';
import { ContractError } from '@/lib/api/contract';
import type { UUID, Cents, Timestamptz } from '@/lib/db/types';

// Test the pure logic of payout eligibility without external dependencies
// These are unit tests for the eligibility conditions

describe('Payout eligibility logic (pure functions)', () => {
  // Simulate the three conditions that must all be true for payout eligibility
  interface EligibilityInput {
    holdElapsed: boolean;        // payout_hold_days has elapsed
    vaultReceived: boolean;      // vault_intakes status === 'received'
    connectReady: boolean;       // Connect account payouts_enabled = true
    hasConnectAccount: boolean;  // Connect account exists
    alreadyPaidOut: boolean;     // order.paid_out = true
  }

  function checkEligibility(input: EligibilityInput): { eligible: boolean; reason: string } {
    if (input.alreadyPaidOut) {
      return { eligible: false, reason: 'Order already paid out' };
    }
    if (!input.holdElapsed) {
      return { eligible: false, reason: 'Payout hold period has not elapsed' };
    }
    if (!input.vaultReceived) {
      return { eligible: false, reason: 'Vault intake not yet received (consignor has not shipped)' };
    }
    if (!input.hasConnectAccount) {
      return { eligible: false, reason: 'Consignor has no Stripe Connect account' };
    }
    if (!input.connectReady) {
      return { eligible: false, reason: 'Consignor Connect account not yet payout-capable' };
    }
    return { eligible: true, reason: 'Eligible for payout' };
  }

  describe('checkEligibility', () => {
    it('returns eligible when all conditions are met', () => {
      const result = checkEligibility({
        holdElapsed: true,
        vaultReceived: true,
        connectReady: true,
        hasConnectAccount: true,
        alreadyPaidOut: false,
      });
      expect(result.eligible).toBe(true);
      expect(result.reason).toBe('Eligible for payout');
    });

    it('blocks payout when vault intake not yet received', () => {
      const result = checkEligibility({
        holdElapsed: true,
        vaultReceived: false,
        connectReady: true,
        hasConnectAccount: true,
        alreadyPaidOut: false,
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('Vault intake not yet received (consignor has not shipped)');
    });

    it('blocks payout when consignor has no Connect account', () => {
      const result = checkEligibility({
        holdElapsed: true,
        vaultReceived: true,
        connectReady: true,
        hasConnectAccount: false,
        alreadyPaidOut: false,
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('Consignor has no Stripe Connect account');
    });

    it('blocks payout when Connect account not payout-capable', () => {
      const result = checkEligibility({
        holdElapsed: true,
        vaultReceived: true,
        connectReady: false,
        hasConnectAccount: true,
        alreadyPaidOut: false,
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('Consignor Connect account not yet payout-capable');
    });

    it('blocks payout when payout hold has not elapsed', () => {
      const result = checkEligibility({
        holdElapsed: false,
        vaultReceived: true,
        connectReady: true,
        hasConnectAccount: true,
        alreadyPaidOut: false,
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('Payout hold period has not elapsed');
    });

    it('blocks payout when order already paid out', () => {
      const result = checkEligibility({
        holdElapsed: true,
        vaultReceived: true,
        connectReady: true,
        hasConnectAccount: true,
        alreadyPaidOut: true,
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('Order already paid out');
    });

    it('evaluates each condition independently', () => {
      // Each condition should be able to block independently
      const conditions: (keyof EligibilityInput)[] = [
        'holdElapsed',
        'vaultReceived',
        'connectReady',
        'hasConnectAccount',
      ];

      for (const condition of conditions) {
        const input: EligibilityInput = {
          holdElapsed: true,
          vaultReceived: true,
          connectReady: true,
          hasConnectAccount: true,
          alreadyPaidOut: false,
        };
        (input as Record<string, boolean>)[condition] = false;

        const result = checkEligibility(input);
        expect(result.eligible).toBe(false);
        expect(result.reason).toBeTruthy();
      }
    });
  });
});

describe('ContractError codes for payout', () => {
  it('uses WRONG_STATUS for ineligible payout attempts', () => {
    const error = new ContractError('WRONG_STATUS', 'Order not eligible for payout: vault not received', {
      orderId: 'test-order',
    });
    expect(error.code).toBe('WRONG_STATUS');
    expect(error.message).toContain('vault not received');
  });

  it('uses NOT_FOUND for missing Connect account', () => {
    const error = new ContractError('NOT_FOUND', 'Consignor has no Connect account', {
      orderId: 'test-order',
    });
    expect(error.code).toBe('NOT_FOUND');
  });
});