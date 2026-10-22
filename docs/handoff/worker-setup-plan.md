# Payment v2 in production: worker setup plan (W1, PLANNING ONLY)

Branch `track/payment-security` at `4c5744e`, 2026-10-22. No code, migrations, keys or connections were touched in producing
this plan.

**How to read the evidence:**
- **[V]** = verified in code at the cited `file:line`.
- **[A]** = an assumption or an external fact not checked here. Every [A] must be checked before the step that depends on it.

Production state this plan starts from (recorded in `payment-security.md`):
- Migrations 059-079 are applied. 080 is staged with a runbook and not yet applied.
- No `payment_v2.networks` row exists, and funding is off.
- No worker login exists in production.

---

## 0. Summary

1. **Nothing runs the workers today.**
   - The five worker roles and their RPCs exist in the database [V]. A typed per-role transport exists:
     `lib/db/payment-postgres.ts:11-35` (RPC→role map) and `:39-44` (refuses privileged logins).
   - The only callers are the test harnesses in `tests/payment-integration/*.mjs` [V].
   - No route, cron or process in the app calls `reconcilePayments`, `claimPaymentOperations`, `claimPaymentOutbox`,
     `preparePaymentSale` or `authorizePaymentAttempt`. They are only re-exported (`lib/api/contract.ts:4815`, `:4831`) [V].
2. **No v2 checkout path exists.**
   - The legacy quote and build routes return 503 (`app/api/solana/quote/route.ts:9`,
     `app/api/solana/build-tx/route.ts:9`) [V].
   - Nothing builds, or has the issuer co-sign, a `buy_sale` transaction. `buy_sale` requires the issuer as a signer
     (`solana/programs/flexsoar-settlement/src/lib.rs:374`) [V].
   - The issuer is therefore an **online, synchronous** signer in the purchase hot path.
3. **The DB funding gate needs 4 distinct people.**
   - `payment_v2.funding_configuration` (`060_payment_v2_contracts.sql:19-27`) requires exactly one active staff key per
     operational role, 3 governors who are distinct persons, 10 distinct staff keys, and an issuer key that is not a staff key.
     It also requires **4 distinct persons across receiver/authenticator/reviewer/release** [V].
   - Authorization refuses without it (`060:164`) [V]. A solo founder cannot satisfy this honestly.
   - **This is the first decision (D1).**
4. **Recommendation:**
   - Run the five workers on **one small dedicated Linux host**, outside Vercel, as separate OS users or containers. Each
     holds only its own DB password and signing key.
   - Keep the Vercel web app free of every worker credential.
   - The current transport shells out to `psql` (`payment-postgres.ts:4,55`) [V], which a Vercel Function does not ship [A].
5. **Kill switch:** the on-chain **guardian** key can pause funding with a single signature (`emergency_pause`,
   `lib.rs:69-72`) [V]. Keep it as the hot pause key. Everything else is cold or multi-person.

---

## 1. Inventory

### 1.1 Database roles

All six are created NOLOGIN NOINHERIT, non-superuser, NOBYPASSRLS (`059_payment_v2_records.sql:35-40`) [V]. A worker
connects as a dedicated LOGIN that is a member of exactly one role.

- **How the role is enforced:** the transport does `SET LOCAL ROLE <role>` per transaction (`payment-postgres.ts:50`) [V].
- **What the database checks:** `payment_v2.require_role` checks `session_user` membership. It refuses a login that holds
  more than one worker role, or any membership in owner, service_role, authenticator, authenticated or anon (live body; same
  rule in `payment-security.md`, "Permissions / deployment prerequisites") [V].

