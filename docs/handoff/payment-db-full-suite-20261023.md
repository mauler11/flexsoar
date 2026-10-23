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

## W2-P1-FIX continuation — G2 guardian funding-disable diagnosis (2026-10-23)

### Result and classification

**Classification: (b) TEST ASSUMPTION, not a kill-switch bug.** On each replay (078→082, 078→084, and 078→085), the G2 call disabled every enabled network row. No row remained with `funding_enabled=true`; there was no swallowed error, row-state filter, lock skip, or 084/085 regression. The 83 assertion assumes its seven fixture networks are the only enabled networks and asserts `n=7`. The required suite prefix had already committed 15 enabled synthetic networks before 83 created its seven G2 fixtures, so the actual correct return count was 22.

No test or migration was edited. This note is the only repository change for this diagnosis.

### Reproduction procedure and exact observation

Used verified isolated network-none container `6ef7375a8c4e4516b2edf3a5828c20269962905eac73ca70c1dd9c982f4fff21`. Each target was cloned from the 078 baseline and replayed only through the named migration. The 085 target ran the documented suite prefix through 71, then the exact 83 G2 fixture setup/reconciliation and guardian call in a rollback-only diagnostic probe. The same prefix and probe were run against 082 and 084 control clones. Before the G2 setup, the 085 prefix had 15 enabled networks; G2 added seven (A, B, C, D, E, R, S), making 22.

| Replay | Rows before G2 call | Enabled before | RPC return | Rows after | Enabled after | NOTICE / error |
|---|---:|---:|---:|---:|---:|---|
| 078→082 | 22 | 22 | 22 | 22 | 0 | None |
| 078→084 | 22 | 22 | 22 | 22 | 0 | None |
| 078→085 | 22 | 22 | 22 | 22 | 0 | None |

The full row snapshots showed the network relation has `id, genesis, program, config, mint, token_program, treasury, treasury_token, issuer, authority_epoch, policy_version, funding_enabled, max_trade_units, max_escrow_units`; there are no pause, outflow, or state columns. All 22 rows on each run had `max_trade_units=50000000` and `max_escrow_units=100000000`. Every listed ID was `funding_enabled=true` before the call and `false` after it.

IDs observed, grouped by replay (the snapshots include all columns above):

- **078→082 (22):** `0da821de-877a-4a05-b806-a5a22d41766f`, `0e479259-96f6-406b-a074-3e427c8e2777`, `1aa35313-b0b7-4c27-a08b-1e82ba87ad9c`, `1e79d080-10d7-4488-a548-4646c96ecdf0`, `1ffc0175-899e-4d14-a177-19f26995cacd`, `3e1b2fbf-219a-4c99-acb4-705e85d23593`, `4e53e7a3-332b-4b27-8408-a58fa4139bd5`, `5284308b-54cc-4422-a932-855f0b8dc1d8`, `530a77d1-536e-482d-a2ab-fbb15c874192`, `55d8caab-2ba7-4fc4-9a63-0e61d4b1e9c2`, `56359cfa-6398-4d3e-9b57-97f1fa208a28`, `71fe199b-2c5d-4e8d-b105-1e192b39c38f`, `76700ba5-a712-4c97-b8c5-52c58f0840b1`, `76b21512-adce-4325-b405-d1ba7f6c3482`, `89da58ab-34e4-4926-b6fe-ce68f380dc53`, `9579b57d-a1aa-4975-9b56-e3e3324f5f83`, `957ddeb7-e92b-4785-bfa1-0de379166d67`, `9aa55bfe-6e13-4a13-b8b9-184c7a505beb`, `a78d41ad-6d34-49bb-974b-48fdebe4c120`, `c96969cd-c2b3-4bc7-8e69-e432f517cf59`, `e5392102-46c2-4e47-99a5-9a8867740e1f`, `fcc659c0-cd45-4a48-8783-a3db4046b9ea`.
- **078→084 (22):** `040e4076-32cd-4753-8181-bd353565f2ac`, `0acaffbd-8b1e-4cae-a98a-0dbe48be1460`, `1d856f96-d988-447f-8219-54e1d9072093`, `20ea9832-03ce-4a23-ade5-6a8930df9419`, `249f081b-18af-4ccb-ab7c-e3a66eeb8574`, `38a2ec0c-dea4-4cec-85fb-94b68e453ca4`, `3c9aad74-1c6a-4cf6-84cc-1487e7e9f7fb`, `59533be2-77dc-493b-9321-343c8d38076e`, `74aa0ab2-8138-4b0b-ace2-85c90c24c435`, `7b8e894b-9aa4-4ddc-b5a2-56aafb682462`, `7c7ca80c-d277-4c9f-80d4-e4d6e3031ec0`, `84b33d28-d1d0-4d9f-8e5f-24b7de9b6a3e`, `8a5faaa4-141c-47c4-b4cf-1944276d589f`, `8fe067b9-e25c-4d55-a279-3304dda0b192`, `95c9b767-2601-4fba-81bf-87c1e1826c9a`, `95dc87c3-c7dd-4d0c-a95d-152800099a0f`, `a38468c9-598a-419a-8127-69630da26f89`, `a42856fd-489c-4d38-b2b7-59d7e3c2d4f1`, `bb2eeec8-9a58-4877-85b5-69cb90e912c0`, `c99426e7-1ba2-48d8-9e22-f37546518f63`, `ecddbded-5deb-42cf-9884-8f81ad6c86b3`, `fe7bb933-5df7-4752-8f17-41d52f38613f`.
- **078→085 (22):** `02a6e0b2-ed45-4741-95de-6e85dc625bcf`, `094ef6f5-65c6-400c-b469-52bdc69a1912`, `27e441af-b287-487d-838f-b8c80fa1ec4e`, `2bec2fab-fdb8-41e1-bc13-71dba765491b`, `2c25e539-b74d-4a5d-8ebf-ea527c441a6c`, `3f7d7a2d-b25b-46ca-bf69-40ebd3ad26a4`, `74325f9a-4abe-4e82-8ccd-17f5fc96051d`, `76bd47e0-17f6-48d9-87d5-b408ffaf2572`, `923c7de3-1fd1-42d6-a16f-e245d95d73fa`, `9f33a897-7751-4e2c-af8b-0de5becae187`, `b67594e9-b66c-4635-a525-a5fe7e472c88`, `bdf8e0d6-c497-4855-855f-8a8b326d1251`, `c2ddd1bd-17a9-464e-bd26-ec2808ca2460`, `c7527f34-ec4d-48f5-b3c0-bebb7c7035dd`, `d012f5aa-91d8-4d98-8893-685b4b64179d`, `d25a1daa-c281-4afb-ad92-ea98089ab94c`, `ddd50cf1-1674-4a55-a5da-1babb4cc9a50`, `df6ec6f7-599b-4ca7-afcb-794922939b68`, `f08b2aab-a958-4b3a-9ead-490353dee561`, `fa03b7bc-fe3e-48d2-80ea-6ed1b925314e`, `fad06294-a928-4ae5-be21-7fa796fb9d62`, `fc871a95-4314-4a5c-adc8-68bbda1f0236`.

