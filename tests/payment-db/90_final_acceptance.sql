-- AUTHOR ONLY / NOT RUN. The ONLY final acceptance entry point. Isolated administrator.
-- Missing checkpoints are fatal, even though53 intentionally permits incremental runs.
\ir 00_target_guard.sql
\ir 46_worker_results.sql
\ir 53_race_assert.sql
BEGIN;
-- Additional mandatory checkpoint; the original34 remain unchanged.
SELECT payment_db_acceptance.assert_true((SELECT count(1)=1 AND bool_and(scenario='encoding' AND comparison->>'actual'=comparison->>'expected' AND length(comparison->>'actual')=1380) FROM payment_db_codec.completion),'successful encoding checkpoint');
SELECT payment_db_acceptance.assert_true((SELECT count(1)=2 AND bool_and(scenario IN('terms_guard','exact_fee')) FROM payment_db_repairs.completions),'successful shared-trigger and exact-fee regressions');
DO $final$
DECLARE required text;missing text;role_name text;c record;a_pid integer;b_pid integer;
BEGIN
 SELECT string_agg(r.scenario,', ' ORDER BY r.scenario) INTO missing
 FROM unnest(ARRAY[
  'core:10','core:20','core:30','expiry','worker_results','signed_storage',
  'worker:issuer','worker:verifier','worker:settler','worker:executor','worker:notifier',
  'duplicate:0:a','duplicate:0:b','duplicate:1:a','duplicate:1:b',
  'race:conflicting_signature','race:conflicting_attempt','race:funding_cancel',
  'race:funding_revoke','race:revoked_funding','race:rollback','rollback_ack',
  'race:release_refund','race:refund_release','race:operations','race:outbox',
  'race:operation_takeover','race:outbox_takeover',
  'terminal:release_refund:a','terminal:release_refund:b',
  'terminal:refund_release:a','terminal:refund_release:b',
  'stale:operation_takeover','stale:outbox_takeover'
 ]) r(scenario)
 WHERE NOT EXISTS(SELECT 1 FROM payment_db_acceptance.completions x WHERE x.scenario=r.scenario);
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'INCOMPLETE PAYMENT DB SUITE. Missing successful checkpoints: %',missing;END IF;
 -- Markers never excuse missing current fixture/result rows; avoid zero-row loops.
 PERFORM payment_db_acceptance.assert_true((SELECT count(1)=3 AND bool_and(name IN('escrow','direct','operations')) FROM payment_db_workers.cases),'complete worker case inventory');
 PERFORM payment_db_acceptance.assert_true((SELECT count(1)=12 AND bool_and(name IN('conflicting_signature','conflicting_attempt','funding_cancel','funding_revoke','revoked_funding','rollback','release_refund','refund_release','operations','outbox','operation_takeover','outbox_takeover')) FROM payment_db_races.cases),'complete race case inventory');
 -- Explicit successful dedicated-connection checkpoints, not fixture existence.
 FOREACH role_name IN ARRAY ARRAY['issuer','verifier','settler','executor','notifier'] LOOP
  PERFORM payment_db_acceptance.assert_true((SELECT login=('payment_db_test_'||role_name)::name FROM payment_db_acceptance.completions WHERE scenario='worker:'||role_name),'worker completion identity: '||role_name);
 END LOOP;
 PERFORM payment_db_acceptance.assert_true((SELECT count(DISTINCT login)=5 FROM payment_db_acceptance.completions WHERE scenario LIKE 'worker:%'),'five actual dedicated worker identities');
 FOR c IN SELECT name FROM payment_db_races.cases LOOP
  SELECT backend_pid INTO a_pid FROM payment_db_races.observations WHERE name=c.name AND side='a';
  SELECT backend_pid INTO b_pid FROM payment_db_races.observations WHERE name=c.name AND side='b';
  IF c.name='rollback' THEN SELECT backend_pid INTO a_pid FROM payment_db_acceptance.completions WHERE scenario='rollback_ack';END IF;
  PERFORM payment_db_acceptance.assert_true(a_pid IS NOT NULL AND b_pid IS NOT NULL AND a_pid<>b_pid,'distinct A/B backends: '||c.name);
 END LOOP;
 FOREACH required IN ARRAY ARRAY['release_refund','refund_release'] LOOP
  PERFORM payment_db_acceptance.assert_true((SELECT count(1)=2 FROM payment_db_races.observations WHERE name=required AND side IN('consume_a','consume_b')),'both retained terminal consumption results: '||required);
  PERFORM payment_db_acceptance.assert_true((SELECT a.backend_pid<>b.backend_pid FROM payment_db_acceptance.completions a JOIN payment_db_acceptance.completions b ON b.scenario='terminal:'||required||':b' WHERE a.scenario='terminal:'||required||':a'),'distinct terminal consumer backends: '||required);
 END LOOP;
 FOREACH required IN ARRAY ARRAY['0','1'] LOOP
  PERFORM payment_db_acceptance.assert_true((SELECT a.backend_pid<>b.backend_pid FROM payment_db_acceptance.completions a JOIN payment_db_acceptance.completions b ON b.scenario='duplicate:'||required||':b' WHERE a.scenario='duplicate:'||required||':a'),'distinct duplicate consumer backends: '||required);
 END LOOP;
 PERFORM payment_db_acceptance.assert_true((SELECT login='payment_db_race_executor_a' FROM payment_db_acceptance.completions WHERE scenario='stale:operation_takeover'),'actual stale executor completion');
 PERFORM payment_db_acceptance.assert_true((SELECT login='payment_db_race_notifier_a' FROM payment_db_acceptance.completions WHERE scenario='stale:outbox_takeover'),'actual stale notifier completion');
END $final$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT payment_db_acceptance.complete('final','{"suiteVersion":"payment-db-completeness-3","requiredCheckpoints":37}'::jsonb);
COMMIT;
-- This success record is printed ONLY after the final transaction committed.
SELECT scenario,login,backend_pid,completed_at,details FROM payment_db_acceptance.completions WHERE scenario='final';
\echo 'PAYMENT_DB_FINAL_ACCEPTANCE_COMPLETE: committed explicit completion record; retain this transcript.'
