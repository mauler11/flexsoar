# Actual coupled integration (2026-10-16, continuation of22f5ab1)

The accepted `flexsoar_payment_v2_test` and its37-checkpoint final record are preserved.
The NEW `flexsoar_payment_v2_integration_test` uses the same isolated server, not a
clone with data. The old suite's exact target guard is unchanged.

Setup evidence is in Ubuntu:
`/home/family/flexsoar-payment-db-69c6161-20261016T022841Z/integration-db-20261016T082030Z/`.
Financial execution evidence is under the EXISTING helper's
`/state/integrated-JXopR6/`. Do not delete/reset either, inspect private test-key
contents, rerun schema restoration, or rerun signable setup into populated sales.

Schema procedure ACTUALLY executed:
1. Reverified exact container ID, network none, zero published ports and three RO
   mounts. Created database with template0 and owner supabase_admin; no new server.
2. Official pg_dump17.11, schema-only, excluding `payment_db_*`. The reviewed full
   dump includes official extension definitions, Auth helpers, RLS/ACLs/owners,
   publication and event triggers. The earlier narrower schema draft was NOT restored.
3. Restored with psql --single-transaction/ON_ERROR_STOP. Normalized dumps match
   exactly (only randomized pg_dump restrict/unrestrict token removed). Every table
   in public/auth/payment_v2 was asserted empty BEFORE reference seeds or fixtures.
4. Seeded ONLY exact policy INSERT from059, tier bands from001 (003 bounds agree),
   condition bands from018, and048's tier5 border-color change from checked-in source.
   No platform-config rows needed for these payment paths; none copied from accepted DB.
5. New synthetic users/staff/wallets/networks via01/02 fixtures, real signable local
   keys, distinct persons for independently approved roles and3 governors. These
   are test independence, NOT actual staff or a tested Squads deployment.
6. Added LOGIN payment_integration_customer with ONLY authenticated membership;
   existing five integration worker LOGINs unchanged. Added executor_b with ONLY
   payment_v2_executor membership for takeover. No existing cluster role altered.

First pre-sale fixture attempt rolled back because absent condition reference bands
caused a NULL grade. Its input/logs retained. Initial unsaved test keys were lost on
that process exit. Before ANY sale/Card/order/attempt/operation existed,01 rotated
ONLY this new database's synthetic configuration: prior staff marked inactive and
network funding false, new signable fixture inserted, history retained. No identities
or configuration in the accepted database changed. Subsequent keys are explicitly
labelled ephemeral, mode0600, retained ONLY outside repository for restart. Never use
these files as operational keys or as a production transaction store.

## Real scenarios and limits

`integrated.mjs` uses production encoders/builders, dedicated psql transports,
financial observer/reconciler, signed-envelope validation/storage, and own-attempt
status adapter. Fixture admin SQL is isolated in test orchestration; no admin login
is passed to a production worker. Authority expected instructions derive from the
prepared sale / recorded decision / actual settler consumption result. Finalized
transaction bytes/accounts/signers are observed, not fabricated proof JSON.
Acknowledgement hashes the actual committed consumption; no simulated commit digest.

Completed core cases: vaulted direct95/5; escrow receipt/authentication/independent
release95/5; governed full-principal refund; finalized acknowledgement and durable
status; two real buyers per sale with zero losing principal debit. Receipt alone
and authentication alone held funds and claim. Signed-storage response loss was
injected AFTER real commit; original envelope was reloaded and broadcast. Financial
reconciliation was retried idempotently. The new SQL audit checks exact order count,
claim ledger/cache, MYR snapshots separately from USDC units, journal row counts and
balance, one consumption per event and atomic outbox counts; no notification sends.

A separate direct case intentionally stopped the real process after finalized
payment, waited for quote expiry, recovered, lost the actual first settlement commit
response, then stopped again after finalized acknowledgement + synthetic wallet
relink. Resume recovered the same order/claim without another buyer signature.
A later NEW purchase using the old linked wallet was correctly refused. Fresh
additional buyers were inserted additively; the relinked user was not reverted.

A separate registration (case3) timed out before any buyer attempt/payment. Its
signature and opening sale remain preserved/unresolved; no replacement was signed.
Read-only audit saw no finalized Card and no signature status. Root cause not proven;
readiness was tightened from genesis-only to getHealth before any transaction. All
new test sends now retain bytes before broadcast. Case4 is a DIFFERENT synthetic
Card/sale for failure tests, never a replay or replacement of case3.

Restart observation of original terminal envelopes used production recovery policy;
expired blockhash + already finalized release returned reconcile, not retransmit.
Stale completion of observed operations was rejected. Actual five-minute takeover
and an intentionally expired, never-broadcast outcome are separately recorded below.

