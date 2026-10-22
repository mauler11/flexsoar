# Payment-v2 database suite: ISOLATED ACCEPTANCE PASSED (2026-10-16)

The preserved isolated database passed all37 required checkpoints and committed90's
explicit final record at2026-10-16T07:34:00.635339+00:00,backend2138,version3.
All79 explicit migration files committed, including065/066 and mechanical alias067.
Actual SQL-authorized690-byte permit matched production TypeScript encoding; primitive
vectors, five dedicated worker logins, signed storage, real concurrent sessions,
terminal consumption, rollback, queue/stale leases and expiry/relink all passed.
16 actual blocking-evidence records retained. No success markers manually inserted.
This is database-suite acceptance, NOT full Solana-to-database integration or production
readiness. Funding remains disabled. Existing environment/logs preserved; no reset.
Earlier sections are chronological history and do not supersede this result.

## Current stop: payment060 parser error after approved listing repair

Same preserved container, no reset. Exact container ID/network/ports/mounts and internal
loopback were reverified. Before the listing repair, both definitions/owners/ACLs were
captured, original hashes matched the reported014/019c bodies, zero4-arg dependents and
022b rollback state were asserted. DROP FUNCTION used ONLY the approved obsolete4-arg
signature with RESTRICT. Canonical3-arg full definition/owner/ACL remained unchanged
within the successful repair transaction. Later031/032 legitimately superseded that
signature as part of the separately authorized unchanged historical sequence.

The first repair attempt rolled back on a verification-query defect: pg_get_functiondef
in a pg_proc join evaluated an aggregate and raised `"array_agg" is an aggregate function`.
It did not commit a drop. The failure is retained. The second attempt kept the identical
approved DROP/guards but used a direct canonical regprocedure lookup for verification;
it committed successfully. No other repair scope was added.

Resumption started ONLY at unchanged022b: it passed, as did022c through058 and059.
060_payment_v2_contracts.sql then failed at line124 with `syntax error at end of input`,
pointing to fn_payment_v2_prepare_sale's unparenthesized `v.mode<>CASE ... END` at line111.
The entire060 transaction rolled back; payment_v2.require_role(name) and prepare_sale
are absent.059 records remain, with zero networks and zero attempts. No061–063, fixtures,
worker connections, races, signed storage or90 execution; no manual completion markers.

NEW REVIEW ITEM: only failed/unapplied draft060 was edited to wrap that CASE expression
in parentheses inside the PL/pgSQL IF condition. This is a parser-boundary correction,
not a custody/permission change. It has NOT been applied or compilation-tested. The
original failed input, hashes/log and catalog evidence remain in the run directory.
After review/authorization, retry060 (NOT059), then continue061–063 only on success.
Do not alter applied059 or historical files, skip the failure or weaken any predicate.

Evidence includes listing-repair-*/ (both attempts, SQL/hash/results/isolations) and
migrations-resume-*/ (resume manifest, hashes, exits/logs,060 failed input and rollback
catalog). Prior run/repair/failure evidence remains. This synthetic compatibility fix
is NOT a production recommendation: production's actual catalog requires independent
review. Funding remains disabled and34-checkpoint acceptance has NOT run.

## Earlier stop: historical022b — resolved by explicitly approved isolated repair

Same preserved container/ID/digest below, no recreation/reset. The two authorized official
Auth files at commit4eee58f296d9698a1c2c0ae14d7a0b379c7622d3 were fetched with their
original source/hashes retained, rendered ONLY Namespace→auth, and executed in order
as actual connection identity supabase_auth_admin in one transaction. COMMIT succeeded.
Existing uid/role/email owners and ACLs were compared and unchanged; new jwt is owned
by supabase_auth_admin and is NOT SECURITY DEFINER. No explicit grants were added;
its effective ACL follows the existing upstream defaults. Tests verified individual
claims, JSON fallback, singular/plural jwt, missing/empty settings, API schema/execution
rights and actual calls under anon/authenticated/service_role, zero app/Auth data and
unchanged auth.schema_migrations. Full bootstrap preflight then passed.

The fixed75-file manifest stopped at file25,022b_permissions_lockdown.sql, psql exit3:
`022b: 1 function(s) now have multiple arities` (line233). Exactly24 preceding files
committed (001 through022, including019a/b/c);022b's complete transaction rolled back.
Catalog diagnosis found:
- fn_list_card(uuid,uuid,integer): canonical geography-derived body from019c.
- fn_list_card(uuid,uuid,integer,payout_method): obsolete default-cash body from014.
014 drops the original3-arg and creates4-arg.019c recreates3-arg without dropping4-arg.
022 removes purchase overloads only;022b correctly refuses the remaining listing pair.
031 would later drop both, but executing it out of order is NOT a repair for this stop.
No later file was attempted or marked successful. Catalog confirms022b's guard creation
and dead purchase-function drop rolled back; payment_v2 schema does not exist.

NEXT REPAIR PROPOSAL ONLY: after review/authorization, retire EXACTLY the obsolete
public.fn_list_card(uuid,uuid,integer,public.payout_method), using RESTRICT, as a separate
forward compatibility step in THIS DB's current post022 state. Verify exact identities/
owners/bodies/dependencies first, keep the canonical3-arg geography body and its rights,
then rerun unchanged022b and continue only on success. No historical edits, assertion
exception, CASCADE, blanket overload drop, data cleanup or success-marker insertion.
Actual catalog reports zero dependent objects for the obsolete4-arg function. Body
SHA256s for review:3-arg e3d880decc1b277f84bac789ff28a00d8158852271a765c0ad221cc83ec0e7d0;
4-arg111d3b253c4b4f3c70cb3a372d773314ceab21627216ae6473bfc0e058341095.
No such repair has executed.34-checkpoint acceptance and full recovery remain unverified.

