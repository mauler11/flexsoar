# Payment DB full-suite continuation — stopped at executor queue fixture

Run date: 2026-10-23. Branch: `track/payment-security`. Commit containing this
handoff: recorded in Git history. This run used only container
`6ef7375a8c4e4516b2edf3a5828c20269962905eac73ca70c1dd9c982f4fff21`, verified
`NetworkMode=none`, no port bindings, `Privileged=false`, running, loopback only.
No network, staging, production, or external database was contacted.

## Result and stop reason

The fresh `flexsoar_payment_v2_test` replayed from the preserved 078 source
through 085. The full suite **stopped** at the `operations` SKIP LOCKED case:

- `57_prepare_queue_case.sql` made the two synthetic `test_lease_only`
  operations eligible.
- `51_race_a.sql` as `payment_db_race_executor_a` returned `[]`.
- `52_race_b.sql` as `payment_db_race_executor_b` returned `[]`.
- `53_race_assert.sql` as `supabase_admin` failed with
  `ASSERT: one durable lease each`.

This is not a connection or grant failure: both dedicated logins reached their
RPC and produced empty claim arrays. Migration 085 deliberately limits claims to
`execute_outcome` and `acknowledge_claim`; migration 050's test fixture enqueues
`test_lease_only`. The fixture action is outside that allow-list. No tests or
migrations were changed in response. Proposed disposition for review: decide
whether the queue fixture should enqueue a valid executor action for its
SKIP-LOCKED-only purpose, then independently review and rerun from a fresh 078
copy. Do not add `test_lease_only` to the production executor allow-list without
a separate security decision.

`90_final_acceptance.sql` was **not run**. The run did not print
`PAYMENT_DB_FINAL_ACCEPTANCE_COMPLETE`; final acceptance is not confirmed.
Suites 83, 88, 89, and 91–94 were not reached on this full-suite copy. Their
separate earlier focused run is not evidence for this run. Files 54/55, 70/71,
and later queue/takeover cases were not run after the first non-identity
failure. The mandatory final gate therefore remains open.

## Fresh replay and command identity

The source was `flexsoar_mig_test_20261021` (078). The helper databases were
created inside the same container, using `supabase_admin`:

```sql
CREATE DATABASE flexsoar_084_pre79 TEMPLATE flexsoar_mig_test_20261021 OWNER postgres;
CREATE DATABASE flexsoar_084_pre81 TEMPLATE flexsoar_084_pre79 OWNER postgres;
CREATE DATABASE flexsoar_084_pre81b TEMPLATE flexsoar_084_pre81 OWNER postgres;
CREATE DATABASE flexsoar_payment_v2_test TEMPLATE flexsoar_084_pre81b OWNER postgres;
```

The migration command for each listed file was:

```sh
docker exec 6ef7375a8c4e psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 \
  -U postgres -d DATABASE -f /tmp/w2p1-full/MIGRATION.sql
```

| Migration file | Database | Login | Result |
|---|---|---|---|
| 079_review_approval_is_not_authentication.sql | flexsoar_084_pre79 | postgres | PASS |
| 080_post_079_cleanup.sql | flexsoar_084_pre79 | postgres | PASS |
| 081_revoke_public_set_card_visibility.sql | flexsoar_084_pre81 | postgres | PASS |
| 081b_retire_prelaunch_test_item.sql | flexsoar_084_pre81 | postgres | PASS |
| 082_payment_v2_solo_operator_mode.sql | flexsoar_084_pre81b | postgres | PASS |
| 083_payment_v2_seller_listing_floor.sql | flexsoar_084_pre81b | postgres | PASS |
| 084_payment_v2_wallet_enrollment_and_views.sql | flexsoar_payment_v2_test | postgres | PASS |
| 085_payment_v2_executor_action_fence.sql | flexsoar_payment_v2_test | postgres | PASS |

The test file command template (one fresh psql process per row) was:

```sh
docker exec -e PGOPTIONS='-c payment_v2.test_identity=synthetic-payment-v2-only' \
  6ef7375a8c4e psql -X -v ON_ERROR_STOP=1 \
  -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -h 127.0.0.1 \
  -U LOGIN -d flexsoar_payment_v2_test -f /tmp/w2p1-full/FILE.sql
```

