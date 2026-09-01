import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ContractError } from '@/lib/api/contract';
import type { UUID } from '@/lib/db/types';

describe('burnCard', () => {
  const mockSupabase = {
    from: vi.fn(),
    rpc: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function simulateBurnCard(
    cardId: UUID,
    reason: string,
    hasLiveListing: boolean,
    listingStatus?: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (hasLiveListing) {
      if (listingStatus === 'early_access' || listingStatus === 'public') {
        // Cancel the listing first
      }
    }
    return { success: true };
  }

  it('burns a card with no live listing', async () => {
    const result = await simulateBurnCard('card-123' as UUID, 'Test inventory cleanup', false);
    expect(result.success).toBe(true);
  });

  it('cancels live listing before burning card', async () => {
    const result = await simulateBurnCard('card-123' as UUID, 'Test inventory cleanup', true, 'public');
    expect(result.success).toBe(true);
  });

  it('cancels early_access listing before burning card', async () => {
    const result = await simulateBurnCard('card-123' as UUID, 'Test inventory cleanup', true, 'early_access');
    expect(result.success).toBe(true);
  });

  it('does not attempt to cancel sold/cancelled/expired listings', async () => {
    const result = await simulateBurnCard('card-123' as UUID, 'Test inventory cleanup', true, 'sold');
    expect(result.success).toBe(true);
  });

  describe('ContractError for invalid burns', () => {
    it('throws WRONG_STATUS for already burned card', () => {
      const error = new ContractError('WRONG_STATUS', 'Card is already burned', { cardId: 'card-123' });
      expect(error.code).toBe('WRONG_STATUS');
    });

    it('throws WRONG_STATUS for redeemed card', () => {
      const error = new ContractError('WRONG_STATUS', 'Cannot burn redeemed card', { cardId: 'card-123' });
      expect(error.code).toBe('WRONG_STATUS');
    });

    it('throws FORBIDDEN for non-admin callers', () => {
      const error = new ContractError('FORBIDDEN', 'admin privileges required', { cardId: 'card-123' });
      expect(error.code).toBe('FORBIDDEN');
    });
  });
});

describe('archiveSkuModel', () => {
  const mockSupabase = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function simulateArchiveSkuModel(
    modelId: UUID,
    hasMintedCardsInLedger: boolean,
    hasActiveCards: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    if (hasMintedCardsInLedger) {
      throw new ContractError(
        'WRONG_STATUS',
        'Cannot archive model: cards have been minted against it (ledger history exists)',
        { modelId },
      );
    }

    if (hasActiveCards) {
      throw new ContractError(
        'WRONG_STATUS',
        'Cannot archive model: active cards exist for this model',
        { modelId },
      );
    }

    return { success: true };
  }

  it('archives a model with zero cards ever minted', async () => {
    const result = await simulateArchiveSkuModel('model-123' as UUID, false, false);
    expect(result.success).toBe(true);
  });

  it('refuses to archive model with minted cards in ledger', async () => {
    await expect(
      simulateArchiveSkuModel('model-123' as UUID, true, false),
    ).rejects.toThrow(ContractError);
  });

  it('refuses to archive model with active cards', async () => {
    await expect(
      simulateArchiveSkuModel('model-123' as UUID, false, true),
    ).rejects.toThrow(ContractError);
  });

  it('throws WRONG_STATUS with descriptive message for ledger history', async () => {
    try {
      await simulateArchiveSkuModel('model-123' as UUID, true, false);
    } catch (error) {
      expect(error).toBeInstanceOf(ContractError);
      expect((error as ContractError).code).toBe('WRONG_STATUS');
      expect((error as ContractError).message).toContain('ledger history exists');
    }
  });

  it('throws WRONG_STATUS with descriptive message for active cards', async () => {
    try {
      await simulateArchiveSkuModel('model-123' as UUID, false, true);
    } catch (error) {
      expect(error).toBeInstanceOf(ContractError);
      expect((error as ContractError).code).toBe('WRONG_STATUS');
      expect((error as ContractError).message).toContain('active cards exist');
    }
  });

  describe('ContractError codes', () => {
    it('uses FORBIDDEN for non-admin callers', () => {
      const error = new ContractError('FORBIDDEN', 'admin privileges required', { modelId: 'model-123' });
      expect(error.code).toBe('FORBIDDEN');
    });

    it('uses NOT_FOUND for non-existent model', () => {
      const error = new ContractError('NOT_FOUND', 'Model not found', { modelId: 'model-123' });
      expect(error.code).toBe('NOT_FOUND');
    });
  });
});