Run evidence now also contains auth-repair-*/ (source/rendered files, hashes, transaction,
before/after/claim verification and exit codes) and migrations-*/ (explicit manifest,
per-file source hashes/logs, results.tsv, first-failure.txt, catalog/dependency diagnosis
and preserved runtime inspection). Keep earlier failure evidence. Do not replay001.

## Earlier bootstrap blocker after69c6161 — now resolved by authorized repair

Container `flexsoar-payment-db-69c6161-20261016T022841Z` is preserved, not reset.
ID:71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92.
Official supabase/postgres:17.11.0.004 digest:
sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc.
Actual image entrypoint/init scripts were copied and reviewed before first startup.
Runtime inspection confirms network none, no published ports, privileged=false and
only the three exact read-only /audit mounts. TCP catalog checks INSIDE this container
confirm flexsoar_payment_v2_test,127.0.0.1:5432,session_user=supabase_admin, PostgreSQL17.11,
the real API roles/publication, pgcrypto installed and citext available. There are zero
public application tables and zero auth.users rows. The bootstrap's auth.uid/role/email
exist and are owned by supabase_auth_admin; auth.jwt() does NOT exist.

The explicit read-only prerequisite assertion failed with psql exit3:
BOOTSTRAP_PREREQUISITE_MISSING: auth.jwt(). No historical or payment migration was
attempted. Historical036 and053 require this helper. The DB-only image is therefore
NOT by itself a complete modern Auth bootstrap for this suite. Do not insert a shim,
skip those policies, weaken guards or recreate this environment to conceal the failure.

Original repair proposal, subsequently authorized and executed as recorded above:
the exact official Supabase Auth function-only
migrations at commit4eee58f296d9698a1c2c0ae14d7a0b379c7622d3 (tagv2.197.0):
- migrations/20220224000811_update_auth_functions.up.sql
- migrations/20220531120530_add_auth_jwt_function.up.sql
Source: https://github.com/supabase/auth/tree/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3/migrations
Render ONLY the upstream Namespace template as auth, apply forward to this isolated
target under the real supabase_auth_admin owner after review/authorization, preserve
existing helper ownership/ACLs, and verify exact definitions, API execution rights,
legacy individual-claim and JSON-claims behavior. Do not mark the entire GoTrue history
applied or modify historical FlexSoar files. This is partial function bootstrap for
database tests, not verified full GoTrue/HTTP integration. Re-run the full prerequisite
check before001. No payment migration needs a forward repair yet: none was applied.

Evidence directory (Ubuntu):
/home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
It retains image metadata/digest, actual entrypoint/init sources, isolation inspection,
bootstrap logs, bootstrap catalog/ownership, preflight result and exit code, and an
explicit migration-sequence NOT STARTED record. A preliminary connection-refused probe
before readiness is separately retained. The container/data remain available for review.

## Human preparation, after review

1. Provision a **new disposable, loopback-only PostgreSQL15+ database named `flexsoar_payment_v2_test`**, with the Supabase auth schema/functions, anon/authenticated/service_role/authenticator roles and required extensions. Use no production snapshot, customers, credentials, wallets or real Panda rows. Independently verify the process, port, database and synthetic provenance. Do not use tunnels, linked projects or a shared instance. A localhost URL alone does not establish isolation.
2. Review/apply the complete checked-in historical schema through058 to that target. Historical files include manual-era migration conventions; do not assume `supabase db reset` will reproduce the deployed schema. Compare required catalog evidence listed in the handoff. Do not edit history to make a test pass.
3. Review059..063 as a **single coordinated cutover**. Use a migration administrator capable of creating NOLOGIN roles, assigning object ownership, replacing legacy function bodies, revoking grants and creating RLS policies. No worker may inherit `payment_v2_owner`. No production credentials are created by the drafts. Leave real network rows absent/funding disabled.
4. Only after explicit review, a HUMAN may apply each named new file in order. Example commands below are instructions, not evidence they ran. Set `PGPORT` to the independently verified isolated port and `PGUSER` to its migration administrator; use the local instance's own credential handling. Do not supply shared Supabase environment files.

```powershell
$env:PGHOST = '127.0.0.1'
$env:PGDATABASE = 'flexsoar_payment_v2_test'
# Set PGPORT and PGUSER for the independently verified disposable instance.
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/059_payment_v2_records.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/060_payment_v2_contracts.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/061_payment_v2_settlement.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/062_payment_v2_recovery.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/063_payment_v2_permissions_fences.sql
```

5. For this disposable test connection only, set `PGOPTIONS` to `-c payment_v2.test_identity=synthetic-payment-v2-only`. This marker is an acknowledgement, not a security boundary or proof of isolation. The guard also checks server-side loopback address, exact database name and explicit psql acknowledgement. No automatic target selection exists.
6. A HUMAN must first run03_completion_setup.sql ONCE on the fresh disposable target, before any tests below. It creates private test-only completion records, not application objects. Then invoke the tests separately.10/20/30/71 roll back their synthetic fixtures and only afterward commit an explicit successful checkpoint;35/50 and worker/race scripts deliberately retain their synthetic evidence. `01_fixtures.sql` is an include, never an independently runnable test. The fixtures synthesize key-shaped bytes, not secret signing keys and not purported chain evidence. Positive calls impersonate a trusted verifier for database contract testing; independent program/verifier tests establish actual chain verification.

```powershell
psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/03_completion_setup.sql
psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/10_contracts.sql
psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/20_outcomes_recovery.sql
psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/30_permissions.sql
```

Use a disposable administrator connection for these scripts. `30_permissions.sql` changes **session authorization**, not only current role, to exercise negative connection identity checks. It requires sufficient test-only administrator rights. Positive non-superuser issuer/verifier/settler/executor/notifier connection tests are now authored in35..40 and46 below, but remain NOT RUN. Never make authenticator or service_role members to get tests working.

