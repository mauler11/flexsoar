# Payment v2: build plan from today to the first real canary purchase (W2-PLAN, PLANNING ONLY)

Branch `track/payment-security`, 2026-10-23. Pre-flight run: branch correct, `git log HEAD..main` empty. **No code, migration, key,
connection or network call was made to produce this plan.** It supersedes the milestone table in `worker-setup-plan.md` section 7
(M3-M10) where they differ; everything else in W1 stands.

**Evidence tags.** **[V]** = verified by me in code or docs at the cited place. **[A]** = assumption or external fact not checked; it
must be checked by the phase named next to it. **UNCERTAIN** = a design point I could not resolve from the repo.

**What I read in full:** `worker-setup-plan.md`, `solo-operator-design.md`, `solana-p1b/p1c/d3/d4.md` (d2 partly: status, unverified),
`privy-sign-proof.md`, migration 083, and `payment-security.md` from the 082 section to the end. **What I only searched:** the rest of
`payment-security.md` (520 KB), `data.md`, `market.md`, `admin.md`, `design.md`. If a decision recorded only in those files contradicts
this plan, the file wins.

Founder decisions taken as given: solo operator plus a friend as second governor; Squads 2-of-3 governance (no time lock) and a
separate 2-of-3 upgrade multisig (24 h time lock); one small dedicated worker host; issuer key in a Privy server wallet or a key file
readable only by the issuer process; funding off until the canary; 24 h release delay; seller floor = MYR price - 2% FX tolerance.
The Privy `signMessage` proof passed on 2026-10-23 per the task prompt. **The repo does not record the result yet**
(`privy-sign-proof.md` holds only the how-to and the PP1 fix), so Phase 0 records it.

---

## 1. Findings that change the plan

