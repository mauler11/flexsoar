-- DRAFT / NOT RUN. Fixture commits persist ONLY in the disposable DB.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
CREATE SCHEMA payment_db_test;
CREATE TABLE payment_db_test.races(id integer PRIMARY KEY,f jsonb NOT NULL);
INSERT INTO payment_db_test.races VALUES(0,pg_temp.fixture(0::smallint)),(1,pg_temp.fixture(1::smallint));
COMMIT;