## Coverage authored, execution pending

-10: actual canonical permit RPC header/mode/amount offsets, both purchase modes, correspondence conflicts, duplicate settlement, append-only terms, old direct references preserved, conditional claim, receipt versus authentication, failed-auth lock, listing/redemption refusal, every enumerated historical settlement overload's retired body.
-20: actual release/refund approval and reconciliation, independent rejected-authentication review and governance resolution, release/refund exclusion, full principal refund, idempotency, pending chain acknowledgement, outbox retry/CAS, operation signed-identity retention, scan leases, transaction rollback. It does not send any operation.
-30: actual anonymous/authenticated grants, direct-table denial, JWT-role spoofing denial, own-attempt access and another user's candidate rejection; actual overload catalog permission checks.

## Two-session procedure: NOT RUN, not proven by single-session tests

`40_concurrency_setup.sql` deliberately COMMITS only synthetic fixtures to this disposable DB; review it independently. It creates one unfunded-to-DB but verifier-observed event per mode. Do not use on any environment retaining financial history.

1. Human runs40 once. Start two psql terminals connected explicitly to the same isolated test target with the guard marker/acknowledgement. Set `race_mode` to0 (escrow).
2. SessionA includes41 and leaves its transaction open. Copy its returned order/event/attempt IDs.
3. SessionB includes42 whileA holds locks. VerifyB blocks on the same Item/Card/Sale lock; inspect `pg_stat_activity`/`pg_locks` from a third isolated administrator terminal if needed.
4. Human commitsA beforeB's60-second timeout. B must return the identical order and both count queries must return true. Repeat for mode1 (vaulted direct).
5. Repeat with A rolling back instead: B must create exactly one order; no partial ledger/outbox rows fromA. This needs a fresh disposable fixture run.
6. Additional multi-session acceptance still required: verifier insertion of conflicting signatures/attempts for the same sale; terminal release versus refund consumption; cancel/revoke versus funding; two operation/outbox workers using SKIP LOCKED; expired lease takeover and stale-worker completion. Use independently created fixture sales/events and compare identical immutable context. Never change a finalized event to make both outcomes valid. The program rejects two terminal outcomes; database uniqueness must reject conflicting verifier submissions even when concurrent.

These procedures test Postgres locking only after execution. They do not prove chain/Postgres atomicity or two buyers funding safety; one on-chain Sale consumption provides that protection. Keep funding disabled until the actual full loopback program-observer-database reconciliation acceptance tests also pass.

## Forward repair

Preserve migration results, errors, test logs, catalog/ACL snapshots and synthetic operation/evidence IDs. A failed stage should remain unavailable; finish a reviewed forward repair. Never erase journal/history/evidence or recreate a consumed sale as rollback. No destructive rollback script is supplied.

## Expiry/relink/lost-response case (NOT RUN)

A HUMAN may run70 once in a fresh fixture target, wait at least45 seconds, then71.
70 commits a synthetic, originally authorized payment observation with a30-second
quote;71 refuses to proceed before expiry, relinks only the synthetic user, recovers
the original permit and consumes/retries the original payment. It never rewrites
immutable timestamps, requests a new payment or signs anything. It rolls back its
reconciliation and relink changes. Current SQL grants/locks still require execution.


## Review fixes after bb3943e: revised UNAPPLIED drafts only

This continuation revised059..063 on the founder's explicit representation that they
are new/unapplied drafts. No database/catalog connection was made to confirm that.
BEFORE application, the human must confirm none was applied anywhere intended for
reuse. If any was applied, preserve its version/checksum and request a reviewed
forward migration; do not rerun/overwrite it. A fresh disposable target is preferred.
SQL syntax, ownership/grants, dedicated principals and every scenario below: NOT RUN.

The unused public.users FOR UPDATE locks were removed. Settlement never changes a
user balance or relies on current wallet links. Item/Card/Sale/Listing/Attempt/Escrow
locks plus immutable wallet/account snapshots and FK enforcement cover its changes.
063 now grants the owner SELECT-only RLS access to users and fails on unexpected
inherited table/column UPDATE privileges; no user UPDATE privilege was added.

## Real dedicated connections:35..40,45..47

Run35_workers_setup.sql as the isolated migration administrator after the reviewed
schema. It commits SYNTHETIC fixtures and creates five explicitly named test LOGIN
roles, each NOINHERIT/NOSUPERUSER/NOBYPASSRLS with only its corresponding worker role.
It creates no passwords and changes no authentication configuration. Human must
arrange authentication ONLY for this disposable loopback instance (its own test
credential handling); never supply production passwords or grant service_role/
authenticator/owner membership. Tests refuse pre-existing test principals rather
than overwrite them. Do not execute every directory file by wildcard.

Use the same verified PGHOST=127.0.0.1, PGPORT, PGDATABASE and PGOPTIONS marker above.
Run these with genuinely separate login connections, in this order, within the
synthetic one-hour authorization interval:

```powershell
psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/35_workers_setup.sql
psql -X -U payment_db_test_issuer -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/36_worker_issuer.sql
psql -X -U payment_db_test_verifier -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/37_worker_verifier.sql
psql -X -U payment_db_test_settler -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/38_worker_settler.sql
psql -X -U payment_db_test_executor -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/39_worker_executor.sql
psql -X -U payment_db_test_notifier -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/40_worker_notifier.sql
psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/46_worker_results.sql
```