| Role | What it does | RPCs it may execute [V] | Triggered by | Secrets it needs |
|---|---|---|---|---|
| `payment_v2_owner` | Owns every payment object and SECURITY DEFINER function. **Never a login; never granted to a worker.** | n/a (owner) | Migrations only | none (the migration admin is `postgres`) |
| `payment_v2_issuer` | Prepares a sale (immutable terms), authorizes an attempt (permit bytes), reads the issuer context, and co-signs `open_sale`, `revoke_sale` and `buy_sale` | `fn_payment_v2_prepare_sale`, `fn_payment_v2_authorize_attempt` (`063:181`); `fn_payment_v2_issuer_context` (`068:233`) | A listing goes v2 (prepare); a buyer starts checkout (authorize + co-sign). **Synchronous** with the buyer. | DB login password; **on-chain issuer key** (`ConfigV2.roles.issuer`, `lib.rs:259,360,367,374`); RPC endpoint |
| `payment_v2_verifier` | Observes finalized chain state and stores retained evidence (068/069). Records verified events, attestations, lifecycle and operation failures. Runs scans. | `begin_scan`, `finish_scan`, `recovery_binding`, `record_verified_event`, `record_attestation`, `record_lifecycle`, `record_operation_failure` (`063:182`); `verifier_context`, `store_chain_evidence`, `read_chain_evidence` (`068:234`); `attempt_context` (`069:87`) | Schedule (scan cadence, §6) | DB login; RPC endpoint(s) (primary + archive); **no signing key** |
| `payment_v2_settler` | Consumes verified events into orders, journal and ownership, and provides the acknowledgement context | `fn_payment_v2_reconcile_event` (`063:183`); `fn_payment_v2_ack_context` (`068:235`) | After the verifier records an event | DB login only |
| `payment_v2_executor` | Leases operations, builds and stages the signed exit transaction (`execute_outcome`), and records the send outcome | `claim_operations`, `finish_operation`, `operation_context`, `signed_operation`, `stage_signed_operation` (`063:184`) | Schedule; after a release or refund decision | DB login; **fee-payer key** (`execute_outcome` needs no role signer, `lib.rs:187-209,394-399`); RPC |
| `payment_v2_notifier` | Leases outbox rows (written by settlement, `061:95`) and delivers notifications | `claim_outbox`, `finish_outbox` (`063:185`) | Schedule | DB login; email API key (Resend today, `lib/email/send.ts:3`) |
| `authenticated` (web users, not a worker) | Buyer and seller and admin RPCs | `initiate`, `own_attempts`, `attach_candidate`, `record_decision`, `approve_refund`, `admin_queue`, `admin_obligations`, `list_card`, `request_cancel`, `redeem_card`, `review_dispatch` (`063:186`) | Web app session | Supabase anon key + user JWT |

Plus `fn_payment_v2_worker_identity` (granted to all five, `063:189`) and the PUBLIC fence helpers (`063:187`).

**Staff decisions are not a worker.**
- Receipt, authentication, review, release, refund and dispute are recorded in the DB by a **signed-in staff user**
  (`fn_payment_v2_record_decision`, `authenticated`).
- They are also signed **on chain** by that staff role's key: `record_receipt`, `record_authentication`, `authorize_release`,
  `review_authentication` and `dispute_hold` take 1 signer; `authorize_refund` and `resolve_dispute` take 2 (`lib.rs:135-185`,
  `lib/solana/v2-sdk.ts:32-43`) [V].
- The verifier then records the finalized attestation.

**`payment_integration_*` logins.**
- Created only by `tests/payment-integration/00_worker_logins.sql:5-14`, which refuses any database other than the isolated
  `flexsoar_payment_v2_test` that holds the 37-checkpoint acceptance record [V].
- They are **test principals**. They must never exist in production. Production logins get new names (§4).

### 1.2 Routes and crons mapped to roles

| Route | What it does now [V] | Role / credential | Verdict |
|---|---|---|---|
| `GET /api/solana/quote`, `GET /api/solana/build-tx` | 503 `FUNDING_DISABLED` (`quote/route.ts:9`, `build-tx/route.ts:9`) | user session | Inert. Replace with the v2 checkout endpoint (M3). |
| `GET /api/solana/attempts` | Own attempts via session RPC (`attempts/route.ts:10`) | `authenticated` | Correct. |
| `POST /api/solana/settle` | v2: `attachPaymentCandidate` on the session (`settle/route.ts:30`). Legacy branch: **reads `orders` with `createServiceSupabase()`** (`:51-58`) and always ends in "authoritative purchase authorization unavailable" (`:63-68`) | `authenticated`; **service role** (read) | v2 branch correct. **Remove the legacy branch** (shared credential). |
| `POST /api/internal/solana/reconcile` | Bearer `PAYMENT_RECONCILE_SECRET`, then always 503; refuses to fall back to service_role (`reconcile/route.ts:4-8`) | none | Inert by design. Delete it once workers run on the host (M8); keeping a public URL that can never work has no value. |
| `GET/POST /api/solana/link-wallet` | Verifies a signed message, then **writes `users.solana_address` with `createServiceSupabase()`** (`link-wallet/route.ts:72-75`) | **service role** (write) | Not a payment worker, but it is a shared-credential write that feeds payment identity (wallet → `wallet_accounts`). Move it to a SECURITY DEFINER RPC (track/data). |
| `GET /api/solana/balances`, `GET /api/fx` | Reads | session / public | Fine. |
| `GET /api/cron/process-payouts` | Bearer `CRON_SECRET`; `processAllDuePayouts` → every order ineligible (`contract.ts:4407-4422`), and `executePayout` always throws (`:4427-4434`); reads via **service role** (`:4408,:4428`) | **service role** (read) | Inert and **not scheduled** (`vercel.json` has no `crons`). Remove it. |
| `GET /api/cron/sync-comps` | eBay comps; Bearer `CRON_SECRET` | none payment | Unrelated to payments; also unscheduled. |
| `POST /api/webhooks/stripe` | Verifies the Stripe signature, then returns **503** for handled events (`stripe/route.ts:555-558`) | none (legacy handlers use service role, `:404`) | 503 makes Stripe retry for days [A]. **Disable the endpoint in the Stripe dashboard, then delete the route.** |
| `POST /api/webhooks/stripe-connect` | **Live:** updates `users.stripe_connect_payouts_enabled` with **service role** (`stripe-connect/route.ts:67,93`) | **service role** (write) | Remove it together with Connect (below). |
| `POST /api/consignor/connect` | **Live** if `STRIPE_SECRET_KEY` is set: creates Stripe Connect accounts (`contract.ts:4298`, `:4330`); flips `is_consignor` with **service role** first (`:4267`) | **service role** (write) | **Not inert.** Payout is USDC-only (founder decision), so remove the route and its UI (`app/(market)/consignor/connect/*`). |