The test roles used actual LOGIN connections. The payment worker test files also
set their corresponding `payment_v2_*` role inside the SQL as authored. Result
and session logs were retained in `/tmp/w2p1-full-results` in the Ubuntu WSL
environment; the first failing SQL output is
`53_race_assert.sql-operations.log` there.

## Per-file results before the stop

For rows below, PASS/FAIL is the psql exit/result. “Not run” means execution
stopped before that file; no result is inferred from an earlier run.

| File | Login / variables | Result |
|---|---|---|
| 03_completion_setup.sql | `supabase_admin` | PASS |
| 04_sdk_encoding_vectors.sql | `supabase_admin` | PASS |
| 05_encoding.sql | `supabase_admin` | PASS |
| 06_export_encoding_permit.sql | `supabase_admin`, `-qAt`, isolated PGOPTIONS marker | PASS |
| `make-encoding-vectors.mjs permit` | offline production TypeScript encoder; named synthetic JSON in OS temp | PASS, 690-byte permit matched |
| 07_encoding_acceptance.sql | `supabase_admin`, `comparison_json` from the offline comparator | PASS |
| 08_terms_guard.sql | `supabase_admin` | PASS |
| 09_exact_fee.sql | `supabase_admin` | PASS |
| 10_contracts.sql | `supabase_admin` | PASS |
| 20_outcomes_recovery.sql | `supabase_admin` | PASS |
| 30_permissions.sql | `supabase_admin` | PASS |
| 35_workers_setup.sql | `supabase_admin` | PASS |
| 36_worker_issuer.sql | `payment_db_test_issuer` | PASS |
| 37_worker_verifier.sql | `payment_db_test_verifier` | PASS |
| 38_worker_settler.sql | `payment_db_test_settler` | PASS |
| 39_worker_executor.sql | `payment_db_test_executor` | PASS |
| 40_concurrency_setup.sql | `supabase_admin` | PASS |
| 40_worker_notifier.sql | `payment_db_test_notifier` | PASS |
| 41_session_a.sql | `supabase_admin`, `race_mode=0`; independent A backend | PASS; B observed waiting on lock, backend 19791 |
| 42_session_b.sql | `supabase_admin`, `race_mode=0`; independent B backend | PASS |
| 41_session_a.sql | `supabase_admin`, `race_mode=1`; independent A backend | PASS; B observed waiting on lock, backend 19837 |
| 42_session_b.sql | `supabase_admin`, `race_mode=1`; independent B backend | PASS |
| 46_worker_results.sql | `supabase_admin` | PASS |
| 45_export_synthetic_plan.sql | `payment_db_test_executor`, `-qAt` | PASS |
| `make-signed-fixture.mjs` | offline synthetic fixture only; no key saved or broadcast | PASS |
| 47_signed_storage_contract.sql | `payment_db_test_executor`, operation/lease/envelope from offline fixture | PASS |
| 50_races_setup.sql | `supabase_admin` | PASS |
| 51_race_a.sql / 52_race_b.sql / 53_race_assert.sql | `conflicting_signature`; settler A, verifier B, admin assertion | PASS; B lock wait observed, backend 20091 |
| 51_race_a.sql / 52_race_b.sql / 53_race_assert.sql | `conflicting_attempt`; settler A, verifier B, admin assertion | PASS; B lock wait observed, backend 20133 |
| 51_race_a.sql / 52_race_b.sql / 58_terminal_consume_a.sql / 59_terminal_consume_b.sql / 53_race_assert.sql | `release_refund`; verifier A/B, settler consume A/B, admin assertion | PASS; arbitration wait 20174, consumption wait 20204 |
| 51_race_a.sql / 52_race_b.sql / 58_terminal_consume_a.sql / 59_terminal_consume_b.sql / 53_race_assert.sql | `refund_release`; verifier A/B, settler consume A/B, admin assertion | PASS; arbitration wait 20247, consumption wait 20284 |
| 51_race_a.sql / 52_race_b.sql / 53_race_assert.sql | `funding_cancel`; supabase_admin A, settler B, admin assertion | PASS; B lock wait observed, backend 20312 |
| 51_race_a.sql / 52_race_b.sql / 53_race_assert.sql | `funding_revoke`; settler A, verifier B, admin assertion | PASS; B lock wait observed, backend 20354 |
| 51_race_a.sql / 52_race_b.sql / 53_race_assert.sql | `revoked_funding`; verifier A/B, admin assertion | PASS; B lock wait observed, backend 20398 |
| 51_race_a.sql / 52_race_b.sql / 60_rollback_ack.sql / 53_race_assert.sql | `rollback`; settler A/B; A rolled back and ran 60 in the same backend | PASS; B lock wait observed, backend 20435 |
| 57_prepare_queue_case.sql | `supabase_admin`, `race_case=operations` | PASS |
| 51_race_a.sql | `payment_db_race_executor_a`, `race_case=operations`, `worker_role=payment_v2_executor` | SQL returned `[]`; process PASS, assertion below failed |
| 52_race_b.sql | `payment_db_race_executor_b`, same variables | SQL returned `[]`; process PASS, assertion below failed |
| 53_race_assert.sql | `supabase_admin`, `race_case=operations` | **FAIL:** `ASSERT: one durable lease each` |
| 54_expire_test_lease.sql / 55_stale_worker.sql | — | Not run after stop |
| 56_consume_canonical_terminal.sql | — | Not run; README final procedure uses concurrent 58/59 for these terminal cases |
| 57_prepare_queue_case.sql for outbox/takeovers; remaining 51–55/53 | — | Not run after stop |
| 70_expiry_setup.sql / 71_expiry_relink_recovery.sql | — | Not run after stop |
| 80_cleanup_setup.sql / 81_cleanup_assert.sql / 82_cleanup_refused_unchanged.sql | — | Not run after stop |
| 83_solo_mode.sql / 84_card_visibility_acl.sql / 85_retire_test_item_setup.sql / 86_retire_test_item_assert.sql / 87_retire_test_item_unchanged.sql / 88_seller_listing_floor.sql / 89_wallet_enrollment_views.sql | — | Not run on this full-suite copy |
| 90_final_acceptance.sql | — | Not run; no final acceptance marker |
| 91_executor_fence_setup.sql / 92_executor_open_sale_fence.sql / 93_issuer_open_sale_queue.sql / 94_executor_fence_assert.sql | — | Not run on this full-suite copy |