Each connection sets LOCAL ROLE to its single permission group; **session_user must
remain the specified LOGIN**. Tests reject superuser/admin substitution, count worker
memberships, assert no owner/service_role/authenticator membership, call the actual
identity RPC, exercise successful authorized operations and deny cross-role/table DML.
38 reaches full escrow/direct settlement using the finalized SECURITY DEFINER owner
permissions;46 checks original receipt, Card status/ledger-related counts and actual
issuer/verifier/settler audit login names.30 additionally tests JWT role spoofing.
SET ROLE under an administrator is NOT equivalent to these real connections.

To test durable bytes (47), first39 must hold an active execute_outcome lease:

1. Export45 using that real executor connection and `psql -X -q -At`. Save its single
JSON output to a NEW OS TEMP file named `flexsoar-payment-synthetic-plan-<unique>.json`.
Use Out-File -Encoding utf8 -NoClobber; the offline helper accepts the PS5 UTF8 BOM.
2. Run `node tests/payment-db/make-signed-fixture.mjs ISOLATED_SYNTHETIC_ONLY <planPath> <newEnvelopePath>`.
Both paths must be named synthetic JSON inside OS TEMP. The helper uses the installed
SDK and a new valueless fee signer, saves NO private key and writes with exclusive
creation. Its synthetic blockhash/height are intentionally not network validity data.
NEVER broadcast this fixture. Production offline inspector is exercised against this
actual helper's output by payment-signed-operation.test.ts.
3. Open psql as payment_db_test_executor with the target acknowledgement. Set variables
operation_id from plan.operationId, lease_id from exported leaseId and signed_envelope_json
to the generated SINGLE-LINE JSON. For interactive psql, use `\set signed_envelope_json '<generated JSON line>'`;
JSON quoting must be preserved. Then `\i tests/payment-db/47_signed_storage_contract.sql`.
This is HUMAN SQL execution only after separate authorization, not an agent command.
4.47 stages exactly once, retries exact bytes (lost ACK), reads them back, rejects changed
validity/context and marks a synthetic unknown send outcome WITHOUT sending anything.
If the lease expired, claim a fresh lease first; if already staged, retrieve the old
envelope instead of creating another signature. No automatic replacement exists.

SQL does NOT verify Ed25519 or decode Solana messages. It validates row/context/byte
hashes, first signature identity and immutable storage. Every production stage/recovery
uses inspectSignedOperation with the separately fetched DB plan. Financial verification
and receipt consumption remain separate roles; staging does not prove payment.

## Deterministic separate-session arbitration:50..57

Run50_races_setup.sql once as administrator on a fresh synthetic target (after schema;
35 supplies the standard issuer/verifier/settler LOGINs if used).50 also creates distinct
executor_a/b and notifier_a/b LOGINs, each with ONLY its own worker membership. These
are test identities with no passwords/production secrets. The fixtures have a one-hour
authorization interval. No psql script auto-signs, sends or invents a second valid chain
result. Deliberately conflicting proof JSON is a buggy-verifier/adversarial database
input, NOT a claim that two Solana outcomes were valid. Only ONE canonical terminal
observation is admissible for each sale. Database code trusts the dedicated verifier;
these tests cannot prove the verifier's cryptographic correctness.

For each case, open independent terminals A/B and run51_race_a.sql /52_race_b.sql with
`-v race_case=<case>`. Worker logins also supply `-v worker_role=payment_v2_<role>`;
use the exact credentials below. Scripts leave transactions OPEN, force deferred
constraints before returning, and print the result. For lock races, verify B blocks
while A holds Item/Card/Sale locks; a third isolated administrator may inspect
pg_stat_activity/pg_locks. Commit A, then commit B. Never use sleeps as synchronization.
For rollback, explicitly ROLLBACK A, then let B finish and COMMIT. A's returned order
was provisional; clients may expose a durable receipt only after COMMIT succeeds.
In the SAME original A backend, after ROLLBACK, include60_rollback_ack.sql. This
explicitly records the human-observed rollback and its backend identity; it does not
recreate A's rolled-back financial writes. Final acceptance requires this checkpoint.

Use **interactive psql**, not `psql -f` for51/52: exiting the connection rolls back
the open transaction. For example, launch A with
`psql -X -U payment_db_test_settler -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -v race_case=conflicting_signature -v worker_role=payment_v2_settler`,
then enter `\i tests/payment-db/51_race_a.sql` and leave that connection open.
Launch B independently with its verifier login/role and the same case, enter
`\i tests/payment-db/52_race_b.sql`. After observing B waiting, enter `COMMIT;`
in A, wait for B's result, then `COMMIT;` in B. For rollback use `ROLLBACK;` in A.
The scripts themselves never complete the barrier transaction for you.

| race_case | A login/role | B login/role | Expected result |
|---|---|---|---|
| conflicting_signature | payment_db_test_settler/settler | payment_db_test_verifier/verifier | Different signature for same sale rejected; one original order |
| conflicting_attempt | settler | verifier | Separately initiated/authorized second buyer cannot consume the winning sale |
| release_refund | verifier | verifier | Canonical release event holds locks; opposite fabricated refund rejected |
| refund_release | verifier | verifier | Canonical refund event holds locks; opposite fabricated release rejected |
| funding_cancel | isolated administrator simulating seller auth.uid only | settler | Cancel remains intent; canonical funded payment wins and listing sells |
| funding_revoke | settler | verifier | Finalized funded evidence prevents contradictory revocation |
| revoked_funding | verifier | verifier | Canonical revoke wins; contradictory new funding evidence rejected |
| rollback | settler, ROLLBACK A | settler | B alone commits exact claim/order/journal/outbox |

For terminal cases, B ONLY arbitrates/imports observations. After both commit, run
56_consume_canonical_terminal.sql with the SAME race_case in an ACTUAL settler login
connection, twice-idempotent consume included. No verifier connection is allowed to
settle. Then run53_race_assert.sql as administrator: exact one order, beneficiary/cache,
Card legs/provenance, USDC legs/per-event balance, evidence/consumption and notification
counts. No opposite terminal row may appear. Run53 after EACH completed case; it only
asserts cases with a committed B observation. A missing B means a case was not tested.
Record case names, both backend PIDs/logins, blocked lock evidence and all results.