---

## 2. Hosting the workers

| | (A) Vercel Functions + Cron | (B) One small dedicated host (VM/container) | (C) Supabase-side (pg_cron + Edge Functions) |
|---|---|---|---|
| Runs the current transport | **No:** it spawns `psql` (`payment-postgres.ts:4,55`); Functions do not ship it [A]. Needs a `pg`-driver transport (a DEPS request + track/data rewrite). | **Yes**, unchanged | **No:** pg_cron jobs run as their owner (`postgres`), which breaks `session_user` separation; Edge Functions cannot spawn `psql` [A] |
| Least privilege | One project's env holds every worker secret, unless split into separate projects | Separate OS users, or one container per role, each with only its own secret | DB-side jobs run privileged; worst |
| Secret isolation per role | Weak (env is per project and environment, not per function [A]) | Strong (file permissions per OS user, or a per-container secret) | Weak |
| Cron/queue reliability | Cron frequency is plan-dependent [A]. Each run is stateless, which suits the lease-based RPCs. No always-on process. | systemd timers or one supervisor loop per role. Restart-on-failure. Needs its own uptime check. | pg_cron is reliable, but its privilege model is wrong |
| Issuer co-sign (synchronous) | Natural: an internal function the checkout calls. But the issuer key would then live in Vercel env. | The host exposes one authenticated internal endpoint (HMAC or mTLS) for the issuer only | Possible, with the same key-placement concerns |
| Cost | Included in the existing plan [A] | Smallest VM/container tier [A] | Included |
| Solo-founder ops burden | Lowest | Moderate: patching, uptime check, backups of config (no state; the DB holds state) | Low, but wrong model |

**Recommendation: (B)**, one small host running five processes. Each process is its own OS user, holds one DB password and at
most one key file or KMS reference, and runs a supervised loop. The web app on Vercel keeps **zero** worker credentials.
- **Issuer:** runs on the same host behind one internal endpoint. The web app calls it with a narrow HMAC credential that can
  only ask "authorize attempt X". That credential is useless on its own, because the issuer re-derives everything from the DB
  (`authorize_attempt`) and only signs a `buy_sale` that matches the stored permit.
- **What (B) rules out:**
  - Vercel Cron as the payment trigger.
  - Any `createServiceSupabase()` use for payment state.
  - Worker secrets in Vercel env.
  - Running workers inside Supabase.
- **Alternative if (B)'s ops burden is unacceptable:** (A) with a `pg`-driver transport and **two** extra Vercel projects. One
  is the issuer (hot path); the other holds verifier, settler, executor and notifier, which accepts weaker isolation among
  those four. This needs a DEPS change and a transport rewrite, and is not recommended.

---

## 3. Signer and key custody

**On-chain authorities** (`lib.rs:259`, `Roles`). All 11 keys must be pairwise distinct (`Roles::validate`, `lib.rs:261-264`)
[V]. In the table, release/receiver/authenticator/reviewer are grouped into one row.

