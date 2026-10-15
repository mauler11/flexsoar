-- NOT RUN. Human administrator, after both committed barriers (and56 for terminals).
\ir 00_target_guard.sql
BEGIN;
DO $check$ DECLARE c record;a jsonb;b jsonb;expected_events int;expected_journal int;expected_claims int;expected_status public.card_status;expected_owner uuid;actual bigint;BEGIN
 FOR c IN SELECT name,f FROM payment_db_races.cases LOOP
  SELECT payload INTO a FROM payment_db_races.observations WHERE name=c.name AND side='a';
  SELECT payload INTO b FROM payment_db_races.observations WHERE name=c.name AND side='b';
  -- Run assertions only after this named case has completed; missing observations are explicit below for rollback.
  IF b IS NULL THEN CONTINUE;END IF;
  IF c.name IN('operations','outbox','operation_takeover','outbox_takeover') THEN
   PERFORM payment_db_races.assert_true(a IS NOT NULL AND jsonb_array_length(a)=1 AND jsonb_array_length(b)=1,'one durable lease each');
   PERFORM payment_db_races.assert_true((a->0->>'leaseId')<>(b->0->>'leaseId'),'unique lease identities');
   PERFORM payment_db_races.assert_true(((a->0->>'id')=(b->0->>'id'))=(c.name LIKE '%takeover'),'same job only for expired takeover; SKIP LOCKED jobs differ');
   PERFORM payment_db_races.assert_true((SELECT count(DISTINCT login)=2 FROM payment_db_races.observations WHERE name=c.name),'two actual login identities');
   CONTINUE;
  END IF;
  IF c.name='rollback' THEN PERFORM payment_db_races.assert_true(a IS NULL,'A provisional receipt/observations rolled back');ELSE PERFORM payment_db_races.assert_true(a IS NOT NULL,'A committed');END IF;
  IF c.name='revoked_funding' THEN
   PERFORM payment_db_races.assert_true(NOT EXISTS(SELECT 1 FROM payment_v2.events WHERE sale_id=(c.f->>'sale')::uuid),'no contradictory financial evidence');
   PERFORM payment_db_races.assert_true(NOT EXISTS(SELECT 1 FROM public.orders WHERE payment_v2_attempt_id=(c.f->>'attempt')::uuid),'no order');
   PERFORM payment_db_races.assert_true((SELECT owner_id=(c.f->>'seller')::uuid AND status='active' FROM public.cards WHERE id=(c.f->>'card')::uuid),'no claim movement');
   PERFORM payment_db_races.assert_true((SELECT status='cancelled' FROM public.listings WHERE id=(c.f->>'listing')::uuid),'canonical revocation closes listing');CONTINUE;
  END IF;
  expected_events:=CASE WHEN c.name IN('release_refund','refund_release') THEN 2 ELSE 1 END;
  expected_journal:=CASE c.name WHEN 'release_refund' THEN 5 WHEN 'refund_release' THEN 4 ELSE 2 END;
  expected_claims:=CASE c.name WHEN 'refund_release' THEN 2 ELSE 1 END;
  expected_owner:=CASE c.name WHEN 'refund_release' THEN (c.f->>'seller')::uuid ELSE (c.f->>'buyer')::uuid END;
  expected_status:=CASE c.name WHEN 'release_refund' THEN 'active'::public.card_status WHEN 'refund_release' THEN 'locked'::public.card_status ELSE 'pending_vault'::public.card_status END;
  PERFORM payment_db_races.assert_true((SELECT count(1)=1 FROM public.orders WHERE payment_v2_attempt_id=(c.f->>'attempt')::uuid),'one corresponding order');
  PERFORM payment_db_races.assert_true((SELECT owner_id=expected_owner AND status=expected_status FROM public.cards WHERE id=(c.f->>'card')::uuid),'exact claim cache');
  PERFORM payment_db_races.assert_true((SELECT sum(direction)=1 FROM public.ledger_entries WHERE card_id=(c.f->>'card')::uuid AND asset='card' AND account_id=expected_owner),'exact ledger owner');
  PERFORM payment_db_races.assert_true((SELECT count(1)=expected_claims*2 FROM public.ledger_entries WHERE card_id=(c.f->>'card')::uuid AND entry_type='card_transfer'),'no partial/duplicate Card transfer');
  PERFORM payment_db_races.assert_true((SELECT count(1)=expected_claims FROM payment_v2.claim_history WHERE card_id=(c.f->>'card')::uuid),'append-only provenance count');
  PERFORM payment_db_races.assert_true((SELECT count(1)=expected_events FROM payment_v2.events WHERE sale_id=(c.f->>'sale')::uuid),'no conflicting verified event');
  PERFORM payment_db_races.assert_true((SELECT count(1)=expected_events FROM payment_v2.consumptions x JOIN payment_v2.events e ON e.id=x.event_id WHERE e.sale_id=(c.f->>'sale')::uuid),'exact consumption count');
  PERFORM payment_db_races.assert_true((SELECT count(1)=expected_events*2 FROM payment_v2.outbox x JOIN payment_v2.events e ON e.id=x.event_id WHERE e.sale_id=(c.f->>'sale')::uuid),'exact atomic outbox count');
  PERFORM payment_db_races.assert_true((SELECT count(1)=expected_journal FROM payment_v2.usdc_journal j JOIN payment_v2.events e ON e.id=j.event_id WHERE e.sale_id=(c.f->>'sale')::uuid),'exact journal legs');
  PERFORM payment_db_races.assert_true(NOT EXISTS(SELECT 1 FROM payment_v2.usdc_journal j JOIN payment_v2.events e ON e.id=j.event_id WHERE e.sale_id=(c.f->>'sale')::uuid GROUP BY j.event_id,j.mint HAVING sum(j.units)<>0),'balanced per-event USDC');
  IF c.name='funding_cancel' THEN PERFORM payment_db_races.assert_true((SELECT status='sold' FROM public.listings WHERE id=(c.f->>'listing')::uuid),'funding won, pending cancellation cannot override');END IF;
  IF c.name IN('release_refund','refund_release') AND EXISTS(SELECT 1 FROM payment_db_races.observations WHERE name=c.name AND side IN('consume_a','consume_b')) THEN
   PERFORM payment_db_races.assert_true((SELECT count(1)=2 FROM payment_db_races.observations WHERE name=c.name AND side IN('consume_a','consume_b')),'both terminal consumer barriers committed');
   PERFORM payment_db_races.assert_true((SELECT x.payload=y.payload FROM payment_db_races.observations x JOIN payment_db_races.observations y ON y.name=x.name AND y.side='consume_b' WHERE x.name=c.name AND x.side='consume_a'),'same corresponding terminal receipt');
  END IF;
 END LOOP;
END $check$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