For deterministic **terminal consumption concurrency**, use58/59 INSTEAD OF56 on a
fresh terminal case. Open two separate real settler connections with race_case and
target acknowledgement. Interactive A includes58_terminal_consume_a.sql, leaving
the transaction open. B includes59_terminal_consume_b.sql and must wait. COMMIT A,
then COMMIT B and run53: both consume observations must contain the identical receipt,
with exactly the same financial counts above. Record distinct backend PIDs; these
connections may share the dedicated settler LOGIN because both perform ONLY settlement.
The canonical event is shared: never invent two valid opposite terminal outcomes.

For queues, run57_prepare_queue_case.sql as administrator BEFORE EACH named queue
case. It isolates eligibility to the exact synthetic fixture IDs and expires only
their test leases; no production path can do this. Use the role/login pairs:

- operations: A payment_db_race_executor_a, B payment_db_race_executor_b; each SET ROLE
payment_v2_executor. A claims one row and holds its lock; B SKIP LOCKED claims the other.
- outbox: A payment_db_race_notifier_a, B payment_db_race_notifier_b; role payment_v2_notifier.
- operation_takeover / outbox_takeover: after57, A claims and COMMITS. Administrator runs54
(expire only the exact committed synthetic A lease), then B claims and COMMITS.53 must
show SAME work ID but different lease IDs and login identities. Use A's original login
to run55_stale_worker.sql with worker_role: completion with the original lease must fail.

For queue competition run51/52 as above and COMMIT both;53 requires disjoint IDs. For
all takeover cases, no external execution/delivery occurs. These prove CAS/SKIP LOCKED
only if run. Single-session fixtures/unit mocks do not establish concurrency safety.
On-chain shared Sale consumption, not a database reservation or lease, prevents two
buyers funding the same sale. A stale worker can still hold previously signed bytes;
only the program's terminal/revision fencing prevents a second financial outcome.

## Mandatory final completeness gate — NOT RUN

Incremental46/53 remain useful while executing the suite, but ARE NOT final acceptance.
03's private completion table records explicit success only after assertions have been
reached; role-specific checkpoints use actual session_user checks. Workers cannot
directly write the table, claim another role's checkpoint, or record administrator
checks. This is trusted disposable-test instrumentation, not financial authorization
or protection against a malicious migration administrator.

Required order on ONE fresh target:

1. Apply reviewed schema059–063 after baseline, then03 once; run10/20/30.
2.35,36–40 with five real worker connections,46;45/offline fixture/47 (signed storage).
3.40_concurrency_setup, then interactive41/42 for BOTH race_mode=0 and1, committing
both A and B. Use separate backends and retain blocking/receipt evidence. The older
optional rollback variant does not replace the required dedicated rollback case below.
4.50 once, then ALL twelve named cases in its README matrix/queue list. Use57 before
each queue case. For terminal cases58/59 are REQUIRED; sequential56 alone does not
satisfy final acceptance. For rollback use60 after A rolls back; for each takeover run
54 and B, then55 under the correct original A worker login. Run53 incrementally.
5.70 once, wait for its synthetic authorization expiry as instructed, then71.
6. Run the following exact final acceptance command AS THE SAME isolated setup
administrator that owns03, with the previously verified PGHOST/PGPORT/PGDATABASE/
PGOPTIONS. This command is HUMAN-ONLY and has NOT been executed by the agent:

```powershell
psql -X -v ON_ERROR_STOP=1 -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/90_final_acceptance.sql
if ($LASTEXITCODE -ne 0) { throw 'Payment database final acceptance FAILED or incomplete' }
```

90 reruns46/53's financial assertions and requires **34 explicit successful checkpoints**.
It rejects any missing worker, core, signed-storage, mode-specific duplicate, named
race, terminal-consumer, expiry, rollback acknowledgement or stale-worker completion.
It also checks the actual five worker login names and distinct backend PIDs for race,
duplicate and terminal-consumption sessions. A fixture row, an absent error, or53
skipping an unfinished case cannot satisfy a missing checkpoint. Only after all checks
and COMMIT does90 print the durable `final` record and
`PAYMENT_DB_FINAL_ACCEPTANCE_COMPLETE`. Preserve that row/output plus session transcripts
and observed lock waits. PID separation does not itself prove temporal overlap; the
human must execute the documented barriers and retain pg_locks/pg_stat_activity evidence.
Do not manually insert markers or reuse old test schemas. Fresh-target schemas refuse
existing objects; rerun failed setup on a NEW disposable target, preserving failed-run
evidence. The final marker is scoped to this one synthetic database run, not production
certification or proof of on-chain exclusivity. SQL compilation/execution remains pending.

## Tool inventory and smallest isolated setup step (read-only inspection)

Windows: wsl.exe exists; psql/postgres/initdb/pg_ctl/Supabase CLI/Docker were not on
PATH. Standard Program Files PostgreSQL/Docker and WinGet Supabase link locations were
absent. Ubuntu was reached explicitly with `wsl.exe -d Ubuntu -- bash -lc ...`, as
family, x86_64, about950GiB free. No corresponding Ubuntu executables were found on
PATH, in /usr/lib/postgresql, /usr/local/bin or family/.local/bin; dpkg inventory
found no installed postgresql/docker/podman packages. These are bounded discovery
results, not a claim to have searched every disk. No database connection/service
probe, container start, package installation or schema command was performed.

