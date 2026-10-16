-- Isolated codec regressions. No financial fixture rows persist.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
\ir 04_sdk_encoding_vectors.sql
DO $tests$ DECLARE v record;b bytea:=decode('46534f41525632000200','hex');i integer;
BEGIN
 FOR v IN SELECT label,raw,encoded FROM sdk_keys LOOP
  PERFORM pg_temp.assert_true(payment_v2.b58(v.raw)=v.encoded,'SDK encode: '||v.label);
  IF octet_length(v.raw)=32 THEN PERFORM pg_temp.assert_true(payment_v2.unb58(v.encoded)=v.raw,'SDK decode: '||v.label);
  ELSE PERFORM pg_temp.expect_error(format('SELECT payment_v2.unb58(%L)',v.encoded),'KEY_ENCODING');END IF;
 END LOOP;
 FOR v IN SELECT value,expected FROM sdk_integers LOOP
  PERFORM pg_temp.assert_true(payment_v2.le64(v.value)=v.expected,'LE64 SDK: '||v.value);
 END LOOP;
 PERFORM pg_temp.expect_error('SELECT payment_v2.unb58(''0OIl'')','KEY_ENCODING');
 PERFORM pg_temp.expect_error('SELECT payment_v2.unb58(repeat(''1'',31))','KEY_ENCODING');
 PERFORM pg_temp.expect_error('SELECT payment_v2.unb58(repeat(''1'',33))','KEY_LENGTH');
 PERFORM pg_temp.expect_error('SELECT payment_v2.unb58(repeat(''z'',44))','KEY_LENGTH');
 PERFORM pg_temp.expect_error('SELECT payment_v2.le64(18446744073709551616)','INTEGER_RANGE');
 PERFORM pg_temp.expect_error('SELECT payment_v2.le64(-18446744073709551617)','INTEGER_RANGE');
 PERFORM pg_temp.expect_error('SELECT payment_v2.le64(1.5)','INTEGER_RANGE');
 PERFORM pg_temp.assert_true(payment_v2.b58(NULL) IS NULL AND payment_v2.unb58(NULL) IS NULL AND payment_v2.le64(NULL) IS NULL,'strictness');
 FOR i IN 1..19 LOOP b:=b||decode(repeat(lpad(to_hex(i),2,'0'),32),'hex');END LOOP;
 FOR i IN 1..7 LOOP b:=b||payment_v2.le64(i);END LOOP;
 b:=b||payment_v2.le64(-8)||payment_v2.le64(9);
 PERFORM pg_temp.assert_true(b=(SELECT expected FROM sdk_permit),'complete existing Rust/TS independent wire vector');
END $tests$;
ROLLBACK;
\echo 'CODEC_PRIMITIVES_COMPLETE: 10 encode, 7 decode, 10 LE64, 11 rejection/strictness checks, full fixed permit'