| Key | Signs | Blast radius if leaked [V where cited] | Recommended custody |
|---|---|---|---|
| **Program upgrade authority** (bootstrap) | Program upgrades; `initialize_v2` (`lib.rs:17-20,333`) | **Total**: a new program can move every escrow | Squads multisig (2-of-3, distinct people and devices), or make the program immutable after audit. Never on a server. |
| **Governance ×3** (or a governance vault, `lib.rs:55-60,220-226`) | `configure`, `set_pause`, `rotate_governance`, `update_future_terms` (2-of-3); `authorize_refund` and `resolve_dispute` (2 signers, `lib.rs:165-185,386-389`) | One key alone: nothing (2-of-3). Two keys: re-role every authority, change the treasury for future sales, refund or resolve any escrow. | Hardware wallets held by 3 distinct people, or a Squads vault installed via `install_governance_vault`. Never on the worker host. |
| **Issuer** | `open_sale`, `revoke_sale`, co-signs `buy_sale` (`lib.rs:360,367,374`) | Can open sales of **registered** cards at terms it chooses, capped by `max_trade` (`lib.rs:111`). Cannot redirect payouts: seller = card owner and seller ATA are bound at `open_sale` (`:88,93`). Cannot spend buyer funds (buyer must sign, `:118`). Real risk: under-priced sales of others' cards. | **KMS-backed or Privy server wallet** with a signing policy restricted to this program. If not available, a key file readable only by the issuer OS user. Online by necessity. |
| **Inventory + Authenticator** | `register_card` needs both (`lib.rs:349-350`); authenticator also `record_authentication` | Both together: register a fake card with any owner. One alone cannot register. | Staff hardware or Privy wallets, per person; offline. |
| **Receiver / Reviewer / Release / Authenticator** | Single-signer attestations (`lib.rs:135-163`) | One key cannot release alone: release requires received + authenticated, and the releaser must differ from receiver, authenticator, reviewer and issuer (`lib.rs:148-155`). | Per-person hardware or Privy wallet, used from the admin UI. Not on the worker host. |
| **Reconciler** | `acknowledge_claim` (`lib.rs:210-216,404`) | Can mark a resolved sale's card resolved early (only states 3/4/5, `:212`). Cannot move funds. | Worker-host key file or KMS (it is automated) |
| **Guardian** | `emergency_pause` (`lib.rs:69-72`) | Can only **pause** (funding, optionally outflow). Denial of service only. | Two copies: founder hardware wallet + a hot copy for the kill-switch runbook |
| **Executor fee payer** | Pays fees for `execute_outcome` (no role check) | SOL in the payer only | Hot key on the host, with a small SOL float and an alert |
| **Treasury** | Receives fees (`lib.rs:93,140-141`) | Fee balance | Squads multisig or hardware; never the host |
| **DB passwords (×5)** | n/a | Only that role's RPCs (§1.1). Bounded by the on-chain checks. | Per-OS-user secret file (0600), rotated quarterly |

**Options compared:**
- **Env secret / key file:** simplest. Leaks with the host.
- **Cloud KMS/HSM:** Ed25519 support varies by provider [A]. Strong, but more setup.
- **Privy server wallets:** policy-restricted signing with no raw key on the host [A: verify Solana policy support and pricing].
- **Multisig (Squads)** for upgrade, governance and treasury: standard and auditable.

**Recommendation:**
- Squads for upgrade authority, governance and treasury.
- Hardware wallets, one per person, for staff roles.
- A Privy server wallet (or KMS) for the issuer and reconciler. Fall back to OS-user-scoped key files only if those are
  unavailable.
- A hot guardian copy for the pause.

**Rotation and revocation.**
- **Operational role keys:** governance `configure` replaces `Roles`. It requires funding paused (`lib.rs:32-41`) and bumps
  `epoch`, which invalidates outstanding permits because `p.authority_epoch == c.epoch` (`:114`) [V].
- **Then in the DB:** update `payment_v2.networks.issuer` and `authority_epoch` and the `payment_v2.staff` rows to match. This
  is a reviewed SQL step by the founder.
- **Governance:** `rotate_governance` (2-of-3, paused, `lib.rs:47-52`).
- **DB password:** `ALTER ROLE … PASSWORD`, then restart that process.

---

## 4. DB logins (the founder runs these later, as a reviewed runbook; not now)

**Names:** `flexsoar_worker_issuer`, `…_verifier`, `…_settler`, `…_executor`, `…_notifier`.
- They must **not** start with `payment_v2_`, which the transport refuses (`payment-postgres.ts:41`) [V].
- They must not reuse `payment_integration_*` or `payment_db_test_*`.

