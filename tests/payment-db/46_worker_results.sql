-- NOT RUN. Human administrator verifies exact persisted results after36..40 worker sessions.
\ir 00_target_guard.sql
BEGIN;
SELECT payment_db_workers.assert_true(NOT has_any_column_privilege('payment_v2_owner','public.users','UPDATE'),'no user mutation grant');
DO $check$ DECLARE c record;n bigint;BEGIN
 FOR c IN SELECT name,f FROM payment_db_workers.cases WHERE name IN('escrow','direct') LOOP
  PERFORM payment_db_workers.assert_true((SELECT authorized_by='payment_db_test_issuer' FROM payment_v2.attempts WHERE id=(c.f->>'attempt')::uuid),'actual issuer identity');
  PERFORM payment_db_workers.assert_true((SELECT verifier_login='payment_db_test_verifier' FROM payment_v2.events WHERE id=(c.f->>'event')::uuid),'actual verifier identity');
  SELECT count(1) INTO n FROM public.orders WHERE payment_v2_attempt_id=(c.f->>'attempt')::uuid;
  PERFORM payment_db_workers.assert_true(n=1,'one order under dedicated settler');
  PERFORM payment_db_workers.assert_true((SELECT consumed_by='payment_db_test_settler' FROM payment_v2.consumptions WHERE event_id=(c.f->>'event')::uuid),'real dedicated consumer audit identity');
  PERFORM payment_db_workers.assert_true((SELECT owner_id=(c.f->>'buyer')::uuid AND status=CASE c.name WHEN 'escrow' THEN 'pending_vault'::public.card_status ELSE 'active'::public.card_status END FROM public.cards WHERE id=(c.f->>'card')::uuid),'exact claim owner/status');
  PERFORM payment_db_workers.assert_true((SELECT count(1)=1 FROM payment_v2.consumptions WHERE event_id=(c.f->>'event')::uuid),'one consumption');
  PERFORM payment_db_workers.assert_true((SELECT count(1)=2 FROM payment_v2.outbox WHERE event_id=(c.f->>'event')::uuid),'two recipient jobs');
  PERFORM payment_db_workers.assert_true((SELECT sum(units)=0 FROM payment_v2.usdc_journal WHERE event_id=(c.f->>'event')::uuid),'USDC balances');
 END LOOP;
END $check$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT payment_db_acceptance.complete('worker_results','{}'::jsonb);
COMMIT;
