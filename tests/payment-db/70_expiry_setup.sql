-- DRAFT / NOT RUN. COMMITS synthetic evidence; human waits >=45 seconds before71.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
CREATE SCHEMA payment_db_expiry_test;
CREATE TABLE payment_db_expiry_test.fixture(f jsonb NOT NULL);
INSERT INTO payment_db_expiry_test.fixture VALUES(pg_temp.fixture(0::smallint,30));
COMMIT;
