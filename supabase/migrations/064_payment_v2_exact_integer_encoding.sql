-- Forward repair: exact numeric integer quotients only. Never rewrite applied060.
BEGIN;
CREATE TEMP TABLE payment_codec_metadata ON COMMIT DROP AS
 SELECT oid,to_jsonb(p)-'prosrc' AS metadata,prosrc FROM pg_proc p
 WHERE oid IN('payment_v2.b58(bytea)'::regprocedure,'payment_v2.unb58(text)'::regprocedure,'payment_v2.le64(numeric)'::regprocedure);
DO $preflight$ BEGIN
 IF (SELECT count(*) FROM payment_codec_metadata)<>3 THEN RAISE EXCEPTION 'codec prerequisite missing';END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_codec_metadata WHERE prosrc LIKE '%n:=trunc(n/58)%')
 OR NOT EXISTS(SELECT 1 FROM payment_codec_metadata WHERE prosrc LIKE '%n:=trunc(n/256)%')
 OR NOT EXISTS(SELECT 1 FROM payment_codec_metadata WHERE prosrc LIKE '%v:=trunc(v/256)%') THEN
 RAISE EXCEPTION 'unexpected codec implementation: inspect before forward repair';END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION payment_v2.b58(p bytea) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE n numeric:=0;r text:='';i int;z int:=0;a constant text:='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
BEGIN
 FOR i IN 0..octet_length(p)-1 LOOP n:=n*256+get_byte(p,i); END LOOP;
 WHILE z<octet_length(p) AND get_byte(p,z)=0 LOOP z:=z+1; END LOOP;
 WHILE n>0 LOOP r:=substr(a,mod(n,58)::int+1,1)||r;n:=pg_catalog.div(n,58::numeric);END LOOP;
 RETURN repeat('1',z)||r;
END $$;
CREATE OR REPLACE FUNCTION payment_v2.unb58(p text) RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE n numeric:=0;r bytea:=''::bytea;i int;j int;z int:=0;a constant text:='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
BEGIN
 IF p !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' THEN RAISE EXCEPTION 'PAYMENT_V2_KEY_ENCODING'; END IF;
 FOR i IN 1..length(p) LOOP j:=strpos(a,substr(p,i,1))-1; n:=n*58+j;END LOOP;
 WHILE z<length(p) AND substr(p,z+1,1)='1' LOOP z:=z+1;END LOOP;
 WHILE n>0 LOOP r:=set_byte(decode('00','hex'),0,mod(n,256)::int)||r;n:=pg_catalog.div(n,256::numeric);END LOOP;
 r:=decode(repeat('00',z),'hex')||r;
 IF octet_length(r)<>32 THEN RAISE EXCEPTION 'PAYMENT_V2_KEY_LENGTH';END IF; RETURN r;
END $$;
CREATE OR REPLACE FUNCTION payment_v2.le64(p numeric) RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE v numeric:=p;r bytea:=decode(repeat('00',8),'hex');i int;
BEGIN
 IF p<0 THEN v:=p+18446744073709551616;END IF;
 IF v<0 OR v>18446744073709551615 OR trunc(v)<>v THEN RAISE EXCEPTION 'PAYMENT_V2_INTEGER_RANGE';END IF;
 FOR i IN 0..7 LOOP r:=set_byte(r,i,mod(v,256)::int);v:=pg_catalog.div(v,256::numeric);END LOOP;RETURN r;
END $$;
DO $postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM payment_codec_metadata m JOIN pg_proc p ON p.oid=m.oid WHERE m.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc') THEN
 RAISE EXCEPTION 'codec metadata changed: ownership/ACL/signature/attributes must be preserved';END IF;
 IF EXISTS(SELECT 1 FROM payment_codec_metadata m JOIN pg_proc p ON p.oid=m.oid
 WHERE replace(replace(replace(m.prosrc,'trunc(n/58)','pg_catalog.div(n,58::numeric)'),
 'trunc(n/256)','pg_catalog.div(n,256::numeric)'),'trunc(v/256)','pg_catalog.div(v,256::numeric)') IS DISTINCT FROM p.prosrc) THEN
 RAISE EXCEPTION 'codec change exceeds quotient-only scope';END IF;
END $postflight$;
COMMIT;
