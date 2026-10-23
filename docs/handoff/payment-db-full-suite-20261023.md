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

## Continuation run after executor-action audit — stopped at 083

Run used only container `6ef7375a8c4e4516b2edf3a5828c20269962905eac73ca70c1dd9c982f4fff21`, reverified as `NetworkMode=none`, no port bindings, `Privileged=false`, running, with loopback only. Source `flexsoar_mig_test_20261021` was verified as 078 and left untouched. A fresh chain was built from it through 079–085. An initial helper invocation attempted to reapply 082 to an already-derived helper database and hit 082's expected body-pin refusal; that helper was discarded and rebuilt from 081b. The final target was freshly cloned from the clean 083 helper before applying 084 and 085.

085 action audit result: every production executor action is covered. `execute_outcome` and `acknowledge_claim` are allowed by 085. `open_sale` and `revoke_sale` are issuer operations. Decision actions are staff-submitted and verifier-attested; the verifier marks them observed, so they do not need executor leases. No app or worker code inserts operations directly; enqueue calls are in migrations 060–062/067. The race fixture now uses a genuine direct-sale acknowledgement payload, disables that fixture's original acknowledgement row, then creates two equivalent eligible acknowledgement rows. The race assertions are unchanged.

| Action | Lease / actor role | Allowed by 085 for executor? | Why |
|---|---|---:|---|
| `open_sale` | `payment_v2_issuer` (issuer queue/context; no executor lease) | No | 060 enqueues it; 084 exposes the issuer-only open-sale queue and 068 supplies issuer context. |
| `revoke_sale` | `payment_v2_issuer` context; no separate revoke queue/lease RPC found | No | 062 enqueues it; 068 permits issuer-only revoke context. |
| `receipt` | Receiver staff; no worker lease | No | 061/067 decision operation is closed by verifier attestation, which marks it observed. |
| `authentication_pass` | Authenticator staff; no worker lease | No | Same decision/attestation path. |
| `authentication_fail` | Authenticator staff; no worker lease | No | Same decision/attestation path. |
| `release` | Release staff; no worker lease | No | Verifier attests the staff instruction; terminal outcome schedules `execute_outcome`. |
| `refund` | Governor staff; no worker lease | No | Two-governor approval gates the decision; verifier attests it; outcome execution uses `execute_outcome`. |
| `dispute` | Guardian staff; no worker lease | No | Verifier attests the staff instruction; it is not an executor transaction. |
| `review_authentication_pass` | Reviewer staff; no worker lease | No | Same decision/attestation path. |
| `review_authentication_fail` | Reviewer staff; no worker lease | No | Same decision/attestation path. |
| `resolve_dispute_release` | Governor staff; no worker lease | No | Governance decision is verifier-attested; no executor queue action is generated for it. |
| `resolve_dispute_refund` | Governor staff; no worker lease | No | Governance decision is verifier-attested; terminal outcome schedules `execute_outcome`. |
| `execute_outcome` | `payment_v2_executor` | Yes | 061 enqueues the chain outcome after the verifier accepts terminal authorization. |
| `acknowledge_claim` | `payment_v2_executor` | Yes | 061 enqueues acknowledgement after committed claim reconciliation. |

The run stopped at `83_solo_mode.sql` as required. Stage G2 raised `ASSERT: guardian disabled funding on all 7 networks`; the expected assertion is `n=7 AND NOT EXISTS(SELECT 1 FROM payment_v2.networks WHERE funding_enabled)`. This is not an identity or invocation mismatch. No tests were changed in response. Tests 84 onward were not run and final acceptance was not reached.

### Replay identities and results

Migration command template:

```sh
docker exec 6ef7375a8c4e4516b2edf3a5828c20269962905eac73ca70c1dd9c982f4fff21 \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d DATABASE \
  -f /tmp/w2p1-full/MIGRATION.sql
```

| Migration | Database | Login | Result |
|---|---|---|---|
| 079_review_approval_is_not_authentication.sql | flexsoar_084_pre79 | postgres | PASS |
| 080_post_079_cleanup.sql | flexsoar_084_pre79 | postgres | PASS |
| 081_revoke_public_set_card_visibility.sql | flexsoar_084_pre81 | postgres | PASS |
| 081b_retire_prelaunch_test_item.sql | flexsoar_084_pre81 | postgres | PASS |
| 082_payment_v2_solo_operator_mode.sql | flexsoar_084_pre81b (fresh clone) | postgres | PASS |
| 083_payment_v2_seller_listing_floor.sql | flexsoar_084_pre81b | postgres | PASS |
| 084_payment_v2_wallet_enrollment_and_views.sql | flexsoar_payment_v2_test | postgres | PASS |
| 085_payment_v2_executor_action_fence.sql | flexsoar_payment_v2_test | postgres | PASS |

Normal single-file test command template:

```sh
docker exec -e 'PGOPTIONS=-c payment_v2.test_identity=synthetic-payment-v2-only' CONTAINER \
  psql -X -v ON_ERROR_STOP=1 -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY \
  -h 127.0.0.1 -U LOGIN -d flexsoar_payment_v2_test -f /tmp/w2p1-current/FILE.sql
```

