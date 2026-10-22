// track/payment-security (082): solo-operator mode. Static shape only; behaviour is proven by tests/payment-db/83_solo_mode.sql.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('082 migration file: solo-operator mode shape', () => {
  const sql = readFileSync(resolve(__dirname, '../supabase/migrations/082_payment_v2_solo_operator_mode.sql'), 'utf8');
  const code = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

  it('is ASCII with LF line ends, and one transaction', () => {
    expect(sql).not.toMatch(/\r/);
    expect(sql).toMatch(/^[\x00-\x7f]*$/);
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('pins the five repaired bodies (CR-stripped md5) and requires 081 and funding off', () => {
    for (const pin of [
      'acf12f3b68d0d34e5b50eecc00c5bdc5', // funding_configuration
      'db6edf3353edc291be17a86f6961610d', // fn_payment_v2_reconcile_event
      'b39743787b470eaf8bae4d6850666060', // fn_payment_v2_record_decision
      'bb694b168d7742fa9a70211783f707ac', // correspondence
      'da1c77135458064ea339c4adbf628e88', // fn_payment_v2_approve_refund
    ]) expect(code).toContain(`'${pin}'`);
    expect(code).toContain("082: 081 is not applied");
    expect(code).toContain("082: funding must be disabled on every network");
  });

  it('starts in today\'s mode and the table enforces the solo floor', () => {
    expect(code).toContain("VALUES('separated',3,0);");
    expect(code).toContain("CHECK(operational_separation='separated' OR (governors_required=2 AND release_delay_seconds>=86400))");
  });

  it('touches no public table data and hard-codes no row ids', () => {
    expect(code).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\./i);
    expect(code).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('grants the three governance RPCs to authenticated only, and closes the CREATE-on-public bracket in the same transaction', () => {
    expect(code.match(/^\s*GRANT .*$/gm)?.map((g) => g.trim())).toEqual(['GRANT CREATE ON SCHEMA public TO payment_v2_owner;']);
    expect(code.match(/GRANT EXECUTE[^']*/g)).toEqual(['GRANT EXECUTE ON FUNCTION %s TO authenticated']);
    expect(code).toContain("EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f);");
    expect(code).toContain('REVOKE CREATE ON SCHEMA public FROM payment_v2_owner;');
    expect(code).toContain('082: payment_v2_owner still has CREATE on public');
  });

  it('judges reconciliation by the mode stamped on the release decision, not the current mode', () => {
    expect(code).toContain('payment_v2.independent_actor((SELECT md.mode_at_decision FROM payment_v2.decisions md WHERE md.id=d.id),ad.person_id');
    expect(code).toContain("CASE (SELECT md.mode_at_decision FROM payment_v2.decisions md WHERE md.id=d.id) WHEN 'solo' THEN 86400 ELSE 0 END");
  });
});
