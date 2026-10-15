# Payment-v2 database drafts: NOT RUN

SQL authoring was authorized; SQL execution was not. No file in this directory has been executed. No SQL parser, database, container, migration runner, seed or catalog connection was used. TypeScript tests do not load these files. Passing application tests do not prove any grant, constraint, trigger or lock here.

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
