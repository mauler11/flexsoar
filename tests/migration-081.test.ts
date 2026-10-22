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

describe('081b migration file: one-off test-item retirement shape', () => {
  const sql = readFileSync(resolve(__dirname, '../supabase/migrations/081b_retire_prelaunch_test_item.sql'), 'utf8');
  const code = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

  it('is ASCII with LF line ends, and one transaction', () => {
    expect(sql).not.toMatch(/\r/);
    expect(sql).toMatch(/^[\x00-\x7f]*$/);
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('names only the five founder-approved rows', () => {
    const ids = new Set(code.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi));
    expect([...ids].sort()).toEqual([
      '0d90f5e4-b4dc-4783-8b07-c6412df3fd16', // card
      '478ef5b4-2cc4-431c-8754-c0f33d3f0e75', // order
      '4b59ace6-1af4-48aa-9370-b73662a2850e', // vault intake
      '89887db1-dba3-46ec-994c-3125d8513b70', // item
      'f39fbe1f-979e-4237-a9f9-ed9f9dcc67e6', // listing
    ]);
  });

  it('writes only the card status, the intake status/note and (zero) live listings; never orders, ledger, items or provenance; no deletes or inserts', () => {
    const updates = code.match(/UPDATE public\.\w+ SET [^;]*/g) ?? [];
    expect(updates.map((u) => u.replace(/\s+/g, ' ').match(/UPDATE public\.(\w+) SET (\w+)/)!.slice(1).join('.'))).toEqual([
      'listings.status', 'cards.status', 'vault_intakes.status',
    ]);
    expect(code).toMatch(/UPDATE public\.vault_intakes SET status='cancelled', note=/);
    expect(code).toMatch(/UPDATE public\.cards SET status='burned' WHERE id=k\.card_id AND status='pending_vault'/);
    expect(code).not.toMatch(/\b(DELETE\s+FROM|INSERT\s+INTO\s+public\.|TRUNCATE)\b/i);
    expect(code).not.toMatch(/UPDATE public\.(orders|ledger_entries|items|card_provenance|notifications)\b/);
  });

  it('requires 080 and 081, guards every inventory value, and refuses a partial set', () => {
    for (const s of ['080 is not applied', '081 is not applied', "c.status='pending_vault'", "v.status='awaiting_shipment'",
      "o.status='settled'", 'NOT o.paid_out', "i.custody='seller'", "i.status='minted'", "i.grade_source='seller_declared'",
      'i.authenticated_at IS NULL', 'i.review_approved_at IS NOT NULL', 'refusing a partial retirement',
      "status IN ('active','locked','pending_vault')"]) {
      expect(code).toContain(s);
    }
  });
});