NOT established: full production worker daemon/authority signer integration,
Supabase Auth HTTP/browser recovery, browser UI/network/session behavior, production
funding readiness, real Squads/person independence, redemption or public-chain safety.
Authority observation requires trusted immutable context; durable bounded reads and
signed plans for open/attestation/ack remain incomplete. The harness signs those
setup/control commands explicitly; file retention is NOT a production durable store.
Only execute_outcome is supported by production signed-operation storage.
Opposing terminal commands and duplicate execution test terminal exclusivity; they
are not a concurrent release/refund race proof. Earlier37 DB checkpoints stay separate.

## Commands: explicit existing target only

Inside Ubuntu, from the worktree (host checks are mandatory):

```bash
H=flexsoar-payment-integration-20261016T075407Z
bash tests/payment-integration/attest-helper.sh "$H"
docker exec "$H" /tools/runtime/ld-linux-x86-64.so.2 --library-path /tools/runtime /tools/node --loader /work/tests/payment-integration/ts-loader.mjs /work/tests/payment-integration/integrated.mjs --observe-isolated-integration /state/integrated-JXopR6
```

Observe mode restarts ONLY the owned ledger/validator, performs no financial sends;
terminal contradictory test commands are signed/broadcast and MUST fail on-chain.
It runs read-only accounting assertions and intentionally rejected stale-worker RPCs.
It is therefore an authorized local test command, NOT a pure read-only system probe.

To continue an interrupted authorized run, use the same command with
`--resume-isolated-integration /state/integrated-JXopR6`. It NEVER resets a ledger.
Injected stops deliberately exit1 and retain dated failures. Resume ONLY after
inspecting the exact failure; never loop blindly on errors. Unsupported/expired
signed operations remain blocked. Do not rerun `--run-isolated-integration` against
these populated sales. Host attestation also requires exact image/isolation/mounts;
a matching database name is insufficient. Original payment-db suite is untouched.

---

Historical discovery and earlier commands follow; the above supersedes their old
statement that all financial integration was unimplemented.

# Local payment integration: transport/topology exercised, financial scenarios BLOCKED

Actual results: five dedicated PostgreSQL transports passed; loopback-only local
validator finalized a valueless airdrop and loaded the reviewed program; production
observer read actual finalized chain state. Production reconciliation correctly
refused the unconfigured local network. These are component/fail-closed checks,
NOT successful purchases or complete chain-to-database integration.

Do not alter the accepted database fixtures: its global staff configuration has10
synthetic public keys without matching signing keys. New signable keys would violate
global funding_configuration counts; replacing/deactivating old keys would repurpose
the accepted run. Before full financial integration, obtain approval for a separate
empty integration database in the SAME isolated PostgreSQL container. See handoff.
No new database or authoritative schema/permission changes were made by this task.

## Existing exercised environment

- DB flexsoar-payment-db-69c6161-20261016T022841Z, ID71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92.
- Helper flexsoar-payment-integration-20261016T075407Z, network container:that exact ID.
- Both share loopback ONLY, no routes/published ports/Docker socket/production env files.
- Official image pinned to supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc.
  Helper overrides upstream entrypoint, so NO upstream SQL initializes automatically.
- Helper UID1000, read-only root, capabilities dropped, no-new-privileges; only NEW
  evidence state + tmpfs writable. Node22.14.0/Agave2.1.0 run via read-only Ubuntu
  runtime libraries, psql17.11 uses image's Nix runtime. All tools pre-existing.
- lib/node_modules/test source mounted READ ONLY; no copying/installing dependencies.
- Reviewed.so hash99aa6bec4e949de3484bc7fef0b70a83b040bdf92a1060871fe4de8d4c64743c.
- Agave2.1 sockets may bind wildcard, but namespace has only lo. Probe captures live
  DB5432,RPC18899,pubsub18900,faucet18901 and gossip18902 bindings before testing.

## Reproducible commands

Inspect current helper/DB configurations and namespace identity first. Never recreate
DB, change network mode or reset data. The additive00_worker_logins.sql fixture has
ALREADY committed five integration-only non-superuser LOGINs in the existing server;
do not rerun/repurpose them. Existing payment_db_* records remain unchanged.

From PowerShell, execute the actual read-only identity smoke against the known helper:

```powershell
$helper = 'flexsoar-payment-integration-20261016T075407Z'
docker exec $helper /tools/runtime/ld-linux-x86-64.so.2 --library-path /tools/runtime `
  /tools/node --loader /work/tests/payment-integration/ts-loader.mjs `
  /work/tests/payment-integration/transport-smoke.mjs
```

Only after inspecting helper isolation, explicitly start a NEW probe ledger:

```powershell
docker exec $helper /tools/runtime/ld-linux-x86-64.so.2 --library-path /tools/runtime `
  /tools/node --loader /work/tests/payment-integration/ts-loader.mjs `
  /work/tests/payment-integration/topology-probe.mjs --run-isolated-probe
```