| File(s) | Login / command variables | Result |
|---|---|---|
| 03_completion_setup.sql, 04_sdk_encoding_vectors.sql, 05_encoding.sql | `supabase_admin`, normal template | PASS |
| 06_export_encoding_permit.sql | `supabase_admin`, normal template with `-qAt`; offline `node tests/payment-db/make-encoding-vectors.mjs permit` matched actual SQL permit (690 bytes) | PASS |
| 07_encoding_acceptance.sql | `supabase_admin`; psql include driver set exact `comparison_json` before including 07 | PASS |
| 08_terms_guard.sql, 09_exact_fee.sql, 10_contracts.sql, 20_outcomes_recovery.sql, 30_permissions.sql | `supabase_admin`, normal template | PASS |
| 35_workers_setup.sql | `supabase_admin`, normal template | PASS |
| 36_worker_issuer.sql | `payment_db_test_issuer`, normal template | PASS |
| 37_worker_verifier.sql | `payment_db_test_verifier`, normal template | PASS |
| 38_worker_settler.sql | `payment_db_test_settler`, normal template | PASS |
| 39_worker_executor.sql | `payment_db_test_executor`, normal template | PASS |
| 40_concurrency_setup.sql | `supabase_admin`, normal template | PASS |
| 40_worker_notifier.sql | `payment_db_test_notifier`, normal template | PASS |
| 45_export_synthetic_plan.sql | `payment_db_test_executor`, normal template with `-qAt`; offline `make-signed-fixture.mjs ISOLATED_SYNTHETIC_ONLY` generated a non-broadcastable synthetic envelope in OS temp | PASS |
| 46_worker_results.sql | `supabase_admin`, normal template | PASS |
| 47_signed_storage_contract.sql | `payment_db_test_executor`; psql include driver supplied operation id, lease id, and offline envelope | PASS |
| 41_session_a.sql / 42_session_b.sql, `race_mode=0` | Separate interactive psql backends, both `supabase_admin`; A committed after B showed a transaction lock wait | PASS |
| 41_session_a.sql / 42_session_b.sql, `race_mode=1` | Separate interactive psql backends, both `supabase_admin`; A committed after B showed a transaction lock wait | PASS |
| 50_races_setup.sql | `supabase_admin`, normal template; current fixture | PASS |
| 51_race_a.sql / 52_race_b.sql / 53_race_assert.sql, `conflicting_signature` | A settler / B verifier; assertion `supabase_admin`; `worker_role=payment_v2_settler` / `payment_v2_verifier` | PASS; lock wait observed |
| Same files, `conflicting_attempt` | A settler / B verifier; assertion `supabase_admin` | PASS; lock wait observed |
| Same files plus 58/59 terminal consumption, `release_refund` | A/B verifier; two separate settler sessions for 58/59; assertion `supabase_admin` | PASS; lock waits observed |
| Same files plus 58/59 terminal consumption, `refund_release` | A/B verifier; two separate settler sessions for 58/59; assertion `supabase_admin` | PASS; lock waits observed |
| Same files, `funding_cancel` | A `supabase_admin`; B settler; assertion `supabase_admin` | PASS; lock wait observed |
| Same files, `funding_revoke` | A settler / B verifier; assertion `supabase_admin` | PASS; lock wait observed |
| Same files, `revoked_funding` | A/B verifier; assertion `supabase_admin` | PASS; lock wait observed |
| Same files plus 60_rollback_ack.sql, `rollback` | A/B settler; A rolled back and ran 60 in same backend; assertion `supabase_admin` | PASS; lock wait observed |
| 57_prepare_queue_case.sql, 51/52/53, `operations` | 57/53 `supabase_admin`; A/B `payment_db_race_executor_a/b`, `worker_role=payment_v2_executor` | PASS; distinct `acknowledge_claim` leases carried valid sale/event/order payloads |
| Same queue files, `outbox` | 57/53 `supabase_admin`; A/B `payment_db_race_notifier_a/b`, `worker_role=payment_v2_notifier` | PASS |
| 57, 51/52, 54, 55, 53, `operation_takeover` | admin setup/expiry/assertion; A/B race executor; stale completion as original executor A | PASS |
| Same takeover files, `outbox_takeover` | admin setup/expiry/assertion; A/B race notifier; stale completion as original notifier A | PASS |
| 70_expiry_setup.sql / 71_expiry_relink_recovery.sql | `supabase_admin`; waited 35 seconds between setup and recovery | PASS |
| 83_solo_mode.sql | `supabase_admin`, normal template | **FAIL at G2:** guardian disabled-funding assertion above |
| 80–82 cleanup cases, 84–90, 91–94 | — | NOT RUN after required stop at 83 |

Cleanup dropped `flexsoar_payment_v2_test` and the three derived helper databases, revoked disposable test-role memberships, dropped all `payment_db_test_%` and `payment_db_race_%` roles, and verified no matching database or role names remained. The 078 source and pre-existing helper bases were untouched. `PAYMENT_DB_FINAL_ACCEPTANCE_COMPLETE` was not printed.
