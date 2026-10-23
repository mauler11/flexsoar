import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contractErrorCode } from '@/lib/db/errors';

describe('086 migration: issuer boundaries and refusal mapping', () => {
  const sql = readFileSync(resolve(__dirname, '../supabase/migrations/086_payment_v2_issuer_subject_nonce_leases.sql'), 'utf8');
  const code = sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');

  it('uses one transaction, pins its predecessor and refuses funding-on and replay', () => {
    expect(sql).not.toMatch(/\r/);
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain('PAYMENT_V2_FUNDING_ENABLED');
    expect(code).toContain('PAYMENT_V2_ISSUER_086_ALREADY_APPLIED');
    expect(code).toContain('PAYMENT_V2_ISSUER_PREEXISTING_FUNCTION_CHANGED');
    expect(code).toContain('PAYMENT_V2_ISSUER_ACL_MATRIX');
  });

  it('maps issuer and lease refusals into stable existing contract codes', () => {
    const cases = [
      ['PAYMENT_V2_ISSUER_KIND_UNSUPPORTED', 'INVALID_AMOUNT'],
      ['PAYMENT_V2_ISSUER_NULLABILITY', 'INVALID_AMOUNT'],
      ['PAYMENT_V2_ISSUER_SUBJECT_MISSING', 'NOT_FOUND'],
      ['PAYMENT_V2_ISSUER_IDENTITY_MISMATCH', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_NONCE_MALFORMED', 'INVALID_AMOUNT'],
      ['PAYMENT_V2_ISSUER_NONCE_REPLAY', 'WRONG_STATUS'],
      ['PAYMENT_V2_ISSUER_KEY_INACTIVE', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_KEY_LIFECYCLE', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_KEY_OWNER_ONLY', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_KEY_STATE_INVALID', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_EVENT_GUARD_ACL', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_SEQUENCE_ACL', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_CLEANUP_FORBIDDEN', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_FENCE_EXHAUSTED', 'INVALID_AMOUNT'],
      ['PAYMENT_V2_ISSUER_FINISH_OUTCOME', 'INVALID_AMOUNT'],
      ['PAYMENT_V2_ISSUER_SIGNATURE_SHAPE', 'INVALID_AMOUNT'],
      ['PAYMENT_V2_OPERATION_LEASE_LOST', 'WRONG_STATUS'],
      ['PAYMENT_V2_OPERATION_RESOLUTION_CONFLICT', 'WRONG_STATUS'],
      ['PAYMENT_V2_OPERATION_IDENTITY_IMMUTABLE', 'FORBIDDEN'],
      ['PAYMENT_V2_TERMS_IMMUTABLE', 'FORBIDDEN'],
      ['PAYMENT_V2_FUNDING_ENABLED', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_OPERATION_TERMS_GUARD_DRIFT', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_OPERATION_TERMS_GUARD_POSTGUARD', 'FORBIDDEN'],
      ['PAYMENT_V2_ISSUER_ALLOWED_ROLE_ACL', 'FORBIDDEN'],
    ] as const;
    for (const [message, code] of cases) expect(contractErrorCode({ message })).toBe(code);
  });
});