### Function and migration comparison

In 082, 084, and 085, `fn_payment_v2_disable_funding` has identical `md5(prosrc) = 233706325f97c1d1b4ffffc8e7f1bffa`, owner `payment_v2_owner`, `SECURITY DEFINER`, `search_path=pg_catalog`, and ACL `{payment_v2_owner=X/payment_v2_owner,authenticated=X/payment_v2_owner}`. Its body verifies an active guardian/governor, then runs `UPDATE payment_v2.networks SET funding_enabled=false WHERE funding_enabled`, reads `ROW_COUNT`, and returns it. It has no status predicate or `SKIP LOCKED`; the all-rows update completed on all three versions. The 085 queue-fixture action change did not affect the network count or function.

### Cleanup

Dropped all task-created diagnostics (`flexsoar_diag_pre79`, `flexsoar_diag_pre81`, `flexsoar_diag_082base`, `flexsoar_diag_082`, `flexsoar_diag_084`, `flexsoar_diag_085`) and `flexsoar_payment_v2_test`. Dropped the nine disposable `payment_db_test_%` and `payment_db_race_%` logins after revoking their worker-role memberships and dropping owned objects. Final query returned no matching database or login names. The 078 source and pre-existing helper databases were preserved. `postgres` did not have the required cluster authority for role cleanup; cleanup was completed as `supabase_admin` (superuser) inside the isolated container.

## W2-P1-FIX R5b continuation — stopped at G2 (2026-10-23)

### Stop finding

The fresh full-suite target replayed from 078 through 085 successfully. The run stopped at `83_solo_mode.sql`, G2, with `ASSERT: guardian disabled every network that was funding-enabled`. This is the first non-driver suite failure in this run. By instruction, no later full-suite file was run and the assertion was not edited again. The G2 failure remains a finding; this run did not separately capture its RPC return value or post-call rows before the test transaction rolled back. The earlier G2 diagnosis in commit `13b73d5` recorded that the 085 function disabled all 22 enabled rows in the rollback-only probe. The current 83 test combines the mutating RPC and post-call `NOT EXISTS` in one SQL expression; statement snapshot/evaluation ordering may explain the assertion, but this was not verified in this run and must be reviewed before classifying this as a runtime kill-switch failure.

### Required focused proofs completed before the full run

