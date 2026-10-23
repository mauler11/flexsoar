import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contractErrorCode } from '@/lib/db/errors';

describe('085 executor action fence', () => {
  const sql = readFileSync(resolve(__dirname, '../supabase/migrations/085_payment_v2_executor_action_fence.sql'), 'utf8');
  const code = sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');

  it('pins all five executor RPC bodies and preserves their security metadata', () => {
    for (const hash of [
      'd20b5c54637b07d0a7ee215a82ee5b12', '2ae6463a08df57d9a7e716dcb3b3657a',
      'd474cca860a04d01656c3cad34218880', '88ff451a9dd4bb3cb3f69c4250945d9f',
      '315aa3991db6854342803f9bb01c630c',
    ]) expect(code).toContain(hash);
    expect(code).toContain('p.proowner IS DISTINCT FROM b.proowner');
    expect(code).toContain('p.proacl IS DISTINCT FROM b.proacl');
    expect(code).toContain('p.prosecdef IS DISTINCT FROM b.prosecdef');
    expect(code).toContain('p.proconfig IS DISTINCT FROM b.proconfig');
    expect(code).toContain("(SELECT count(*) FROM aclexplode(p.proacl))<>2");
    expect(code).toContain('pinned fragment count');
    expect(code).toContain('could not uniquely substitute function definition');
  });

  it('filters leases and fences every executor context or mutation route', () => {
    expect(code).toContain("op.action IN(''execute_outcome'',''acknowledge_claim'')");
    expect(code).toContain('PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN');
    expect(code).toContain('fn_payment_v2_claim_operations');
    expect(code).toContain('fn_payment_v2_finish_operation');
    expect(code).toContain('fn_payment_v2_operation_context');
    expect(code).toContain('fn_payment_v2_signed_operation');
    expect(code).toContain('fn_payment_v2_stage_signed_operation');
    expect(contractErrorCode({ message: 'PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN' })).toBe('FORBIDDEN');
  });
});
