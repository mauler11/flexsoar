-- Python arbitrary-precision expected constants; production initiation + copied actual CHECKs.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
CREATE TEMP TABLE fee_vectors(total numeric,fee numeric,net numeric);
INSERT INTO fee_vectors VALUES
(1,0,1),
(19,0,19),
(20,1,19),
(21,1,20),
(39,1,38),
(40,2,38),
(41,2,39),
(5000000,250000,4750000),
(9007199254740991,450359962737049,8556839292003942),
(9007199254740993,450359962737049,8556839292003944),
(18446744073709551614,922337203685477580,17524406870024074034),
(18446744073709551615,922337203685477580,17524406870024074035);
CREATE TEMP TABLE fee_constraint_probe(LIKE payment_v2.attempts INCLUDING CONSTRAINTS);
DO $tests$ DECLARE v record;f jsonb;attempt uuid;cols text;BEGIN
 SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid='payment_v2.attempts'::regclass AND attnum>0 AND NOT attisdropped;
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='payment_v2.attempts'::regclass AND contype='c' EXCEPT SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='pg_temp.fee_constraint_probe'::regclass AND contype='c'),'probe copies actual production CHECKs unchanged');
 FOR v IN SELECT total,fee,net FROM fee_vectors LOOP
  f:=pg_temp.fixture(0::smallint,600,false,v.total);attempt:=(f->>'attempt')::uuid;
  PERFORM pg_temp.assert_true((SELECT total_units=v.total AND fee_units=v.fee AND net_units=v.net AND total_units=fee_units+net_units AND gross_cents=2000 AND fee_cents=100 AND net_cents=1900 FROM payment_v2.attempts WHERE id=attempt),'actual initiation exact split: '||v.total);
  EXECUTE format('INSERT INTO fee_constraint_probe(%s) SELECT %s FROM payment_v2.attempts WHERE id=%L',cols,cols,attempt);
  PERFORM pg_temp.expect_error(format('UPDATE fee_constraint_probe SET fee_units=%s,net_units=%s WHERE id=%L',v.fee+1,v.net-1,attempt),'check constraint');
  PERFORM pg_temp.expect_error(format('UPDATE fee_constraint_probe SET total_units=0,fee_units=0,net_units=0 WHERE id=%L',attempt),'check constraint');
  PERFORM pg_temp.expect_error(format('UPDATE fee_constraint_probe SET total_units=-1 WHERE id=%L',attempt),'check constraint');
  PERFORM pg_temp.expect_error(format('UPDATE fee_constraint_probe SET total_units=18446744073709551616 WHERE id=%L',attempt),'check constraint');
  PERFORM pg_temp.expect_error(format('UPDATE fee_constraint_probe SET total_units=1.5 WHERE id=%L',attempt),'check constraint');
 END LOOP;
 PERFORM pg_temp.expect_error('SELECT pg_temp.fixture(0::smallint,600,false,0)','check constraint');
 PERFORM pg_temp.expect_error('SELECT pg_temp.fixture(0::smallint,600,false,-1)','check constraint');
 PERFORM pg_temp.expect_error('SELECT pg_temp.fixture(0::smallint,600,false,18446744073709551616)','check constraint');
 PERFORM pg_temp.expect_error('SELECT pg_temp.fixture(0::smallint,600,false,1.5)','check constraint');
END $tests$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
-- Explicit success only after all assertions and intentional fixture rollback.
INSERT INTO payment_db_repairs.completions(scenario) VALUES('exact_fee');
\echo 'EXACT_FEE_REGRESSION_COMPLETE: 12 allocation vectors and constraint/invalid-total rejections'