- **R5b-02 old-query proof:** the test used deterministic, distinct `created_at` values for 20 unsigned prepared operations, all older than the later signed operation. In a disposable 078→084 scratch target, the pre-fix queue body from committed migration 084 at `c50feb9` was installed temporarily. `89_wallet_enrollment_views.sql` failed at the intended queue assertion (`issuer queue filters all eligibility predicates before limit`), psql exit 3. A separate fresh 078→084 target using current 084 passed 89 with `T089|SUITE_PASS`.
- **R5b-01 focused executor proof:** after replaying 085, the real `payment_db_test_executor` login ran 92. Missing random operation UUID, wrong lease for an existing allowed `acknowledge_claim`, valid lease for existing `open_sale`, and valid lease for existing `revoke_sale` all returned the same SQLSTATE/message: `P0001 / PAYMENT_V2_OPERATION_LEASE_LOST`. The issuer queue test and administrator postcondition were not run on the full target before the G2 stop.

### Full-run environment and effective results through the stop

A local snapshot clone was required because Docker Desktop had stale bind mounts on the preserved stopped container. The original container was preserved. The run used clone `733813cfd1b173d984ef248ed6518b921cd37e3c3fdf57c30d51f1c33b290518`, reverified `NetworkMode=none`, no port bindings, `Privileged=false`, running, and loopback-only. Its 078 source was `flexsoar_mig_test_20261021`, verified to have zero networks and no 082 governance table. All migrations and tests used only this isolated clone.

Migrations 079, 080, 081, 081b, 082, 083, 084, 085: **PASS**.

| File / scenario | Identity | Effective result |
|---|---|---|
| 03, 04, 05 | `supabase_admin` | PASS |
| 06 SQL export + offline `make-encoding-vectors.mjs permit` + 07 | `supabase_admin`; wrapper supplied the full comparator JSON to psql | PASS; an initial PowerShell argument-quoting attempt was rejected, then the corrected wrapper passed |
| 08, 09, 10, 20, 30 | `supabase_admin` | PASS |
| 35 | `supabase_admin` | PASS |
| 36 / 37 / 38 / 39 | dedicated issuer / verifier / settler / executor logins | PASS |
| 40, 40 notifier, 46 | `supabase_admin`, notifier login, `supabase_admin` | PASS |
| 41 / 42 `race_mode=0` | both independent sessions `supabase_admin` | PASS; B observed waiting on a lock before A committed |
| 41 / 42 `race_mode=1` | both independent sessions `supabase_admin` | PASS; B observed waiting on a lock before A committed |
| 45 + offline signed fixture + 47 | `payment_db_test_executor` | PASS; initial wrapper used the wrong nesting for operation id and lease id, then corrected |
| 50 | `supabase_admin` | PASS |
| `conflicting_signature` | settler A / verifier B / admin assertion | PASS; lock wait observed |
| `conflicting_attempt` | settler A / verifier B / admin assertion | PASS; lock wait observed |
| `release_refund` | verifier A/B; settler consume A/B; admin assertion | PASS; both arbitration and consumption lock waits observed |
| `refund_release` | verifier A/B; settler consume A/B; admin assertion | PASS; both arbitration and consumption lock waits observed |
| `funding_cancel` | `supabase_admin` A / settler B / admin assertion | PASS; lock wait observed |
| `funding_revoke` | settler A / verifier B / admin assertion | PASS; lock wait observed |
| `revoked_funding` | verifier A/B / admin assertion | PASS; lock wait observed |
| `rollback` | settler A/B; A rollback then 60 in same session; admin assertion | PASS; lock wait observed |
| queue `operations`, `outbox` | paired executor / notifier race logins; admin assertion | PASS |
| `operation_takeover`, `outbox_takeover` | A lease, admin expiry, B takeover, stale original A login, admin assertion | PASS |
| 70 / 71 | `supabase_admin`; waited 35 seconds | PASS |
| 83 G2 | `supabase_admin` | **STOP / FAIL:** `ASSERT: guardian disabled every network that was funding-enabled` |

Files after the stop were not run in the full target: 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94. The focused 89 and 92 proofs above are not full-target results. The 80–82 migration-specific cleanup cases were not run on this already-080 target; their documented stage-specific drivers were not run in this task. `PAYMENT_DB_FINAL_ACCEPTANCE_COMPLETE` was not printed. `npm test`, `npx tsc --noEmit`, and `npm run build` were not run after the required stop.

### Hashes, cleanup, and changed files

SHA-256 for 084: `25dfcd88a5a23b47dacc046fd2e6e595271b3431738b86e9f675e12cfb418283` (unchanged). SHA-256 for edited 085: `a10ba3cf0c3b2b4e703cf93c6618e75d9d40984ce60cf45440bbe6190c80b7cf`.

Dropped `flexsoar_payment_v2_test` and revoked/dropped all disposable `payment_db_test_%` and `payment_db_race_%` logins. Final cluster query found no matching test databases or logins. The 078 source and pre-existing helper databases were preserved. No staging, production, or network database was contacted.