The immediate human preparation step is to install a Docker-compatible local runtime
(for example Docker Desktop with Ubuntu WSL integration), a reviewed standalone
Supabase CLI, and a Windows psql client on PATH for the exact PowerShell commands
above. No package.json/lockfile changes are needed. Official
local-stack prerequisites: https://supabase.com/docs/guides/local-development/cli-workflows
and https://supabase.com/docs/guides/local-development/cli/getting-started . Pin and
record the selected CLI/image versions before use; no version was downloaded here.

After separate authorization, bootstrap the official local Supabase stack in a NEW
directory OUTSIDE every FlexSoar worktree, with empty application migrations, no seed,
no linked project, distinct project ID, loopback-only published ports and synthetic
local credentials. Review generated configuration BEFORE starting: start/bootstrap
executes internal SQL and is NOT authorized in this task. A bare PostgreSQL install
alone does not provide the required real Supabase auth functions/roles.

Prepare flexsoar_payment_v2_test within that isolated environment with actual local
Supabase auth schema/functions and required cluster roles/extensions. If the stack's
bootstrap database is named postgres, the named target must receive a reviewed
schema-only bootstrap from that FRESH LOCAL empty stack, never a shared/production
dump or data snapshot. No auth stub should stand in for real grants/functions. Have
the human review catalog compatibility and historical001–058 application order before
applying anything; this setup is not yet implemented or tested. Then apply059–063
and03 explicitly as above. Do not run the repository's migration directory via an
automatic reset, wildcard runner or default seeds. No database currently exists that
this session has established as ready, and no single install command alone can prove
the required isolated schema identity.
## Latest execution checkpoint (2026-10-16; supersedes earlier stop notes)

Corrected 060, unchanged 061 and 062 committed successfully in the preserved isolated
container. 059 and historical files were not rerun. 74/75 manifest files completed.
063 rolled back on line 130: unassigned record t, caused by collision between its
DO $triggers$ record variable and pg_trigger query alias. No tests were executed.
The 34-checkpoint gate remains NOT RUN. Do not start tests with 063 unapplied.
Next approval needed: rename only that query alias to tr, preserving the selected
triggers and loop/DROP behavior; then retry 063 only. This name-resolution repair
was not treated as authorized by the SQL syntax-only exception. See latest handoff
for full failure, rollback evidence and proposed correction. Successful 059�062
must not be edited/reapplied. Existing final acceptance command remains unchanged.

## Latest actual execution: 063 committed, fixture length blocker

All75 manifest files have committed, including the approved alias-only063 correction.
03_completion_setup committed.10_contracts failed at fixture creation: seller/buyer/
staff handles exceed historical users_handle_format's24-character limit. Its complete
transaction rolled back (zero users/orders/attempts), and acceptance has ZERO markers.
No remaining tests, dedicated logins, concurrency scenarios or34-checkpoint gate ran.
Migration completion is NOT database acceptance. Earlier NOT RUN notes above describe
prior checkpoints, not the current03/10 execution.

Proposed next approval: shorten ONLY synthetic handle construction in01_fixtures and
50_races_setup (also has race- plus full UUID), retaining UUID identities, constraints
and expectations. Then retry10 ONLY and continue20 onward. Do not rerun committed03,
059�063 or historical migrations. This fixture-data repair was NOT made/executed under
the syntax/alias-only exception. Full evidence and precise paths are in latest handoff.

## Latest retry: handle fix applied; codec repair requires review

01_fixtures and50_races_setup now construct valid24-character synthetic handles with
short role prefixes and21/22 UUID hex characters. Full UUID identities and uniqueness
constraints remain unchanged; collision fails loudly. No other fixture terms changed.
03 and all migrations were NOT rerun.10 retry failed at lifecycle context; complete
rollback verified.50 was not executed. Completion count remains0; gate NOT RUN.

Applied060 b58/unb58 fail all10 tested32-byte round trips. trunc(n/divisor) is not
exact integer division at these sizes. le64(max_u64) and le64(-1) also return incorrect
bytes. Proposed next approved work: a reviewed NEW064 forward repair using exact div
quotients, preserving ownership/grants/guards, with independent cross-language vectors.
Do not alter applied060, weaken lifecycle matching, choose accommodating fixture keys,
or skip10. After separately approved isolated repair, retry10 only, then20 onward.
Full evidence: fixture-retry-20261016T042158Z/ in the preserved run directory.

## Encoding regression additions and exact resume procedure

064 is applied in this preserved test instance: NEVER reapply it or edit it. It changes
only3 integer quotient operations and asserts pg_proc attributes/ACL/owner unchanged.
05 passed:10 Base58 encode/7 decode/10 LE64 expected-value vectors,11 rejection/
strictness assertion groups, complete fixed690-byte existing Rust/TS wire vector.
Expected values are from installed bs584.0.1/Solana SDK/Node Buffer + production
protocol-v2.ts, never SQL roundtrips. All-zero/FF/leading zeros and64-byte encodings
are included; decoder still rejects non32-byte output. Reproduce offline constants:

```powershell
node tests/payment-db/make-encoding-vectors.mjs vectors "$env:TEMP\flexsoar-sdk-vectors.sql"
# Compare to checked-in04_sdk_encoding_vectors.sql, normalizing CRLF only.
```

06 failed on production trigger control flow, as did retry10. Do not rerun03 or
any migration. A separately reviewed forward trigger repair is needed before resume.
After that repair is explicitly approved/applied, run these exact isolated commands
from this worktree; the function selects ONLY internal loopback in the named container:

