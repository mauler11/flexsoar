// Proves the shared psql target guard exits on a missing acknowledgement and
// does not execute the first statement after the include. Isolated test DB only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const container = process.argv[2];
assert.equal(container, '733813cfd1b173d984ef248ed6518b921cd37e3c3fdf57c30d51f1c33b290518', 'explicit authorized container required');
const database = 'flexsoar_payment_v2_test';
const table = `payment_db_guard_sentinel_${randomBytes(8).toString('hex')}`;

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

function psql(sql) {
  const result = docker(['exec', '-e', 'PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only', container,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', database, '-c', sql]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

try {
  assert.equal(psql(`SELECT current_database()||'|'||inet_server_addr()||'|'||current_setting('payment_v2.test_identity',true)`),
    'flexsoar_payment_v2_test|127.0.0.1/32|synthetic-payment-v2-only', 'isolated target guard');
  psql(`CREATE TABLE public.${table}(executed boolean NOT NULL); INSERT INTO public.${table} VALUES(false)`);

  // Deliberately omit payment_v2_test_ack. ON_ERROR_STOP=1 must turn the guard
  // exception into a non-zero process exit before this UPDATE can run.
  const script = `\\set ON_ERROR_STOP on\n\\ir /tmp/payment-db-tests/00_target_guard.sql\nUPDATE public.${table} SET executed=true;\n\\echo GUARD_SENTINEL_AFTER_GUARD\n`;
  const rejected = docker(['exec', '-i', '-e', 'PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only', container,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', database, '-f', '-'], { input: script });
  assert.notEqual(rejected.status, 0, 'missing acknowledgement must exit non-zero');
  assert.match(rejected.stderr, /REFUSING: pass -v payment_v2_test_ack/);
  assert.doesNotMatch(rejected.stdout, /GUARD_SENTINEL_AFTER_GUARD/);
  assert.equal(psql(`SELECT executed::text FROM public.${table}`), 'false', 'no statement after a refused guard executed');
  process.stdout.write('GUARD_FAIL_CLOSED_SELFTEST_PASS: missing ack exited non-zero; sentinel unchanged\n');
} finally {
  psql(`DROP TABLE IF EXISTS public.${table}`);
}
