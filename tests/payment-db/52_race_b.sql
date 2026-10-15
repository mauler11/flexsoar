-- DRAFT / NOT RUN. Supply race_case and (for worker login) worker_role. No sleeps or hidden commit.
\ir 00_target_guard.sql
BEGIN;
\if :{?worker_role}
SET LOCAL ROLE :"worker_role";
\endif
SET LOCAL statement_timeout='120s';
INSERT INTO payment_db_races.observations(name,side,payload) VALUES(:'race_case','b',payment_db_races.run_b(:'race_case')) RETURNING name,side,payload,login;
SET CONSTRAINTS ALL IMMEDIATE;
-- HUMAN barrier: leave open. A COMMIT (or ROLLBACK for rollback case), then B COMMIT.
