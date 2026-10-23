import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contractErrorCode } from '@/lib/db/errors';

describe('084 migration: wallet enrollment and narrow readers', () => {
  const sql = readFileSync(resolve(__dirname, '../supabase/migrations/084_payment_v2_wallet_enrollment_and_views.sql'), 'utf8');
  const code = sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');

  it('is ASCII LF and uses one transaction with self-relative body and ACL guards', () => {
    expect(sql).not.toMatch(/\r/);
    expect(sql).toMatch(/^[\x00-\x7f]*$/);
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain('m084_before');
    expect(code).toContain('pre-existing function % changed');
    expect(code).toContain('a pre-existing function disappeared');
    expect(code).toContain('084: unexpected EXECUTE privilege for % on %');
  });

  it('pins the 083 base, funding-off state, wallet immutability and all new signatures', () => {
    expect(code).toContain('084: 082 and 083 are not applied');
    expect(code).toContain('084: funding must be disabled on every network');
    expect(code).toContain("t.tgenabled='O' AND t.tgtype=27 AND t.tgnargs=0 AND t.tgqual IS NULL");
    expect(code).toContain("md5(replace(p.prosrc,chr(13),''))='c13177e3b317e9c215f7d8d7679feafa'");
    expect(code).toContain('wallet_accounts keys or NOT NULL columns are not the expected definition');
    expect(code).toContain('wallet_accounts table ACL or owner is not owner-only');
    expect(code).toContain('WITH eligible AS');
    expect(code).toContain('LIMIT p_limit');
    for (const signature of [
      'fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)',
      'fn_payment_v2_listing_view(uuid)',
      'fn_payment_v2_governance_projection()',
      'fn_payment_v2_open_sale_queue(integer)',
    ]) expect(code).toContain(signature);
  });

  it('keeps the writer issuer-only and asserts SQL-side enrollment checks', () => {
    expect(code).toContain("payment_v2.require_role('payment_v2_issuer')");
    expect(code).toContain("v_country IS DISTINCT FROM 'MY'");
    expect(code).toContain('v_address IS DISTINCT FROM payment_v2.b58(p_wallet)');
    expect(code).toContain('PAYMENT_V2_WALLET_NETWORK_UNKNOWN');
    expect(code).toContain('PAYMENT_V2_WALLET_TOKEN_ACCOUNT_USED');
    expect(code).toContain('PAYMENT_V2_WALLET_ENROLLMENT_CONFLICT');
    expect(code).toContain('ON CONFLICT DO NOTHING');
    expect(code).toContain("TO payment_v2_issuer");
  });

  it('owner-checks seller data and returns the exact governance projection fields', () => {
    expect(code).toContain('s.seller_id=u');
    expect(code).toContain("PAYMENT_V2_LISTING_NOT_YOURS");
    expect(code).toContain('RETURNS TABLE(operational_separation text,governors_required integer,release_delay_seconds integer)');
    expect(code).toContain('TO payment_v2_verifier');
  });

  it('maps every new refusal family to a stable contract error code', () => {
    const cases = [
      ['PAYMENT_V2_WALLET_USER_NOT_MY', 'FORBIDDEN'],
      ['PAYMENT_V2_WALLET_ADDRESS_MISMATCH', 'NOT_OWNER'],
      ['PAYMENT_V2_WALLET_NETWORK_UNKNOWN', 'NOT_FOUND'],
      ['PAYMENT_V2_WALLET_MALFORMED', 'WRONG_STATUS'],
      ['PAYMENT_V2_WALLET_ENROLLMENT_CONFLICT', 'WRONG_STATUS'],
      ['PAYMENT_V2_WALLET_TOKEN_ACCOUNT_USED', 'WRONG_STATUS'],
      ['PAYMENT_V2_LISTING_NOT_YOURS', 'NOT_OWNER'],
      ['PAYMENT_V2_OPEN_SALE_LIMIT', 'INVALID_AMOUNT'],
    ] as const;
    for (const [message, code] of cases) expect(contractErrorCode({ message })).toBe(code);
  });
});