```powershell
$container = 'flexsoar-payment-db-69c6161-20261016T022841Z'
# First reverify exact ID, network none, no ports, three read-only mounts as before.
function Invoke-PaymentDb {
    & docker exec -i -e PGHOST=127.0.0.1 -e PGPORT=5432 `
        -e PGDATABASE=flexsoar_payment_v2_test -e PGUSER=supabase_admin `
        -e PGOPTIONS='-c payment_v2.test_identity=synthetic-payment-v2-only' `
        $container psql -X -v ON_ERROR_STOP=1 `
        -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY @args
    if ($LASTEXITCODE -ne 0) { throw 'Isolated SQL stage failed; preserve output and STOP' }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$export = Join-Path $env:TEMP "flexsoar-codec-export-$stamp.json"
$comparison = Join-Path $env:TEMP "flexsoar-codec-comparison-$stamp.json"
$json = Invoke-PaymentDb -q -At -f /audit/tests/payment-db/06_export_encoding_permit.sql
[IO.File]::WriteAllText($export, ($json -join "`n"), (New-Object Text.UTF8Encoding($false)))
node tests/payment-db/make-encoding-vectors.mjs permit $export $comparison
if ($LASTEXITCODE -ne 0) { throw 'Actual SQL/production TS permit comparison failed' }
$comparisonJson = [IO.File]::ReadAllText($comparison)
Invoke-PaymentDb -v "comparison_json=$comparisonJson" -f /audit/tests/payment-db/07_encoding_acceptance.sql
Invoke-PaymentDb -f /audit/tests/payment-db/10_contracts.sql
# Continue20,30 and all previously documented worker/concurrent/recovery scenarios,
# stopping at first failure. Do not manually insert markers.
# ONLY after all original34 + encoding checkpoints succeed:
Invoke-PaymentDb -f /audit/tests/payment-db/90_final_acceptance.sql
```

07 reruns05 assertions and requires the full actual SQL permit/TS comparison artifact,
then commits the private payment_db_codec.completion encoding row. It is NOT RUN.
90 requires that explicit additional checkpoint; original34 are unchanged. Final
record now reports version2/requiredCheckpoints35. A missing encoding schema/row fails.
35 excludes the final acceptance record itself. No gate was executed this turn.

Separate demonstrated issue awaiting review: floor(total_units*500/10000) in applied
059/060 overcharges1 base unit at max-u64. No amount/constraint repair was made.
Full evidence/proposals are in latest handoff. No database suite or end-to-end recovery
acceptance claimed. Funding remains disabled. Logs and original environment retained.

## Trigger/fee forward repairs and37-checkpoint resume (NOT EXECUTED)

First restore Docker Desktop's Linux engine and Ubuntu WSL integration. Exact probes:

```powershell
docker version
wsl.exe -d Ubuntu -- docker version
docker inspect flexsoar-payment-db-69c6161-20261016T022841Z
```

Do not reset/recreate the container. Reverify ID71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92,
network none, zero ports, exactly3 existing read-only audit mounts, then internal
TCP127.0.0.1 target flexsoar_payment_v2_test. Capture before definitions/metadata,
attachments/constraints and persisted attempts; affected financial rows must STOP.
Use the existing Invoke-PaymentDb function above only AFTER these identity guards:

```powershell
# NOT YET EXECUTED. Stop and preserve transcript on every nonzero stage.
Invoke-PaymentDb -f /audit/migrations/065_payment_v2_table_specific_terms.sql
Invoke-PaymentDb -f /audit/migrations/066_payment_v2_exact_usdc_fee.sql
# Then execute the already documented06 export -> offline TS comparison ->07 commands.
Invoke-PaymentDb -f /audit/tests/payment-db/08_terms_guard.sql
Invoke-PaymentDb -f /audit/tests/payment-db/09_exact_fee.sql
Invoke-PaymentDb -f /audit/tests/payment-db/10_contracts.sql
# Continue20/30, dedicated logins, signed storage, real separate-session races,
# terminal/rollback/stale lease/expiry scenarios, preserving actual lock evidence.
# Final command ONLY after every required success:
Invoke-PaymentDb -f /audit/tests/payment-db/90_final_acceptance.sql
```

Never rerun applied059–064 or committed03. Do not rerun a successful08 (its private
completion schema persists), or manually insert any checkpoint.08/09 force deferred
constraints before fixture rollback and record completion ONLY afterward. Gate version3
requires both repair records plus all previous35: NEW TOTAL37, excluding final record.
No successful record currently exists for these authored checks. Runtime compilation,
metadata preservation, CHECK validation and permissions/concurrency are still pending.

08 covers allowed updates and forbidden terms across all4 shared-trigger tables,
wrong-sale resolved events, and signature retention.09 checks12 independent expected
fee/net vectors against actual initiation and a copied actual CHECK definition, with
invalid-total/wrong-fee rejection; unaffected MYR remains2000/100/1900. TEMP fixture
accepts optional total for these cases; unchanged callers retain5000000 and normal
synthetic caps. No production caps/roles/funding changed. See latest handoff for full
migration pre/postflight contracts and explicit tooling blocker.

## Completed37-checkpoint run and mechanical corrections

The exact preserved container was configuration-verified while stopped, then ONLY that
container started. Internal TCP127.0.0.1 database flexsoar_payment_v2_test confirmed.
065/066 committed with metadata/attachments/constraints preserved and CHECK validated.
08/09 passed;06 actual permit export/offline TS comparison passed;07 encoding passed.
10/20/30 passed;35 setup and all five actual worker login tests36–40 +46 passed;
45/47 offline signed storage passed; both duplicate modes41/42 passed with actual
blocking; all8 financial races and both terminal-consumer pairs passed with actual
blocking; both SKIP LOCKED worker competitions passed with blocked third-party row
probes; both expired takeovers/stale completions passed; natural expiry/relink71 passed.
90 then required34 original +encoding1 +repairs2, asserted identities/backend evidence,
and COMMITTED final record (supabase_admin,PID2138,2026-10-16T07:34:00.635339+00:00).
Printed PAYMENT_DB_FINAL_ACCEPTANCE_COMPLETE. Final row is not one of37 prerequisites.

First07 regex{1380} was invalid PostgreSQL regex syntax. Changed only to hex+ AND
existing exact1380 length check; original semantics retained. Failed transaction's
schema absence verified before retry. First10 then hit action variable/column collision.
New forward067 qualifies only that selected decisions column with an unambiguous
query alias, preserving all metadata and proving exact alias-only source replacements.
Applied061 unchanged. Original errors/diffs/rollback evidence retained; failed stages
alone retried. Successful migrations and03 were not rerun; no scenario/guard weakened.

Full evidence in /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
resume-065-20261016T072710Z/: per-session transcripts,16 blocking JSON records,
3-backend queue overlap records, source snapshots/hashes, failures, metadata/catalogs,
actual permit and offline comparison, valueless signed fixture with NO saved private
key, exact final37 counts and committed final row. Environment remains running,
network none/no ports/three read-only mounts, same immutable image and container ID.
Do not rerun setup/fixtures on this completed target or delete evidence. Use a new
separately authorized disposable target for a fresh replay. Never apply the historical
compatibility repairs to production without independently reviewing its actual catalog.

No further DB-suite blocker observed in this run. Remaining production schema/catalog,
dedicated transport/identity and real chain-to-DB recovery verification remain open.
No public-chain traffic, operational keys/funds/emails or shared DB used. Application
validation is separate: current full suite486/490 (2 FSC +2 intermittent market-copy
failures); targeted market2/2. No shared tests changed. See latest handoff for limits.

## 080 post-079 cleanup: container run PASSED (2026-10-22)

Files: `80_cleanup_setup.sql` (fixtures, COMMITTED, plus the pre-080 behaviour as BEFORE| lines),
`81_cleanup_assert.sql` (after 080; read-only in effect, ends with ROLLBACK), `82_cleanup_refused_unchanged.sql`
(after a refused 080: nothing changed), and the host-side driver `run_080_container.sh`.

```bash
# WSL host. Refuses unless the container is network-none, has no port bindings, is unprivileged and loopback-only.
bash tests/payment-db/run_080_container.sh <container-id> <db-at-078> <out-dir>
```

The driver never writes `<db-at-078>`: it is only a CREATE DATABASE template for `flexsoar_080_base` (+079), and each
scenario gets a fresh `flexsoar_payment_v2_test` copied from that. 079/080 run as `postgres`, tests as `supabase_admin`.

- `nonadmin`, `enrolled`: 080 is refused by its preguard (a seller-review stamp by a non-admin user; a candidate enrolled in
  `payment_v2.inventory`), and 82 proves no item, redemption, ACL or body changed.
- `main`: 80 setup, 82 (before), 080 (NOTICE `moved 2`), 81 (28 PASS lines), 080 again (refused: `already carries the 080
  fragment 1`), 81 again (identical output).

Run on container `6ef7375a8c4e` (`flexsoar-schema-replay-20261021-0031`, supabase/postgres 17.11) from
`flexsoar_mig_test_20261021` (its 4 pre-079 bodies hash to production's preflight values): `T080_RUN_PASS`.

## 081 fn_set_card_visibility EXECUTE: container run PASSED (2026-10-22)

`84_card_visibility_acl.sql` (read-only in effect; `-v phase=before|after`) and the host driver `run_081_container.sh`.

```bash
bash tests/payment-db/run_081_container.sh <container-id> <db-at-078> <out-dir>
```

The driver builds `flexsoar_081_pre080` (078+079) and `flexsoar_081_base` (+080) from `<db-at-078>`, which it leaves untouched,
and gives each phase a fresh `flexsoar_payment_v2_test`.
- 081 without 080 is refused (`080 is not applied`), and the state is unchanged.
- Before 081, anon reaches the body and can tell a missing card (`card <id> not found`) from an existing one (`not your card`).
- After 081, the ACL is exactly {postgres, authenticated, service_role}, and anon gets `42501 permission denied` for any id.
- In both phases, owner and admin may toggle; another user gets `not your card`.
- A re-run is refused (`no longer grants EXECUTE to PUBLIC`), and the output is identical afterwards.

Run on `6ef7375a8c4e` from `flexsoar_mig_test_20261021`: `T081_RUN_PASS`.

## 081b retire the pre-launch test item: container run PASSED (2026-10-22)

`85_retire_test_item_setup.sql` (COMMITS; `-v variant=...`), `86_retire_test_item_assert.sql`,
`87_retire_test_item_unchanged.sql` and the host driver `run_081b_container.sh`.

```bash
bash tests/payment-db/run_081b_container.sh <container-id> <db-at-078> <out-dir>
```

- **85** builds the production shape from the 2026-10-22 inventory, with the real ids:
  - a seller-held, review-approved, minted item;
  - its card, `pending_vault` and owned by an admin buyer;
  - the sold listing;
  - a settled, unpaid `sol:` order;
  - mint plus sale ledger legs (two card legs and three currency legs netting to zero), 2 provenance rows and 1 notification;
  - an `awaiting_shipment` intake;
  - plus an unrelated sold card with its own open intake ("noise").
- **Refused variants:** `intake_shipped`, `order_paid`, `live_listing`, `card_active`, `redemption`, `not_reviewed`, `partial`,
  and the main shape without 081. Each is refused, and 87 shows every row identical afterwards.
- **`absent`** (noise only): 081b commits a no-op with a NOTICE; every row is identical.
- **`main`:**
  - 87 before;
  - 081b (NOTICE);
  - 86: exactly the card (status) and the intake (status and note) changed; the order is still settled and unpaid; not on
    `/market` or profile lists; noise untouched;
  - re-run refused;
  - 86 again, identical.

Run on `6ef7375a8c4e` from `flexsoar_mig_test_20261021`: `T081B_RUN_PASS`.