Per login, in one transaction as `postgres`, following the pattern in `tests/payment-integration/00_worker_logins.sql:10-12`
and `tests/payment-db/35_workers_setup.sql:20-21`:
```
CREATE ROLE flexsoar_worker_<r> LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<generated>';
GRANT payment_v2_<r> TO flexsoar_worker_<r>;
ALTER ROLE flexsoar_worker_<r> SET statement_timeout = '30s';
```
- **Password handling:** generate 32+ random bytes on the founder's machine. Enter them over an interactive psql `\password`,
  not in a file that gets committed or logged. Store each only on the host, for its OS user.
- **Passing it in:** the transport passes it via `PGPASSWORD` and ignores pass files (`payment-postgres.ts:43-44`) [V].
- **TLS:** `sslMode: 'verify-full'` is enforced off-loopback (`:42`). The transport does **not** set `PGSSLROOTCERT`, so
  verify-full needs the Supabase CA installed where libpq finds it for that OS user [A]. Verify with a single
  `worker_identity` call.

**Pooler mode:**
- Use the **session pooler** (port 5432, user `flexsoar_worker_<r>.<project-ref>`).
- On staging, that pooler kept `session_user` equal to the base user (`postgres`), checked by the staging guard every session
  (`payment-security.md`, "Staging rehearsal, Method") [V for `postgres`; **A** for custom logins].
- Each RPC is one short `BEGIN … SET LOCAL ROLE … COMMIT` (`payment-postgres.ts:50`), so transaction mode (6543) should also
  work [A].
- Prefer session mode until a custom login's `session_user` is proven under both.

**Verify grants, mirroring tests 36-40** (read-only, one session per login):
1. `SELECT fn_payment_v2_worker_identity('payment_v2_<r>')`. It must return `{login, role, superuser:false}`. The transport
   also asserts this (`payment-postgres.ts:59`).
2. As `postgres`, a matrix: `has_function_privilege('flexsoar_worker_<r>', <each fn_payment_v2_*>, 'EXECUTE')`. True exactly
   for that role's functions in §1.1, plus `worker_identity` and the PUBLIC helpers.
3. Also as `postgres`: `pg_has_role(login, <each other payment_v2_* / owner / service_role / authenticator / authenticated /
   anon>, 'MEMBER')` = false.
4. Each login is refused, read-only, on another role's function (`permission denied`), on `UPDATE public.users`, and on
   `INSERT INTO payment_v2.events`. Tests 36-40 assert the same (e.g. `36_worker_issuer.sql:10-15`,
   `37_worker_verifier.sql:10-15`, `38_worker_settler.sql:10-16`).

---

## 5. Mainnet readiness gaps