## Race command pattern and lock evidence

For each 51/52 case, the sessions were independent `docker exec -i ... psql`
backends with the common isolated marker/acknowledgement above, each receiving
`-v race_case=CASE`; worker cases also received
`-v worker_role=payment_v2_ROLE`. Session A ran
`\i /tmp/w2p1-full/51_race_a.sql` and remained open. Session B ran
`\i /tmp/w2p1-full/52_race_b.sql`; for lock cases the driver polled
`pg_stat_activity` until B reported `wait_event_type='Lock'`, recorded the
backend, then committed A and B in that order. The rollback case rolled A back,
ran 60 in A's same backend, then committed B. Terminal consumption used 58/59
with two separate `payment_db_test_settler` backends and the same observed-lock
barrier. The queue case that failed did not wait: both claim RPCs returned empty.

## Invocation-only retries and cleanup

The initial attempt of the 06 export omitted the marker and was rejected by
`00_target_guard.sql`; it was rerun with the marker and passed. The first 07
invocation lost JSON quotes in PowerShell argument handling and rolled back; it
was rerun from Bash with the exact JSON in a single `comparison_json` argument
and passed. The first 47 invocation retained CR characters from a Windows text
file in its UUID variable and rolled back; stripping CR from the three variable
lines and rerunning passed. These were driver encoding/argument issues; no
assertions or SQL test files were altered.

After the non-identity queue assertion failure, the target and helper databases
were dropped. All `payment_db_test_%` and `payment_db_race_%` disposable roles
were removed after revoking their worker memberships. A final catalog query
returned no matching database or role rows. The source 078 database was left
untouched.