These are gaps I confirmed while reading. Each one adds work that W1 did not list.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | **Nothing writes `payment_v2.wallet_accounts`.** Only test fixtures insert into it. `prepare_sale` needs a row for the seller (MY, `users.solana_address` equal to the enrolled wallet); the attempt trigger needs one for the buyer. | grep: inserts only in `tests/payment-db/01_fixtures.sql`, `50_races_setup.sql`, `tests/payment-integration/*`. Readers: 060 `prepare_sale`, 066 `initiate`, 063 attempt trigger. [V] | A new writer is required (Phase 1, "seller USDC wallet enrollment"). |
| F2 | **Nothing writes `payment_v2.inventory` either** (card enrollment: card/pair commitments, custody mode, two staff). `prepare_sale` refuses a card with no row. | No insert in any migration; only the `correspondence` trigger (063:44-46; 082 changed its fragment) guards it. [V] | The canary needs a reviewed founder-SQL enrollment plus the on-chain `register_card`. A UI/RPC for it is deferred (decision D2). |
| F3 | **`prepare_sale` requires `networks.funding_enabled = true`** and a passing `funding_configuration`. `record_listing` needs a prepared sale. | 060 `fn_payment_v2_prepare_sale` (060 text; 078 changed only fragments elsewhere) [V]. | No listing can be prepared or signed while DB funding is off. The whole seller flow can only run **inside the canary window**, or on devnet/staging where funding is enabled. This is the single most important ordering fact. |
| F4 | **`fn_payment_v2_record_listing` and `listing_for_open` are granted to the issuer role only.** | 083:169-172 [V]. | The seller's browser cannot persist its signature. The path is browser -> web route -> issuer service (host) -> DB. Web app keeps zero worker credentials (W1). |
| F5 | **Every chain observer refuses anything but loopback HTTP RPC** (`localRpc`), and the scan throws at more than 500 program accounts. | `v2-observer.ts:12-15`, `:84-87`; also used by `v2-evidence.ts:350`, `v2-authority-observer.ts:27`, `v2-operation-observer.ts:12`. [V] | The verifier/settler cannot run against devnet or mainnet today. A network-capable, genesis-pinned, partition-aware observer is a **security-sensitive build**, not wiring (Phase 5). |
| F6 | **The funding gate has no database reader and no caller.** `governance_mode` is owner-only and no function returns its projection. | `v2-funding-gate.ts` is the only file mentioning `governance_mode` outside SQL; no reader in 082/083. D3 ran the gate with hand-typed rows. [V] | A narrow reader plus a runner (Phase 6). |
| F7 | **How `open_sale` reaches the issuer key is not designed.** `prepare_sale` enqueues an `open_sale` operation; operations are leased by the **executor** role; `open_sale` needs the **issuer** signature, and the open transaction must be fee-paid by the issuer. | 060 (`enqueue(s,'open_sale',...)`); W1 section 1.1 table; `solana-p1-upgrade.md` (1,172-byte open tx). **UNCERTAIN** who builds and submits it. | Phase 2 must settle this in a short design reviewed before code (candidate: issuer service leases its own `open_sale` work through a new issuer-granted reader; executor never touches issuer-only operations). |
| F8 | **Browser E2E needs credentials the Devnet exception forbids**, and the staging guard forbids the users E2E needs. §2b: "No Privy, Helius, treasury, Supabase or other real credentials". Staging exception: guard fails unless `auth.users` has zero rows. | `AGENT_RULES.md` 2b, staging exception [V]. | Full browser E2E on staging needs a founder amendment (decision D3). A headless E2E on devnet + the isolated container needs none. |
| F9 | **`integrated.mjs` cannot be the E2E.** It needs a preserved network-none container and pins the old `program.so` hash. | `solana-d3.md` row `integrated.mjs`; P1c section 7 [V]. | Phase 10 writes a new harness. |
| F10 | **The mainnet binary is a new build.** `declare_id!` is compiled in; the devnet program id's keypair is throwaway. Mainnet needs its own program keypair, so a third build (call it C) with a new hash, plus the D2 byte-proof method and a fresh run of the on-chain suite. | `solana-d2.md` (B = A with only `declare_id!` changed: 713 bytes differ) [V]. | Phase 11. |
| F11 | **Production database state.** Applied: 059-078 (founder, 2026-10-21) and 080 (founder, 2026-10-22). 079 is a prerequisite of 080 so it is applied; **081, 081b, 082 are container+staging only; 083 is a draft**. | `payment-security.md` 5851, 6663, 6692, 6749 [V for the records; production not re-checked: the runbook's own preflight must confirm]. | The production pipeline in Phase 7 is 081 -> 081b -> 082 -> 083 -> 084. |
| F12 | **Legacy Stripe/payout surface is already removed** (H1) and `settle` is v2-only. W1 gap G7 is mostly closed. | `payment-security.md` H1 section; `app/api` listing shows no `webhooks/stripe*`, no `cron/process-payouts` [V]. | Not a phase. Phase 5 deletes only `internal/solana/reconcile` once workers run. |
| F13 | **`link-wallet` retains no proof.** It verifies a signed message, writes `users.solana_address` with the service role, and discards the signature. `wallet_accounts.proof_digest` needs a retained proof. | `link-wallet/route.ts:72-75`; `verifyWalletLink` returns only the address [V]. | Enrollment takes a fresh, network-bound proof (Phase 1/3) rather than reusing the link proof. |

---

## 2. The flow being built (one seller, one buyer, one card)

```
enroll    seller & buyer: link wallet (exists) -> sign "enroll on network N" -> issuer service checks proof + ATA on chain -> wallet_accounts row (084)
register  founder: inventory row (owner SQL) + on-chain register_card (inventory + authenticator keys)           [canary: founder-run]
list      seller sets MYR price (exists)
prepare   issuer service: FX -> totalUnits, sale/escrow addresses, quote window -> prepare_sale (needs funding_enabled, F3)
sign      seller browser: derives floor+expiry, DISPLAYS them, builds 61 bytes, Privy signMessage, verifies signature locally
persist   browser -> web route -> issuer service (verifies again) -> record_listing (083)
open      issuer service: [ed25519 listing ix, open_sale], issuer fee-paid and signed -> chain
buy       buyer: initiate -> issuer authorize_attempt -> issuer co-signs buy_sale -> buyer signs+sends -> attach_candidate
observe   verifier (finalized evidence) -> settler (orders, ledger, ownership)
fulfil    staff: receipt -> authentication -> 24 h delay -> release (distinct KEYS, one person) -> executor execute_outcome -> acknowledge
refund    2 governors (DB) + 2 governance signers (Squads vault) -> executor refund
```

---

## 3. Phases

Legend. **IMPL** = implementation agent on `track/payment-security` (task prompt must name its paths and cite any needed exception
in AGENT_RULES §2/§2b; lanes outside this track, e.g. `app/(market)/**`, `components/market/**`, `lib/api/contract.ts`, must be
widened by the task prompt as MW1 was). **REV** = independent review: a fresh session that did not write the code under review,
read-only, findings filed under `flexsoar-reviews\` as R1-R4 were. **FOUNDER** = only you. Size is relative (S/M/L) and UNCERTAIN.

Critical path: 0 -> 1 -> 2 -> (3, 4, 5 in parallel) -> 6 -> 8 -> 9 -> 10 -> 11 -> 12 -> 13 -> 14. Phase 7 runs beside 1-6.

### Phase 0 - Freeze decisions and record the Privy result  (S)
- **Scope.** Take decisions D1-D8 below that block Phase 1. Record the Privy proof result in `privy-sign-proof.md` (copy of the report
  JSON, date, browser, address truncated). Pick the issuer custody mode for devnet.
- **Areas.** `docs/handoff/privy-sign-proof.md`, this plan.
- **Depends on.** Nothing.
- **Exit test.** Decisions written in this file's "Decisions taken" section; proof report stored next to the rehearsal log.
- **Risks.** Deciding custody late stalls Phase 2.
- **Founder-only.** The decisions; the report JSON (you hold it).
- **Agent.** IMPL (docs only).

### Phase 1 - Migration 084 (and any companion): wallet enrollment, seller read view, gate reader  (M)
- **Scope** (all additive, one transaction, same pre/postguard style as 083; no existing function body changes):
  1. `fn_payment_v2_enroll_wallet(user, network, wallet, token_account, proof_digest)` writer for F1. SQL re-checks what SQL can: user is
     MY, `users.solana_address = b58(wallet)`, network exists, unique token account, idempotent, row immutable. SQL **cannot** verify the
     Ed25519 proof or that the ATA exists; the caller does (Phase 2) and the row records `proof_digest`.
  2. `fn_payment_v2_listing_view(listing)` for the authenticated seller: returns only what the signing screen needs about **their own**
     sale (sale id, card and sale commitments, generation, program, genesis, quote total and window, tolerance). Owner-checked in SQL.
  3. `fn_payment_v2_governance_projection()` returning exactly the three fields the gate takes (F6), granted to the verifier role.
  4. Optional: a `listing_for_open`-style reader so the issuer can enumerate sales awaiting `open_sale` (depends on F7's outcome).
- **Role for the enrollment writer: decision D1.** Recommendation: issuer role (it is the only server-side principal that also does
  the chain check); the alternative is a new sixth role, which touches `require_role`, the transport map and every grant matrix.
- **Areas.** `supabase/migrations/084_*.sql`, `tests/payment-db/*` (new suite numbered after 88), `tests/migration-084.test.ts`,
  `lib/db/errors.ts` mapping for new codes. Needs per-task §2 authorization (author forward migration; execute only in the container).
- **Depends on.** Phase 0 (D1). 083 as a base (container only).
- **Exit test.** Container replay 001 -> 084 with 077-style drift reproduction as before; the 83/88 suites unchanged and green; new
  suite refuses: non-MY user, mismatched `solana_address`, duplicate token account, foreign listing view, wrong role. Postguard proves
  no pre-existing function changed.
- **Risks.** Granting a write to the hot issuer role (mitigate: SQL cross-checks above; enrollment allow-list in Phase 2). A 084 bug
  is a forward migration, never an edit of 083/084 once staged.
- **Founder-only.** Authorizing the migration task; later application (Phase 7).
- **Agent.** IMPL author, then **REV** (migration review) before staging.

### Phase 2 - Issuer service and signer abstraction  (L)
- **Scope.** One authenticated internal HTTP service on the worker host, run as the issuer OS user. Endpoints (names UNCERTAIN):
  `enroll-wallet`, `prepare-sale`, `record-listing`, `authorize-attempt` (+ co-signed buy transaction), plus a background `open_sale`
  submitter. Web app calls it with a narrow HMAC credential that carries the **session user id**; the service re-derives everything
  from the database and refuses anything the stored rows do not support (W1 section 2).
  - **Signer interface** `IssuerSigner { publicKey; signTransaction }` with two implementations: key file (0600, issuer OS user)
    and Privy server wallet. The service never sees a raw key in the Privy mode.
  - **`record-listing`** verifies `verifyListingSignature` against the seller's enrolled wallet **and** recomputes the binding from
    its own sale row before calling 083, because SQL cannot (083 header). A mismatch is a hard refusal.
  - **`open_sale` submitter** submits only `openSaleWithListing(open, listing, signature)` (R1-04 item 5) and refuses when
    `listing_for_open` is empty. **No code path may submit a bare `open_sale`** (a test greps for it).
  - **Enrollment** verifies a fresh proof ("enroll on network N", bound to user id, wallet, mint, token account, time), derives the ATA
    itself, reads it from chain (exists, owner = token program, mint = pinned mint, authority = wallet), then calls 084.
  - **Canary allow-list** (D7): refuse enrollment/prepare for user ids not in an operator-set list.
- **F7 design note first** (small, reviewed before the build): who leases and builds `open_sale`, and how the executor is kept away
  from issuer-only operations.
- **Areas.** New top-level area for host code (suggest `workers/issuer/`; the lane for it needs founder naming), reuse `lib/db/payment-v2-workers.ts`
  (`preparePaymentSale`, `authorizePaymentAttempt`, `paymentIssuerContext`), `lib/solana/listing-v2.ts`, `lib/solana/v2-sdk.ts`,
  `lib/solana/v2-context.ts`. The transport shells to `psql` (`payment-postgres.ts:4,55`); decide whether the host installs `psql`
  (simplest, no DEPS change) or a `pg` driver is requested in `DEPS.md`.
- **Depends on.** Phase 1 (RPCs), Phase 0 (custody, D4).
- **Exit test.** Unit tests with fake RPC + fake signer: tampered message, wrong signer, substituted sale, expired listing, floor out
  of tolerance, unenrolled wallet, wrong mint ATA, replayed HMAC, missing allow-list all refuse. Container integration: prepare ->
  record_listing -> listing_for_open -> open tx built (not sent) matches `openSaleWithListing` byte for byte.
- **Risks.** This is the hot-path signer; Privy server-wallet Solana policy support and pricing are **[A]** (do a one-day spike in
  this phase, decision D4). A Privy outage becomes a purchase outage. Rate limiting and replay protection on the HMAC channel.
- **Founder-only.** Provisioning the Privy app secret and server wallet (if chosen); never in the repo.
- **Agent.** IMPL; **REV** (issuer security review) is mandatory before any mainnet use. W1 required this before anyone claims
  "an issuer leak cannot under-price".

### Phase 3 - Seller flows: wallet enrollment screen and listing signing screen  (M)
- **Scope.**
  - **Enrollment UI**: extend `EmbeddedWalletSection` (MW1 detector) with "Enable USDC": link (exists) -> sign the enrollment proof
    (Privy `signMessage`) -> web route -> issuer service. Shows the derived USDC account and whether it exists; a missing ATA is a
    clear stop, not a silent create (a seller must receive).
  - **Signing screen** implementing `worker-setup-plan.md` section 6b exactly: (1) derive floor and expiry **in the browser** from
    the listing price, the FX rate it shows, `FX_TOLERANCE_BPS` and `listingFloor`; never from an API reply; (2) show the asked price,
    the minimum acceptable USDC and its MYR equivalent at the displayed rate, and the lapse date, from the **same object** that is
    encoded; (3) `encodeListing` the 61 bytes, wallet `signMessage`, `verifyListingSignature` before anything leaves the browser;
    (4) POST to the web route, which relays to the issuer service (F4).
  - The screen reads `listing_view` (084) for sale id, commitments and quote; it cross-checks the quote total against its own FX and
    refuses to proceed if the floor's MYR equivalent is below `price x (1 - 2%)` by more than a stated rounding bound.
- **Areas.** `components/market/**`, `app/(market)/card/[id]/**` or a new `app/(market)/list/sign/**`, new `app/api/payments/*` routes
  (web side only; no worker secrets), `lib/solana/privy-wallet-detect.ts` reuse, tests. **Market lane: the prompt must widen it.**
  `FUNDING_AVAILABLE` stays false; this screen is reachable only when the DB says a sale is prepared, which F3 makes impossible
  before funding is enabled, so it is inert in production until the canary. UNCERTAIN: whether to gate the route on the constant too.
- **Depends on.** Phases 1-2 (contract), MW1 (done), Privy proof (passed).
- **Exit test.** The R1-04 checklist (worker-setup-plan section 6b): a table test shows signed bytes equal displayed numbers across
  prices and rates; an issuer-supplied message is refused by the UI; a wallet that changes the bytes is detected; render tests for
  not-ready / no wallet / EVM-only. Then a manual run with the Privy dev app on `localhost` (founder).
- **Risks.** The displayed FX comes from the same app as the quote, so a compromised app could skew both; the seller sees the MYR
  equivalent and can refuse. State this residual in the reviewer brief. Browser and Privy version drift (WebCrypto Ed25519).
- **Founder-only.** The manual wallet-prompt run; a final read of the exact strings the seller sees (legal/UX).
- **Agent.** IMPL (market-lane widened); **REV** with the checklist above.

### Phase 4 - Buyer checkout path  (L)
- **Scope.** W1 gap G8: v2 checkout endpoint (`initiate` -> issuer `authorize_attempt` -> issuer co-signs `buy_sale` -> buyer
  signs and sends -> `attach_candidate`), buy panel, error mapping, polling. Buyer needs an enrolled wallet (F1) and a USDC account.
  The legacy `quote`/`build-tx` 503 routes are replaced.
- **Areas.** `app/api/payments/*`, `app/(market)/**`/`components/market/**` (lane widened), `lib/solana/v2-sdk.ts` (`buildV2Buy`).
  `lib/api/contract.ts` is track/data's; if new exports are needed, file them in `data.md`, do not edit.
- **Depends on.** Phase 2 (authorize + co-sign), Phase 1 (buyer enrollment).
- **Exit test.** Unit tests for each refusal (below floor, expired listing, wrong mint, stale permit epoch); container integration
  that builds a buy transaction the on-chain suite accepts.
- **Risks.** Permit validity window vs wallet-prompt latency; broadcast/blockhash handling; funding must be off in the UI until Phase 14.
- **Founder-only.** None until the E2E.
- **Agent.** IMPL; REV bundled with Phase 3's reviewer if the same session can hold both (they share the issuer boundary).

### Phase 5 - Worker runtime, network-capable observer, runtime consistency check  (L)
- **Scope.** W1 gaps G9 and G2, plus F5:
  - Five supervised loops (verifier, settler, executor, notifier, plus the issuer from Phase 2) over the existing `payment-v2-workers.ts`
    and `reconcilePayments`. Heartbeat, structured logs, `OUTCOME_UNKNOWN` handling, alerts (W1 section 6).
  - **Network-capable observer.** Replace the loopback-only constraint with an explicit HTTPS allow-list (primary + archive), genesis
    pinned and re-checked on **every** call (the devnet guard's rule), no redirects, and a partitioned `getProgramAccounts` scan
    beyond 500 accounts or a different discovery method. UNCERTAIN: public RPCs restrict `getProgramAccounts` (P1b section 12 item 3);
    a paid RPC provider is likely needed (D9).
  - **G2 start-up check:** genesis hash, config PDA mint, program id, on-chain `epoch` against `networks`; refuse to run on mismatch.
  - Executor fee-payer key + SOL floor alert; reconciler key for `acknowledge_claim`; Resend for the notifier (key on host).
  - Delete `app/api/internal/solana/reconcile` once the runtime exists.
- **Areas.** `workers/*` (new), `lib/solana/v2-observer.ts`, `v2-evidence.ts`, `v2-authority-observer.ts`, `v2-operation-observer.ts`
  (security-sensitive: **do not weaken `localRpc`'s existing tests; add a separate network constructor**), `lib/db/payment-reconciliation.ts`.
- **Depends on.** Phase 1 (084 reader), Phase 2 (host skeleton), D9 (RPC provider).
- **Exit test.** Unattended run against a local validator (existing harness) AND against devnet read-only for the observer; induced
  failures fire each alert; the scan handles more than 500 accounts in a test; kill the process mid-RPC and recover without double effects.
- **Risks.** Largest unknown in the plan: evidence capture over a remote RPC changes the trust model (a malicious RPC fabricating
  replies is outside the funding gate's model, P1c section 7 item 3). A second RPC cross-check is cheap insurance. Time-boxing is hard.
- **Founder-only.** RPC provider account and keys (D9).
- **Agent.** IMPL; **REV (observer review) is mandatory** and should be a different reviewer from the issuer review.

### Phase 6 - Funding gate wiring and observer cross-check  (M)
- **Scope.** Make `checkFundingGate` a wired step, not a function:
  - DB adapter: reads the 084 projection through a verifier login and passes the **raw** three fields (P1b section 6, 33 malformed shapes refused).
  - Pinned deployment from the reviewed manifest, never from the RPC being asked.
  - **Cross-check** (G2 in code): DB `networks` row (issuer, `authority_epoch`, caps, mint, program, config, genesis) equals the decoded on-chain config.
  - A runner for the founder (`funding-enable` precheck: prints the decision and the `target` incl. slot, records it) and a periodic
    worker check that **alerts** when `funding_enabled` is true and the gate fails. UNCERTAIN: automatic disable would give the worker
    a power it should not have; recommend alert-only plus the single-person `disable_funding` you already hold.
  - Residual from P1c: the decision is a snapshot at `target.slot`; the enable approval by the friend is a separate web action.
    Mitigation: the runner is re-run immediately before the second approval and its result is quoted in the approval record.
- **Areas.** `lib/solana/v2-funding-gate.ts` (extend, keep exports), new adapter and runner, worker check.
- **Depends on.** Phase 1 (projection), Phase 5 (network observer).
- **Exit test.** Against the container DB and a local validator: gate passes for solo and separated; refuses each malformed row and each
  DB/chain divergence (changed epoch, wrong mint, extra pending vault). Run read-only against the devnet rehearsal deployment with the
  real DB-sourced row (D3's open caveat).
- **Risks.** An adapter that mislabels units cannot be detected by the gate (P1c section 7 item 3): a test pins seconds end to end.
- **Founder-only.** None.
- **Agent.** IMPL; covered by the Phase 9 review.

### Phase 7 - Migration pipeline: container -> staging -> production  (M, runs beside Phases 1-6)
Order is fixed. Each migration gets: container replay with the full payment-db suite and its own suite; a staging dry run (rolled back),
apply and re-run refusal; a founder runbook kit in `flexsoar-reviews\prod-runbook-<n>\` with a pinned commit and sha256, checks-diff
script and a rollback statement, written by IMPL and **read by a REV session before you run it** (the 082 kit is the template).
1. **Production now (independent of the program work):** 081, then 081b, then 082. 082 only creates the mode table at `separated,3,0`
   (behaviour unchanged, [V] 082 design); applying early keeps production equal to staging. **Do not switch to `solo` yet** (rule recorded in the 082/P1 sections).
2. **083 and 084** after Phase 1's REV and after you accept the issuer design: staging first (staging has 082; it has no networks/staff/users, so
   behaviour is proven by the container only), then production **before** the mainnet DB go-live (Phase 13).
3. Production preflights re-confirm the cluster pin (`system_identifier` 7666007964130682852) and the migration list, because my
   production state in F11 is from records, not a live check.
- **Founder-only.** Running every production file; keeping the pre-apply backup (as on 2026-10-21); the staging guard needs the URI in
  `C:\Users\Family\secrets\flexsoar-staging-db-url.txt` (never printed).
- **Agent.** IMPL (author + kit), REV (kit + migration), per-task §2 / staging-exception authorization in each prompt.

### Phase 8 - Worker host and per-role logins  (M; founder runbook)
- **Scope.** Provision the one small host (D8), five OS users, per-user secret files (0600), systemd units/timers or a supervisor, firewall
  (only the web app and the founder can reach the issuer endpoint), time sync, log shipping, an **out-of-band** uptime/alert channel,
  backups of config (the host holds no state). Create the five `flexsoar_worker_*` logins on **staging first**, then production (W1 section 4
  pattern; names must not start with `payment_v2_`). Verify the grant matrix and `worker_identity` per login; settle the pooler question
  (session mode until a custom login's `session_user` is proven) and install the Supabase CA for verify-full **[A]**.
- **Areas.** `docs/handoff/` runbook + a read-only verification script set (IMPL writes; you run).
- **Depends on.** Phase 5's process layout; Phase 7 (staging has 084).
- **Exit test.** Per login: `worker_identity` returns the right role, not superuser; the matrix is exact; each login is refused on another role's
  function, on `UPDATE public.users`, on `INSERT payment_v2.events` (tests 36-40's assertions); an induced worker stop alerts within 2x cadence.
- **Risks.** Password handling (generate on your machine, enter over interactive `\password`, never in a committed file); Supavisor behaviour for
  custom logins **[A]**; host compromise = all five roles' secrets, so keep roles separate users and the issuer on its own user.
- **Founder-only.** Everything here (accounts, host, DB passwords, CA, alert channel). Agents never receive a password.
- **Agent.** IMPL (runbook and verification scripts only).

### Phase 9 - Independent review gate R5  (M)
- **Scope.** One fresh-session review of Phases 1-6 together: migration 083/084; issuer service and the "no bare `open_sale`" property;
  the signing screen against the R1-04 checklist; the network observer; the gate wiring; and the host/login runbook. Output as R1-R4 were.
  Findings fixed (new commits, never rewrites) and re-reviewed for anything HIGH/MEDIUM.
- **Exit test.** No open HIGH/MEDIUM; every LOW has a recorded disposition.
- **Founder-only.** Choosing the reviewer session and accepting dispositions.
- **Agent.** **REV only.** The implementer must not be the reviewer.

### Phase 10 - Devnet end-to-end with test USDC  (L)
Two stages, because of F8:
- **10a. Headless, devnet + isolated container DB (recommended first).** Throwaway keys per task under `flexsoar-devnet-keys\<task>\`, a
  self-created 6-decimal test mint, scripts standing in for the browser (seller/buyer keypairs sign the same bytes), real workers running unattended
  against the container. Needs only the existing §2 container and §2b devnet exceptions, each cited per task. Replaces `integrated.mjs`.
- **10b. Browser + staging DB.** Real UI, Privy **development** app, staging DB. **Blocked by F8** until you amend the rules (D3): the Devnet exception
  currently bans Privy/Supabase credentials, and the staging guard demands zero `auth.users`.
- **Scenarios (both).** Purchase -> receipt -> authentication -> **24 h delay refusal then success** (on devnet the delay can be set to a short
  value by governance only if the test program/config allows; otherwise wait: UNCERTAIN) -> release -> `execute_outcome` -> acknowledge;
  refund (both governors); dispute resolve; pause drill (guardian `emergency_pause` and `disable_funding`); below-floor attempt refused by DB and
  by chain; expired listing; wrong signer; a worker killed mid-flight; daily invariants (`outstanding` equals DB open escrow totals).
- **Exit test.** Every scenario passes unattended with a written log (signatures only, no keys); alerts fire in an induced failure; invariants hold.
- **Risks.** Devnet instability/airdrop limits (faucet is manual, D3 needed the founder's 10 SOL); the 24 h delay makes a full lifecycle slow.
- **Founder-only.** Faucet SOL; the §2b citation for each task; (10b) the rules amendment and the Privy dev app.
- **Agent.** IMPL runs it; the log is reviewed by REV before Phase 11.

### Phase 11 - Mainnet readiness: build C, changed-binary upgrade rehearsal, ceremony script  (L)
- **Scope.**
  1. **Build C** with a mainnet program id (F10): new keypair held by you, `declare_id!` and Anchor entry changed, D2 byte-proof method repeated,
     on-chain suite rerun, hash recorded, REV confirms the diff is the id only.
  2. **Rehearse a changed-binary upgrade on devnet** through a **time-locked** upgrade multisig (D4 proved only an identical-binary upgrade on an
     unlocked multisig; D3 "Change before mainnet" items 1-5). Include failed-upgrade buffer recovery.
  3. **Mainnet mode for `init-v2.mjs`:** it refuses mainnet today. Add a deliberate path: typed genesis, manifest read aloud by both people,
     `--dry-run`, then real. Needs its own review (D10).
  4. **Ceremony script from `multisig.instructions.*` only** (the SDK `rpc` wrapper failed in D3); members compared as a set; both multisigs
     recorded with `timeLock` explicit (governance 0, upgrade 86,400 s); real hardware wallets as members; sealed recovery key arrangements.
  5. Written runbook with STOP points, a rollback per step, and the SOL budget (about 9 SOL peak on mainnet for `--max-len 700000`, real money).
- **Exit test.** Dry run of the whole ceremony on devnet with hardware wallets and the exact scripts; REV signs off the ceremony plan.
- **Risks.** Hardware-wallet signing of Squads proposals is unproven here; the friend's availability; any binary change restarts the review loop.
- **Founder-only.** Hardware wallets, recovery-key holder, program keypair custody, funding the deployer with real SOL.
- **Agent.** IMPL (build C, scripts), REV (ceremony plan, per M6 in W1).

### Phase 12 - Mainnet ceremony, friend present  (M; FOUNDER-RUN)
Follow `solana-p1b.md` section 11 as amended by P1c/D3/D4, in this order, funding paused and caps 0 throughout:
fresh-id inventory (STOP if the id owns any account) -> deploy with buffer, dump and compare hash to C -> `init-v2` with `verified: true` ->
`set_release_delay(86400)` -> verify the Squads multisig off chain -> `propose_governance_vault` -> accept through Squads -> verify native `set_pause`
is refused (6001), destroy the ceremony key -> prove a governed no-op -> hand upgrade authority to the time-locked upgrade multisig -> `configure` roles and **tiny
caps** through the vault. Then read every field back against the manifest. **Nothing in this phase enables funding.**
- **Exit test.** On-chain config read-back equals the manifest; authority is UV; governance is the vault; native governance refused; guardian
  pause works while already paused.
- **Founder-only.** All of it. The agent's role is the prepared script, a live read-only verifier, and recording the log.

### Phase 13 - Production DB and host go-live, funding off  (M; founder-run)
`networks` row for mainnet with `funding_enabled=false` and the small caps (W1 G3: genesis from `getGenesisHash`, program, config PDA, mint `EPjF...Dt1v`,
treasury and its token account, issuer, `authority_epoch` from the chain); staff rows (7 operational roles, one `person_id` for you, plus the two
governors: you and the friend, each their own `person_id` and a FlexSoar login so each can approve in a web session); propose/approve the switch to
`solo` (two governors, funding off); worker logins; workers running; G2 check passes; Phase 6 gate runs read-only and reports its failures
(funding off is expected to *pass* the config checks and still be disabled); 083/084 applied beforehand (Phase 7).
- **Exit test.** W1 M8: grant matrix, `worker_identity` per login, 7 days of clean heartbeats, a guardian pause drill while paused, a
  restore-from-nothing drill of the host (config only).
- **Risks.** Staff key misentry is permanent (`staff` is append-only, 059:217): the runbook reads each key back against the hardware wallet.

### Phase 14 - Canary: first real purchase  (M; FOUNDER-RUN)
- **Enable, in this order (W1 G4):** (1) governance `configure` caps through the vault (`max_trade` = smallest price you would list; `max_escrow` = 3x;
  caps must be > 0 before unpausing, `lib.rs:42-45`), then `set_pause(false)`; (2) gate runner passes; the friend approves DB `enable_funding`;
  (3) deploy the app with `FUNDING_AVAILABLE=true` (a reviewed one-line change). Each step is harmless without the next.
- **Containment.** Only enrolled wallets and enrolled inventory can transact (F1, F2), the Phase 2 allow-list limits who can enroll, and the caps bound the amount.
- **Lifecycle with real USDC and founder-controlled buyer and seller accounts:** enroll -> register card -> list -> prepare -> sign -> open -> buy ->
  receipt -> authenticate -> wait 24 h -> release (distinct keys) -> execute -> acknowledge; then a **second** purchase taken through a refund (both governors);
  a pause drill with a live listing; invariants checked daily.
- **Exit test ("first real canary purchase" done).** A purchase reconciles end to end in DB and on chain, the refund path has been exercised, the
  kill switch has been exercised, and seven days of invariants are clean. Raising caps is a separate decision after that.
- **Risks.** Real money; the 24 h delay means the first release is a day after the purchase; a stale FX quote (D5) can strand a listing (revoke and re-sign).

---

## 4. Dependency and ownership summary

| Phase | Gate to start | Main output | Agent | Founder-only actions |
|---|---|---|---|---|
| 0 | none | decisions, proof recorded | IMPL | decisions, proof JSON |
| 1 | 0 | migration 084 (container) | IMPL then REV | authorize task |
| 2 | 0, 1 | issuer service | IMPL, REV | Privy secret (if used) |
| 3 | 1, 2 | enrollment + signing UI | IMPL (market widened), REV | manual wallet run |
| 4 | 1, 2 | buyer checkout | IMPL | none |
| 5 | 1, 2, D9 | worker runtime + network observer | IMPL, REV | RPC provider |
| 6 | 1, 5 | funding gate wired | IMPL | none |
| 7 | 1 (083/084 steps) | prod 081/081b/082, then 083/084 | IMPL + REV, founder runs | all production runs |
| 8 | 5, 7 | host + logins | IMPL (runbook) | everything |
| 9 | 1-6, 8 | review R5 | REV | pick reviewer |
| 10 | 9 | devnet E2E (10a, then 10b if allowed) | IMPL, REV on the log | faucet, citations, F8 amendment |
| 11 | 10 | build C, rehearsal, ceremony runbook | IMPL, REV | hardware, keys |
| 12 | 11 | mainnet program + governance | founder | all |
| 13 | 7, 8, 12 | prod DB + host live, funding off | founder, IMPL support | all |
| 14 | 13 | canary | founder | all |

## 5. Things I could not verify (needed before the phase that depends on them)

- Privy server-wallet Solana signing policy and price; Ed25519 KMS alternatives (Phase 2 spike).
- Whether the host can use `psql` unchanged, and Supavisor `session_user` for custom logins (Phase 8).
- Public RPC limits for `getProgramAccounts`; which paid provider and archive to use (Phase 5).
- That 078's fragments left `prepare_sale`'s funding check as read in 060 (read 060 text only; the container suite exercises it).
- Production's applied-migration list today (from records, F11).
- How `open_sale` is routed to the issuer key (F7) and how `register_card` commitments are produced for the canary card (no script found; Phase 11 or earlier).
- Whether a short release delay can be used on devnet to avoid waiting 24 h in Phase 10.
- Real Squads behaviour with hardware wallets, a time-locked upgrade multisig and a wrapped execution (D3/D4 unverified list).

## 6. Decisions you must make

**Blocking Phase 1-2 (decide first):**
- **D1. Who writes `wallet_accounts`.** Recommend the **issuer role** with SQL cross-checks and an allow-list. Alternative: a new sixth role (more migration, transport and grant-matrix work).
- **D2. Card inventory enrollment for the canary.** Recommend **founder SQL plus a reviewed script** for the one canary card; build the RPC/admin UI after the canary. Alternative: build it before the canary (adds a phase).
- **D4. Issuer custody.** Recommend: build the signer interface; use a **key file** on devnet; for the canary use the Privy server wallet **only if** the spike confirms program-restricted Solana policy, otherwise a 0600 key file. Rationale: with the seller floor the issuer key cannot under-price, so a file key plus tiny caps is an acceptable first step; confirm with the reviewer.
- **D7. Canary allow-list.** Recommend an operator-set list of user ids in the issuer service (no schema). Alternative: a DB table (needs a migration) or none (rely on enrollment and caps only).

**Blocking Phase 3-5:**
- **D5. Quote and listing lifetime, and re-quote rule.** The floor is fixed from the quote at prepare time, so FX drift beyond 2% strands the sale. Recommend a short lifetime for the canary (hours, not days), revoke and re-sign on drift. Needs your number.
- **D6. When "prepare" happens.** Recommend an explicit seller action on the signing screen, because F3 means it can only succeed while funding is enabled.
- **D9. Chain RPC provider and archive source** (paid account, keys held by you). Public RPC is unlikely to be enough for the observer.

**Blocking Phase 8-10:**
- **D8. Host:** provider, region, OS, who may SSH, the out-of-band alert channel (a phone push is enough), and who else could restore it.
- **D3. E2E venue.** Recommend **10a first** (devnet + container, no rule changes). For 10b on staging you must amend AGENT_RULES yourself (only `main` edits it): allow a Privy **development** app and staging Supabase keys in the Devnet exception, and relax the staging guard from "zero `auth.users`" to "every `auth.users` row is a marked synthetic test user". Say if you want that, or if 10a is enough.
- **D12. Production migration timing.** Recommend applying 081, 081b and 082 now (no behaviour change), and 083/084 only after Phase 9.

**Blocking Phase 11-14:**
- **D10. Mainnet `init-v2.mjs` path.** Recommend a deliberate mainnet mode (typed genesis, two-person manifest read, dry run) over doing it with hand-built transactions, subject to review.
- **D11. People and hardware.** The friend's FlexSoar login (needed for DB governance approvals), hardware wallets for you and the friend, the sealed recovery-key holder and their written procedure, and the program keypair's custody for build C.
- **D13. Canary numbers.** `max_trade` and `max_escrow` in USDC (W1: smallest listing price, and 3x), the canary card and price, and whether the first buyer and seller are both your accounts.
- **D14. Time-lock rehearsal.** Confirm the 24 h upgrade multisig lock is rehearsed on devnet in Phase 11 before mainnet (recommended), which adds a day of waiting.

**Already decided and carried forward:** solo mode with the friend as second governor; Squads 2-of-3 governance without a time lock; separate 2-of-3
upgrade multisig with a 24 h lock; one dedicated host; 24 h release delay; 2% FX tolerance; funding off until the canary.