| # | Gap | Evidence | Fix (owner) |
|---|---|---|---|
| G1 | Funding destination hard-coded to mainnet | `lib/solana/privy.ts:109-110` (`FUNDING_CHAIN`, `FUNDING_USDC_MINT`) [V]; trading chain from `NEXT_PUBLIC_SOLANA_CHAIN` (`:29`) and server `SOLANA_CLUSTER` (`config.ts:15,28`) | Derive both from one cluster setting. Refuse to render funding when chain ≠ cluster (track/market + data). |
| G2 | No runtime consistency check of cluster, mint, program and Privy chain | Noted as backlog in `payment-security.md` (pre-merge review); none exists in code [V] | Each worker, at start: RPC genesis hash == `networks.genesis`; config PDA account mint == `networks.mint` == `SOLANA_USDC_MINT`; program id == `networks.program`; on-chain `epoch` == `networks.authority_epoch`. Refuse to run on mismatch. Web app: `NEXT_PUBLIC_SOLANA_CHAIN` must match the same genesis. (agent) |
| G3 | `networks` row contents for mainnet | Columns: `059:49-56` [V] | `genesis` = mainnet genesis hash [A: `5eykt4Us…`, full hash from RPC `getGenesisHash`]; `program` = deployed id; `config` = PDA `config-v2` (`v2-sdk.ts:8`); `mint` = USDC `EPjF…Dt1v` (`config.ts:16`); `token_program` = SPL Token; `treasury`; `treasury_token` = treasury ATA; `issuer`; `authority_epoch` = on-chain epoch; `policy_version` `MY-USDC-ESCROW-1` (`059:48`); **`funding_enabled=false`**; small caps. (founder SQL) |
| G4 | Flip order | App gate: `FUNDING_AVAILABLE = false` constant, no env override (`lib/db/payment-v2.ts:62`), used by the UI (`components/market/FundingOptions.tsx:52`). DB gate: `funding_enabled` (`060:109,142,164`). Chain gate: `funding_paused` (`lib.rs:81,111`). | **Enable:** (1) chain `configure` caps, then `set_pause(false)` (2-of-3; it requires caps > 0, `lib.rs:42-45`). (2) DB `funding_enabled=true` with `funding_configuration` satisfied. (3) Deploy the app with `FUNDING_AVAILABLE=true`. Each earlier step is harmless without the next: no permit without the DB gate, no `buy_sale` without the chain gate. **Disable:** reverse order, fastest first (§6). |
| G5 | CSP wildcards | `frame-src … https:` and `connect-src … https: wss:` (`next.config.ts:32-33`) [V] | After choosing the on-ramp, enumerate its hosts (Privy, the chosen RPC, Supabase) and drop the bare `https:`/`wss:`. (design or admin lane; the founder decides the timing) |
| G6 | Upload size is not enforced at storage | 8 MB check on the **declared** `sizeBytes` (`app/(market)/list/actions.ts:67,88`); presigned `PutObjectCommand` without `ContentLength` (`lib/r2/sign.ts:148-156`) [V], so the client can PUT more | Sign `ContentLength` into the PUT (the client must then send exactly that), or switch to presigned POST with `content-length-range` [A: R2 support]. (track/data) |
| G7 | Legacy routes | §1.2 | Remove `webhooks/stripe` (after disabling it in Stripe), `webhooks/stripe-connect`, `cron/process-payouts`, `consignor/connect` + its pages, and the legacy branch of `solana/settle`. Remove `internal/solana/reconcile` at M8. (track/data + market) |
| G8 | No v2 checkout | §0.2 | New endpoint: session `initiate` → issuer `authorize_attempt` → issuer co-signs `buy_sale` → the buyer signs and sends → `settle` v2 attaches the candidate. Plus UI. (agent; the issuer service is on the host) |
| G9 | No worker runtime | §0.1 | Five supervised loops over the existing `lib/db/payment-v2-workers.ts` functions, plus a `reconcilePayments` driver (`lib/db/payment-reconciliation.ts:16`). (agent) |
| G10 | `link-wallet` writes with the service role | `link-wallet/route.ts:72` | A SECURITY DEFINER RPC (track/data, human SQL) |

---

## 6. Observability and incident response

**Log** (structured, per worker, no secrets; the transport already avoids passwords in argv, `payment-postgres.ts:53-56`):
- worker role and login;
- RPC name, outcome and latency;
- lease id;
- sale, attempt and operation ids;
- signatures observed;
- the `PAYMENT_DB_OUTCOME_UNKNOWN` path (`payment-postgres.ts:63-66`). That path means the RPC may have committed: recover,
  never retry blindly.

**Alert on:**
- any worker silent for longer than 2× its cadence (heartbeat);
- `OUTCOME_UNKNOWN`;
- a scan lease older than its timeout;
- outbox or operations with attempts > N;
- the executor fee-payer SOL below its floor;
- `funding_configuration` false while `funding_enabled` is true;
- an escrow past its policy deadline (dispatch 172 800 s, authentication 2 business days, etc., `059:48`);
- a daily invariant mismatch (below).

**Cadence:**
- Verifier scan every 60 s.
- Settler immediately after each verifier batch.
- Executor every 60 s.
- Notifier every 60 s.
- **Daily invariants:** on-chain `config.outstanding` == the DB sum of open escrow totals; zero unconsumed finalized events
  older than 10 minutes; and every `verified_chain_evidence` row re-checkable through `read_chain_evidence`.

**Kill switch (fastest first):**
1. **Guardian `emergency_pause(outflow=false)`**: one signature, seconds (`lib.rs:69-72`).
   - New `open_sale` and `buy_sale` fail (`:81,111`).
   - **Funded escrows continue:** attestations, release, refund, `execute_outcome` and acknowledge are not gated by
     `funding_paused`.
   - Use `outflow=true` only for suspected compromise. It also stops `execute_outcome` (`execution_allowed`, `lib.rs:190,282`).
2. **DB:** `UPDATE payment_v2.networks SET funding_enabled=false` (owner SQL). `authorize_attempt` refuses from then on
   (`060:164`).
3. **App:** deploy `FUNDING_AVAILABLE=false`, which hides funding UI.

**In-flight attempts during a pause:**
- An attempt authorized but not yet bought cannot be bought (chain gate). The buyer is not charged, and the permit expires
  (`valid_seconds`).
