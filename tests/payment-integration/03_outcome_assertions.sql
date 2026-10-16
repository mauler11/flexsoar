-- Read-only integration accounting audit, called after actual finalized-chain
-- verification. This does not manufacture payment evidence or completion markers.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT current_database()='flexsoar_payment_v2_integration_test'
 AND inet_server_addr() IS NOT DISTINCT FROM '127.0.0.1'::inet AS correct_target \gset
\if :correct_target
\else
\quit 3
\endif
SELECT set_config('payment.integration_cases',:'cases',true) IS NOT NULL;
DO $$DECLARE f jsonb;s payment_v2.sales%rowtype;a payment_v2.attempts%rowtype;o public.orders%rowtype;n bigint;BEGIN
 FOR f IN SELECT value FROM jsonb_array_elements(current_setting('payment.integration_cases')::jsonb) LOOP
  SELECT id,state,card_id,chain_acknowledged INTO s.id,s.state,s.card_id,s.chain_acknowledged FROM payment_v2.sales WHERE id=(f->>'saleId')::uuid;
  IF s.state IS DISTINCT FROM f->>'outcome' OR NOT s.chain_acknowledged THEN RAISE EXCEPTION 'unreconciled terminal sale %',f;END IF;
  SELECT count(*) INTO n FROM public.orders WHERE listing_id=(f->>'listingId')::uuid;
  IF n<>1 THEN RAISE EXCEPTION 'expected one corresponding order %',f;END IF;
  SELECT id,payment_v2_attempt_id,gross_cents,fee_cents,net_cents,paid_out,stripe_transfer_id INTO o.id,o.payment_v2_attempt_id,o.gross_cents,o.fee_cents,o.net_cents,o.paid_out,o.stripe_transfer_id FROM public.orders WHERE listing_id=(f->>'listingId')::uuid;
  IF o.gross_cents<>2000 OR o.fee_cents<>100 OR o.net_cents<>1900 OR o.paid_out IS DISTINCT FROM false OR o.stripe_transfer_id IS NOT NULL THEN RAISE EXCEPTION 'MYR snapshot/Stripe contamination %',f;END IF;
  SELECT buyer_id,seller_id,total_units,fee_units,net_units INTO a.buyer_id,a.seller_id,a.total_units,a.fee_units,a.net_units FROM payment_v2.attempts WHERE id=o.payment_v2_attempt_id;
  IF a.total_units<>1000000 OR a.fee_units<>50000 OR a.net_units<>950000 THEN RAISE EXCEPTION 'USDC snapshot mismatch %',f;END IF;
  IF EXISTS(SELECT 1 FROM payment_v2.events e LEFT JOIN payment_v2.consumptions c ON c.event_id=e.id WHERE e.sale_id=s.id AND c.order_id IS DISTINCT FROM o.id)
  OR EXISTS(SELECT 1 FROM payment_v2.events e JOIN payment_v2.usdc_journal j ON j.event_id=e.id WHERE e.sale_id=s.id GROUP BY e.id HAVING sum(j.units)<>0)
  OR (SELECT count(*) FROM payment_v2.events WHERE sale_id=s.id AND kind IN('direct','funded'))<>1
  OR (SELECT count(*) FROM payment_v2.events WHERE sale_id=s.id AND kind IN('released','refunded'))>1 THEN RAISE EXCEPTION 'evidence/accounting consumption mismatch %',f;END IF;
  IF EXISTS(SELECT 1 FROM payment_v2.events e WHERE e.sale_id=s.id AND (SELECT count(j.account) FROM payment_v2.usdc_journal j WHERE j.event_id=e.id)<>CASE e.kind WHEN 'direct' THEN 3 WHEN 'released' THEN 3 ELSE 2 END) THEN RAISE EXCEPTION 'exact journal row count mismatch %',f;END IF;
  IF (SELECT count(*) FROM payment_v2.outbox b JOIN payment_v2.events e ON e.id=b.event_id WHERE e.sale_id=s.id)<>(SELECT count(*)*2 FROM payment_v2.events WHERE sale_id=s.id) THEN RAISE EXCEPTION 'atomic outbox mismatch %',f;END IF;
  IF (SELECT owner_id FROM public.cards WHERE id=s.card_id) IS DISTINCT FROM (CASE s.state WHEN 'refunded' THEN a.seller_id ELSE a.buyer_id END)
  OR NOT payment_v2.owns_claim(s.card_id,CASE s.state WHEN 'refunded' THEN a.seller_id ELSE a.buyer_id END) THEN RAISE EXCEPTION 'ownership cache/ledger mismatch %',f;END IF;
 END LOOP;
END $$;
ROLLBACK;
