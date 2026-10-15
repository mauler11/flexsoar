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
6. A HUMAN can then invoke these separately; every main test opens a transaction and rolls back synthetic fixtures. `01_fixtures.sql` is an include, never an independently runnable test. The fixtures synthesize key-shaped bytes, not secret signing keys and not purported chain evidence. Positive calls impersonate a trusted verifier for database contract testing; independent program/verifier tests establish actual chain verification.

```powershell
psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/10_contracts.sql
psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/20_outcomes_recovery.sql
psql -X -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/30_permissions.sql
```

Use a disposable administrator connection for these scripts. `30_permissions.sql` changes **session authorization**, not only current role, to exercise negative connection identity checks. It requires sufficient test-only administrator rights. Positive non-superuser issuer/verifier/settler/executor/notifier connection tests remain required after provisioning dedicated test login principals. Never make authenticator or service_role members to get tests working.

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
