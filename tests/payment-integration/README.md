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