Probe keeps its Node bootstrap key in memory; the validator creates its own ephemeral
ledger key files (mode0600). No operational keys are loaded or mounted. It waits for FINALIZED HTTP status,
uses no public-chain endpoint, never initializes application funding, stops ONLY its
owned validator child, and retains a unique /state/probe-* ledger/result directory.
First probe revealed an outstanding web3 subscription after child shutdown; corrected
probe uses HTTP polling and exits0. Original failure evidence preserved.

For a separately authorized NEW helper (not a new database), inside Ubuntu:

```bash
bash /mnt/c/Users/Family/flexsoar-payment-security/tests/payment-integration/create-helper.sh --create-isolated-helper
```

Script checks exact DB ID/image/network/mounts and refuses existing helper names.
It does NOT execute SQL or start the validator. No Docker socket is mounted into it.
Use printed helper name/evidence directory; never confuse it with a production worker.

## What is unimplemented / unproven

- Real direct/escrow/refund flows coupled to PostgreSQL and their financial outcomes.
- Trusted finalized attestation/lifecycle verification with bounded verifier read
  contracts; no borrowed executor/admin role or fabricated proof JSON permitted.
- Signed-operation plans beyond execute_outcome; existing guard supports one signer
  and8 nonsigning instruction accounts. Other authority commands remain blocked.
- All requested integrated crash/restart/lease/expiry/relink tests, actual competing
  buyers, authenticated recovery API and UI. Existing offline/unit/37-checkpoint DB
  tests are separate evidence and are NOT relabelled integrated passes.

Next reviewed setup: fresh flexsoar_payment_v2_integration_test in SAME server,
schema-only copy from LOCAL synthetic reviewed schema (exclude payment_db_* and ALL
accepted data), reviewed static reference seeds only, fresh signable ephemeral staff/
users/Items/Cards/listings. Preserve original target and guards. Do not create it
without extending authorization beyond the currently named existing database.

Evidence: /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/integration-discovery-20261016T074634Z/.
Public funding stays false. No deployment, operational key loading, public-chain
signing/broadcast, emails or shared/cloud database access is authorized by this README.

### Final integrated result and remaining stop (supersedes provisional status above)

ACTUALLY EXECUTED:5 terminal sales (2direct,1escrow release,2full refunds), plus1funded
escrow intentionally left in review and1unpaid opening/registration unresolved. Six
actual two-buyer races: one principal debit per sale, rejected buyer debit0. Completed
Card acknowledgements were verified and reconciled at original execution;5-sale
read-only audit subsequently passed exact orders/claim ledger/cache/MYR/USDC/journal/
consumption/outbox checks. No artificial acceptance markers in the old37-checkpoint DB.

Case6 real5-minute lease expired; dedicated payment_integration_executor_b took over
with a different lease UUID, same signature/bytes, recoveryOnly=true. Old executor's
completion failed LEASE_LOST. Finalized observation found signature absent, Sale funded,
original blockhash expired. No outcome broadcast, replacement or refund. Operation
27bc0cae-1766-4295-b86c-6457289edd6b now DURABLY state=unknown, same original signature,
last_error starts REVIEW_REQUIRED and forbids replacement/repayment. This used existing
finishPaymentOperation RPC through executor_b, NOT an administrator table update.
Principal1M remains in test escrow and conditional claim pending_vault. This is a
successful fail-closed/review test, NOT a completed refund or settlement.

Read-only03 audit initially failed parser ambiguity around CASE in IF. Original input,
error, diff/hashes retained; ONLY parentheses added. Failed READ ONLY transaction
rolled back; retry ONLY that audit exit0. No applied migration or predicate changed.
Both preserved containers later had externally stopped, exit255/OOMKilled=false. The
host guard refused to proceed. Exact IDs/configurations captured and ONLY those exact
containers restarted; no recreate, reset, migration or initialization replay. New
network namespace re-attested; network none/no ports/RO mounts remain intact.

IMPORTANT ADDITIONAL RECOVERY BLOCKER (not hidden as a pass): a later full ACK-history
recheck after restarts failed closed. Case0 getTransaction=null, signatureStatus=null;
actual getBlock(156) returned-32001: block156 cleaned up, first available1084. No
instruction/clock data fabricated from current owner state. Prior completed DB claim
is still available and its immutable lifecycle evidence retained; the later archival
reverification itself is BLOCKED. Financial terminal-state recovery still selects
reconcile, including expired originals, without another transaction.

