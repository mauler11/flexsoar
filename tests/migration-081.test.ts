// track/payment-security (081): the migration only revokes EXECUTE on fn_set_card_visibility from PUBLIC and anon.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('081 migration file: ACL-only shape', () => {
  const sql = readFileSync(resolve(__dirname, '../supabase/migrations/081_revoke_public_set_card_visibility.sql'), 'utf8');
  const code = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

  it('is ASCII with LF line ends, and one transaction', () => {
    expect(sql).not.toMatch(/\r/);
    expect(sql).toMatch(/^[\x00-\x7f]*$/);
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('revokes from PUBLIC and anon only, grants nothing, and hard-codes no row ids', () => {
    expect(code.match(/^REVOKE .*$/gm)).toEqual(['REVOKE EXECUTE ON FUNCTION public.fn_set_card_visibility(uuid,boolean) FROM PUBLIC, anon;']);
    expect(code).not.toMatch(/^\s*GRANT /m);
    expect(code).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('changes no data and no function body', () => {
    expect(code).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\./i);
    expect(code).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\./i);
    expect(code).not.toMatch(/\bEXECUTE\s+(v_def|replace)/i);
  });

  it('asserts the exact ACL after and refuses a re-run', () => {
    expect(code).toContain("ARRAY['authenticated:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']");
    expect(code).toContain('no longer grants EXECUTE to PUBLIC');
    expect(code).toContain("'48282c3898dfddb172b45b6fcf4f1f7c'"); // 046 body, CR-stripped
    expect(code).toContain("'4f1b8f8396b0656d275a545c55447d50'"); // requires 080
  });
});