- An attempt already bought is a funded escrow and proceeds normally.

**Unpausing** needs `set_pause` (2-of-3 governance, `lib.rs:42-46`), deliberately harder than pausing.

**Stuck escrow:**
- `fn_payment_v2_admin_obligations` and `admin_queue` show it (`app/admin/payments/page.tsx:9`).
- **Missing dispatch evidence or authentication past the deadline:** the staff decision path, then `authorize_refund`
  (2 governance signers) → the executor's `execute_outcome` refund to the buyer's bound ATA (`lib.rs:203-205`).
- **A destination ATA that was closed:** `recreateBoundAta` (`v2-sdk.ts:56-64`) recreates the same address; it never
  retargets.
- **Never** move escrow funds outside the program.

---

## 6b. Seller-signed listing: UI and issuer requirements (R1-04; added with P1b)

The program (P1) refuses any sale whose total is below a floor the card owner signed, but nothing in the app yet connects a seller's
wallet to that signature. The builders exist (`lib/solana/listing-v2.ts`); the trust boundary below is what the worker and UI
milestone (M3, rehearsed at M5) must implement and an independent reviewer must sign off before anyone claims "an issuer leak cannot
under-price". A correct builder alone does not establish it.

**Seller UI (the signing flow)**
1. **Derive, never accept.** The UI computes the floor and expiry itself from data it can check: the listing price in MYR, the FX quote
   it shows the seller, and the fixed 2% tolerance (`listingFloor`, rounded up). It must NOT sign bytes handed to it by the issuer or
   by any API response. The 61 message bytes are built in the browser from (domain, program, card, sale id, generation, floor,
   expiry) with `encodeListing`.
2. **Display independently.** Before the wallet prompt the seller sees, in plain text derived from those same values: the price they
   asked for, the minimum they will accept in USDC (and its MYR equivalent at the displayed rate), and the date the listing lapses. The
   display and the signed bytes come from one object, so they cannot diverge. The sale id, card and network are shown as identifiers.
3. **Verify what comes back.** The signature returned by the wallet is checked with `verifyListingSignature` against the exact bytes
   the UI built and the seller's registered wallet, before it leaves the browser. A wallet that wraps or prefixes the message fails
   this check; that is the stop condition in the Privy proof plan (`docs/handoff/solana-p1b.md`).
4. **Persist immutably.** The signed message and signature go to the database through `fn_payment_v2_record_listing` (083), which
   recomputes the binding from the sale row and bounds the floor to the quote. The row is immutable. A changed price is a new sale id
   and a new signature, never an edit.

**Issuer submission**
5. **Pair or nothing.** The issuer submits only `openSaleWithListing(open, listing, signature)`: the Ed25519 instruction and
   `open_sale`, in that order, fee-paid by the issuer. The bare `openSaleInstructionFromContext` output is never submitted alone (the
   program would refuse it with error 6007). The worker reads the stored listing with `fn_payment_v2_listing_for_open` and refuses to
   build an open transaction when none is stored.
6. **No substitution.** The worker must re-derive the binding from its own sale row and compare it to the stored message before
   submitting, so a corrupted store cannot open a sale on a card the seller did not sign for.
7. **Gate before funding.** `checkFundingGate(rpc, pinnedDeployment, rawGovernanceModeRows)` (`lib/solana/v2-funding-gate.ts`) runs before any
   funding-enable approval and its decision must be `ok === true`. The adapter hands it the RAW `governance_mode` projection (exactly
   three fields: `operational_separation`, `governors_required`, `release_delay_seconds`, in seconds); the gate validates it and refuses
   anything malformed. The pinned deployment (genesis hash and program id) comes from the reviewed manifest, never from the RPC being
   asked; the gate derives the config address itself. The returned `target` (genesis, program, config, slot) is the identity the
   funding-enable action must act on, promptly, re-running the gate if governance changes in between. Treat any exception as a refusal.

**Review checklist for this milestone:** the UI test shows the signed bytes equal the displayed numbers for a table of prices and
rates; an issuer-supplied message is refused by the UI; a wallet that changes the bytes is detected; the worker has no code path that
submits `open_sale` without the pair.

## 7. Milestones to first real purchase