Confirmed harness retention defect: Agave2.1 defaults to10000shreds. New starts now
explicitly use --limit-ledger-size1000000 and require5GiB free (df showed~949GiB free).
Actual updated startup succeeded; old pruned ACK still unavailable, as expected.
This does NOT restore deleted blocks or prove production archival retention. Need
an archival observer / durable verified-event retention window and tested pending-ACK
recovery before launch. Do not relax finality/instruction checks or resend ACK/payment
to conceal missing history. --observe-isolated-integration currently exits1 at that
known archive gap after the other audit checks. --record-expiry-review-isolated-
integration is a separate explicit mode, skips that supplemental archival recheck,
and records ONLY the original expired operation's durable review obligation. It is
not an all-scenarios acceptance command. No claim that every requested boundary passed.

FINAL application validation (normal commands, no alias/config adaptation):
- npx --no-install tsc --noEmit: exit0.
- npm test:512total,507pass/5fail,18files pass/1fail. Two known FSC-copy assertions
 at shared invariants1901/1960; additionally admin intake mock missing .maybeSingle(),
 market renders2 missing .in(). Earlier full512 run510pass/2fail; do NOT call final run
 a pass or erase either result. Focused authority+transport22/22passed.
- Baseline-equivalent CONTROL only (NOT standard full validation): npx --no-install
 vitest run --exclude tests/payment-authority-observer.test.ts ->499pass/2knownfail/
 501total. All old source/config/shared tests identical to22f5ab1. New test has no
 global mocks or shared mutations; nondeterministic mock selection remains unresolved.
- Targeted shared control:3selected,1pass/2market fail,244skipped. Not a full-suite pass.
- npx --no-install next build --webpack: exit0,40/40pages. Existing optional Privy
 @farcaster/mini-app-solana warning remains; runtime mini-app feature not verified.

FOCUSED SHARED-TEST HANDOFF (market/admin/shared-test owners, no edits made):
Two contract vi.mock factories253/2941 and two Supabase factories2925/2998 in
invariants.test.ts disagree. The2925 .select() object has .eq() only (no .in(); nested
.eq() no .maybeSingle()). Actual market load caught 'select(...).in is not a function'
and rendered loadError; this suppresses the empty-state text expected3180/3186.
Admin page64 reached real getConnectOnboardingStatus instead of its intended mock and
failed missing maybeSingle. Market cached.ts imports contract functions at module
scope and retains30s/300s entries. Baseline source unchanged. Consolidate per-module
mocks, instrument actual factory selection, use explicit builder methods or targeted
contract stubs, clearMarketCaches between renders; preserve assertions. Exact hoisting/
cache/order trigger not proven; don't declare these3 failures pre-existing solely from
this control or claim a payment fix solves them.

Accepted DB AFTER runs/restart: schema normalized dump identical to initial source;
final record still completed_at2026-10-16T07:34:00.635339+00:00,PID2138,version3/37;
staff10/10active,orders28. No accepted rows/functions/staff modified. All financial/
fixture writes targeted NEW integration DB only. Source dependency hashes still exact
D98A62F311AF26DA6B39B095B1D19BA9D6C2CDE7843EBA6FB7A82F6A3201EC8A and
1DEC156573D13BFCA04776527634BBDDD3765B6F5AAFB443599FCE70341DA56F.

Evidence final-observe.log/exit0 =5-sale audit+opposite terminal rejection; remaining-1
contains actual lease takeover plus first03failure;03-audit-retry.log/exit0 corrected
read-only audit; durable-review.log/exit0 preserves unknown/review state; authority-
history-diagnostic logs + authority-history-gap*.json contain actual archive failure;
retention-startup-check confirms updated flag works but old gap stays blocked. Final
application logs retained outside repo in Windows TEMP flexsoar-final-{tsc,tests,build}
and flexsoar-baseline-control/final-focused/shared-focused logs.

Next concrete work: review bounded control-operation context/plan RPCs and signer/
worker integration; specify archival retention and recover the archived-evidence gap
without new payments; review explicit replacement protocol for original expired/
uncertain operations. Do NOT resolve the preserved review/registration cases by
clearing signatures, altering evidence or creating another purchase of those claims.
Public funding, production cutover, operational authorities and redemption remain blocked.

Exact bounded review command (records original expired operation as unknown/review;
no financial broadcast; does not claim historical ACK availability):

```bash
H=flexsoar-payment-integration-20261016T075407Z
bash tests/payment-integration/attest-helper.sh "$H"
docker exec "$H" /tools/runtime/ld-linux-x86-64.so.2 --library-path /tools/runtime /tools/node --loader /work/tests/payment-integration/ts-loader.mjs /work/tests/payment-integration/integrated.mjs --record-expiry-review-isolated-integration /state/integrated-JXopR6
```

Only run when the original operation is available for its dedicated lease. Normal
observe mode deliberately fails at the known pruned ACK; do not reinterpret that
exit1 as acceptance. Updated retention startup was actually exercised, not merely
prepared. No new Rust compilation was needed because the program source is unchanged.
