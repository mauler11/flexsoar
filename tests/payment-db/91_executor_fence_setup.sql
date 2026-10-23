-- Commits two synthetic open_sale operations for the real-login executor fence test.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
CREATE SCHEMA payment_db_executor_fence;
CREATE TABLE payment_db_executor_fence.cases(name text PRIMARY KEY,f jsonb NOT NULL,lease_id uuid NOT NULL,operation_id uuid NOT NULL);
GRANT USAGE ON SCHEMA payment_db_executor_fence TO payment_db_test_executor,payment_db_test_issuer,payment_v2_executor,payment_v2_issuer;
GRANT SELECT ON payment_db_executor_fence.cases TO payment_db_test_executor,payment_db_test_issuer,payment_v2_executor,payment_v2_issuer;
INSERT INTO payment_db_executor_fence.cases VALUES
 ('claim',pg_temp.fixture(0::smallint,600,false),gen_random_uuid(),gen_random_uuid()),
 ('leased',pg_temp.fixture(0::smallint,600,false),gen_random_uuid(),gen_random_uuid());
UPDATE payment_v2.sales s SET state='opening'
 FROM payment_db_executor_fence.cases c WHERE s.id=(c.f->>'sale')::uuid;
UPDATE payment_v2.operations o SET state='pending',ready=true,lease_id=NULL,leased_by=NULL,worker_id=NULL,lease_until=NULL,available_at=clock_timestamp()-interval '1 minute'
 FROM payment_db_executor_fence.cases c WHERE o.sale_id=(c.f->>'sale')::uuid AND o.action='open_sale';
UPDATE payment_v2.operations o SET lease_id=c.lease_id,leased_by='payment_db_test_executor',worker_id='00000000-0000-0000-0000-000000000991',lease_until=clock_timestamp()+interval '10 minutes',state='leased'
 FROM payment_db_executor_fence.cases c WHERE c.name='leased' AND o.sale_id=(c.f->>'sale')::uuid AND o.action='open_sale';
UPDATE payment_db_executor_fence.cases c SET operation_id=o.id FROM payment_v2.operations o
 WHERE o.sale_id=(c.f->>'sale')::uuid AND o.action='open_sale';
INSERT INTO payment_v2.sale_listings(sale_id,message,signature,signer,binding,min_total_units,expires_at)
 SELECT (c.f->>'sale')::uuid,
   decode('46534f415256322d4c49535400','hex')||sha256(convert_to('w2p1-executor-fence','UTF8'))||decode(repeat('00',16),'hex'),
   decode(repeat('5a',64),'hex'),s.seller_wallet,
   substring(decode('46534f415256322d4c49535400','hex')||sha256(convert_to('w2p1-executor-fence','UTF8'))||decode(repeat('00',16),'hex') FROM 14 FOR 32),4900000,
   extract(epoch FROM clock_timestamp())::bigint+3600
 FROM payment_db_executor_fence.cases c JOIN payment_v2.sales s ON s.id=(c.f->>'sale')::uuid WHERE c.name='claim';
COMMIT;