| # | Milestone | Exit test | Who |
|---|---|---|---|
| M0 | 059-079 in prod, funding off | done | — |
| M1 | Apply 080 | `prod-runbook-080` Steps 0-5 all as expected | founder |
| M2 | Decide people, policy and custody (D1-D5) | written decisions | founder |
| M3 | Build the worker runtime (G9), v2 checkout + issuer service (G8), the runtime consistency check (G2), the G1 fix, and legacy route removal (G7) | `npm test` + build; `tests/payment-integration` harness passes on localnet with the new runtime unattended | agent |
| M4 | Upload size (G6), link-wallet RPC (G10) | Unit tests; the staging RPC grant check | agent + human SQL |
| M5 | **Devnet end to end:** deploy the program to devnet, `initialize_v2` with devnet keys, staging DB + devnet `networks` row, workers on the host | Unattended: purchase → receipt → authentication → release → `execute_outcome` → acknowledge; also refund and pause drills. Alerts fire in an induced failure. | agent (build) + founder (keys/host) |
| M6 | External review of the program and key ceremony plan | Review sign-off | founder |
| M7 | **Mainnet program:** deploy, upgrade authority → Squads, `initialize_v2` (starts paused, `lib.rs:26`), `configure` roles + tiny caps | On-chain config read-back equals the plan | founder |
| M8 | **Prod DB + host:** worker logins (§4), `networks` row with `funding_enabled=false`, staff rows, workers running with funding off | §4 grant matrix; `worker_identity` per login; G2 check passes; 7 days of clean heartbeats; a guardian pause drill while already paused | founder (SQL, host) + agent (runbook) |
| M9 | **Canary:** a tiny `max_trade`; founder-controlled buyer and seller accounts; full lifecycle with real USDC | DB and chain invariants hold; refund path tested; kill switch tested | founder |
| M10 | **First real purchase:** raise caps modestly, flip per G4, deploy `FUNDING_AVAILABLE=true` | The first external purchase reconciles end to end | founder |

M3 builds, and M5 rehearses on devnet, the seller-listing flow and issuer submission rules in section 6b (R1-04); M6's reviewer signs off section 6b explicitly. M5 also runs `init-v2.mjs` (dry run, then real) and the pre-funding gate, per `docs/handoff/solana-p1b.md`.

---

## Decisions for the founder (with recommendation)

1. **People for separation of duties.** The DB gate needs 4 distinct persons for receiver/authenticator/reviewer/release and
   3 distinct governors (`060:19-27`); the chain needs 11 distinct keys (`lib.rs:261-264`).
   - *Recommend:* name the real people (they may overlap between the governor and operational sets) before M5.
   - Do **not** satisfy `person_id` with fictitious values.
   - If 4 people are not available, decide whether a reviewed forward migration should relax the rule, and accept that
     explicitly.
2. **Worker hosting.** *Recommend:* one small dedicated host, five OS users (§2). Rules out Vercel Cron and Supabase-side
   workers for payments.
3. **Issuer custody.** *Recommend:* a Privy server wallet with a program-restricted policy, or KMS. Fallback: a key file
   scoped to an OS user.
4. **Upgrade authority, governance and treasury.** *Recommend:* a Squads multisig (2-of-3, distinct people and devices) for
   all three. Decide whether to make the program immutable after audit.
5. **Staff keys.** *Recommend:* one hardware wallet per person per role, used from the admin UI. Never on the host.
6. **Guardian.** *Recommend:* founder hardware wallet plus one hot copy reserved for the kill-switch runbook.
7. **Stripe removal.** *Recommend:* disable both Stripe webhooks in the Stripe dashboard. Then delete `webhooks/stripe`,
   `webhooks/stripe-connect`, `cron/process-payouts` and `consignor/connect` (and its pages) in one agent task.
8. **`FUNDING_AVAILABLE`.** *Recommend:* keep it a code constant (the flip is a reviewed deploy). Optionally also read
   `networks.funding_enabled` so the UI cannot advertise funding the DB refuses.
9. **Canary limits.** *Recommend:* `max_trade` = the smallest price you would list, and `max_escrow` = 3× that, for M9-M10.
   Raise only after a week of clean invariants.
10. **CSP tightening timing.** *Recommend:* before M10, once the on-ramp provider list is fixed.
11. **Pooler mode for workers.** *Recommend:* session pooler, until a custom login's `session_user` is proven under
    transaction mode.

## Not verified here

- That Vercel Functions cannot ship `psql`.
- Vercel Cron limits and pricing, Privy server-wallet Solana policies, KMS Ed25519 support, and R2 support for
  presigned-POST size conditions.
- Supavisor `session_user` behaviour for custom logins.
- How Stripe retries the 503 webhook.
- Production values: the mainnet genesis hash, the program id, the treasury.

All are marked [A] above and must be checked at the milestone that needs them.
