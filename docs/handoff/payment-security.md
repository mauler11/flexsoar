# Payment security — reviewed architecture and implementation handoff

Review date: 2026-10-15. Review base:
999d20a36404b156fb5bdc54b2cd4238f11a8d85 on track/payment-security.
Original base/main: e62795ba3d05d5face22456535f755476a86974c.
This CURRENT REVIEW supersedes the prior handoff, preserved in commit 999d20a.
Proposed database/program architecture is NOT implemented.

## Current release verdict and behavior

PUBLIC PURCHASE PAYMENTS REMAIN BLOCKED. This review found that the legacy
quote's inferred five-minute inclusion interval cannot establish authorization
for an intended purchase. A matching historical transaction inside that window
is not excluded by a unique attempt. Fresh quotes have the same missing binding.

The route now REFUSES creation of new settlements. Existing exact buyer/listing/
sol:signature/settled-status receipts can still be looked up, explicitly marked
receiptOnly=true, paymentVerified=false. This does not attest to the historical
record's financial legitimacy: legacy RPC can have created it without proof.
Absent receipt returns 409, recoveryRequired and retrySettlementOnly with an
explicit instruction to preserve evidence and NOT pay again. This does not
durably record or automatically resolve the obligation.

DO NOT DEPLOY THIS ROUTE ALONE: build-tx still builds payable transactions and
market can sign/broadcast them. The market/build owners must gate new issuance
and signing before adopting this refusal. Those unassigned paths were not
edited. Direct legacy program buys remain executable independently of the app.
No policy change, escrow, refund mechanism or claim of complete security is
introduced. Main dependency changes and old data worktree remain preserved.

## Review findings and exact production paths

| Finding | Source / triggering condition | Disposition and owner |
|---|---|---|
| Critical: authenticity/time window is not authorization | At 999d20a settle authenticates expired HMAC then strict inspector accepts expiresAt minus five minutes. quotes.ts signs buyer/listing/units/deadline only; sdk.ts hashes Card only. | All unrecorded legacy settlement now fails closed, including fresh quotes. Durable attempts plus chain authorization required; data/human/Solana. |
| Critical: direct RPC bypass remains | 021_credit_holds.sql five-argument fn_purchase_card SECURITY DEFINER wrapper; 022b and 026 authenticated grants; 043_sale_notification.sql core. | A nonempty cash reference is not proof. Seller contexts allowed by payout reader can name another buyer; wrapper returns existing reference without correspondence. Route guard does not close RPC. Human migration blocker; no live exploit probe. |
| High: receipt financial context missing | PaymentOrder projection has only ID/buyer/listing/ref/status. | Buyer/listing/signature/status correspondence checked before either initial or concurrent receipt return, but immutable network/mint/program/wallet/quote terms absent. receiptOnly response exposes that limit; no new payment verified from it. |
| Confirmed defect, fixed | recoverOrSettlePayment ignored RPC-returned order ID before rereading receipt. | Conflicting returned ID now yields operator-resolution error even if receipt matches. Lost response still recovers exact receipt; conflicting receipt fails. |
| Instruction attribution holds in source/fixtures | inspectPurchaseTransaction decodes discriminator/u64/Card hash, checks accounts/config PDA, mint/owners/amount/deltas and two SPL CPIs under expected outer index. | Matching transfers under another invocation and duplicate program invocation fail. Extra unrelated instructions allowed. Strict result is evidence, never authorization. |
| Sponsored fee payer preserves buyer check | Inspector finds buyer key signer independently of key zero; finalized RPC supplies actual verified signatures. | Sponsor may pay SOL; sponsor alone fails. Transaction ID is first signature, not necessarily buyer signature. |
| Stripe containment holds at execution | contract.ts checkPayoutEligibility blocks all; executePayout independently reads reference then throws; processAllDuePayouts calls that executor. | No Transfer creation or paid_out mutation remains there. USDC and historical Stripe blocked. Prefix classification alone is not payment evidence. |
| High: market can prompt again | SolanaBuyPanel.tsx settle:71-104 and signing handlers reset phase ready on ambiguous errors; missing embedded signature claims nothing sent after signAndSendTransaction. | API never recommends another payment, but UI permits it and may falsely imply unpaid. Short signature text is not durable recovery. Market launch blocker. |
| Critical: race/claim mutation remains | Rust buy at solana/programs/flexsoar-settlement/src/lib.rs:78 accepts price and unused vault_ref, no sale state; 043 locks Card without owner/status check. | Both buyers can send USDC; one claim. Cancellation/redemption/reprice conflict remains. Human/data/Solana blocker. |

CURRENT call path: getUser -> validate identity/signature -> authenticate original
quote -> service lookup by exact sol:signature -> correspondence -> receipt-only
response; absent receipt -> refusal plus recheck for concurrent completion. No
chain RPC, signing, broadcast or settlement RPC occurs in this route now.

At 999d20a the continued path was current listing/users/config -> finalized
getTransaction -> inspector -> advisory Card checks -> purchaseCardSplit ->
fn_purchase_card -> core. Mutable current wallet/config substituted historical
bindings. Removing that authority is deliberate, not a claim those bindings
were repaired. Existing receipt lookup still needs the original quote HMAC key;
key rotation can block it. Durable identity-bound recovery must remove that
dependency. Pure orchestration and evidence helpers remain for a future adapter.

## Recommended architecture: authority and sale consumption

Keep direct 95/5 USDC transfers and database-backed Cards. Chain consumption
records PAYMENT ENTITLEMENT to the database claim; it does not mint an NFT or
change Postgres ownership inside Solana. Escrow/platform funds custody/refunds
would be separate approved business decisions, not assumed here.

Recommend a restricted backend issuer signs a canonical domain-separated
Ed25519 permit AFTER immutable attempt terms commit. Program checks an actual
Ed25519 verification instruction through instructions sysvar, exact message,
issuer key/version and unambiguous offsets/placement. Never trust a client
assertion of verification. Live server co-signing each transaction is an
alternative with availability/blockhash retry costs; choose one. Existing
HMAC cannot serve as on-chain authorization.

Issuer is distinct from buyer/seller/treasury/admin/upgrade authority. Use an
isolated managed signing service, not browser/repo/database/log key storage.
Ordinary service credentials must not grant issuer-key access. Program config
pins authorized signer versions. Issuer only authorizes a reserved DB sale with
confirmed open chain state and trusted price/custody policy, never arbitrary
client fields. Founder must approve authorizing sales without seller co-signing.
Compromised issuer can sign dishonest terms; independent pause, caps and audit
remain necessary.

Permit fields: protocol/domain/ABI version, configured genesis/cluster/program/
config, sale/listing ID and generation/revision, Card hash, attempt/authorization
IDs, opaque beneficiary identity binding, buyer wallet/source token account,
seller/treasury wallets and destination accounts, token program/mint, total/net/
fee integer units/rules, valid-from/expiry, issuer key version and immutable
attempt digest. Use canonical binary encoding, checked arithmetic and independent
vectors. No personal records on chain. Solana cannot read genesis here: pin
domain in config and verify expected RPC genesis off chain. Identically wrong
domains defeat that boundary. Program/mint deployment must agree with cluster.

Lifecycle authority creates one Sale PDA per immutable listing UUID/generation
before permits are delivered. Record Card hash, seller, revision, policy/state,
eventual winner/beneficiary/terms hash/amounts/slot. A small CardControl PDA points
to current sale generation and fences old listings; it is not a token ownership
ledger or permanently consumed Card. Opening is a durable outbox operation,
not a Solana/Postgres atomic transaction.

buy-v2 requires buyer signature (sponsor permitted), exact permit/config/accounts,
current CardControl generation/revision, sale=open and program Clock within
valid-from <= execution < expiry. Shared writable Sale/CardControl locks serialize
buyers. Consume sale for the attempt and perform both transfers in ONE atomic
transaction. Any failure, including second transfer, rolls back consumption and
transfers. Persist winning attempt/beneficiary/digest/units/slot and emit event.

Two buyers' permits MUST target the SAME Sale PDA. First successful transaction
consumes it; second fails before USDC movement (network SOL fee may apply).
Never allocate independently consumable sale accounts per buyer. Replays/new
transactions with the same permit cannot pay again. Reservation reduces prompts;
shared chain consumption is the safety property. Resale opens a new sale
generation after reconciliation; old consumed IDs never reopen. CardControl
prevents simultaneous old/new sales without permanently forbidding resale.

Reject legacy buy at cutover, including direct callers. Updating SDK alone
leaves old transactions executable. Historical v1 payments need separate
evidence review, never an invented v2 permit retroactively authorizing them.

## Cancellation, expiry, repricing and remaining non-atomic boundary

All list/owner/status/custody/redeem/trade mutations coordinate the same locks
and fences. Persist mutation intent, stop permits, then revoke/revise ON CHAIN.
Keep claim unavailable until finalized outcome known. Cancel click is pending,
not revocation of a signed transaction.

- Revoke executes first: buy fails with zero USDC transfer. Buy executes first:
  entitlement wins, cancel denied and claim reconciled. Founder must approve
  this ordering/customer wording; do not announce cancellation before fence.
- Reprice fences old revision before issuing new terms. Winning earlier buy
  retains original quoted claim/price; never revalue at current FX.
- Program Clock checks expiry at execution. Executed before expiry remains
  recoverable indefinitely; executed afterward fails atomically. Signing time,
  browser time, recent blockhash expiration or inferred blockTime windows cannot
  replace authorization consumption.
- Reservation release/abandonment cannot revoke a signed permit. Reissue only
  after chain fence or expiry AND finalized shared-sale outcome. Failed candidate
  signature does not rule out another candidate. Never create a new sale to
  escape unknown payment. Blockhash refresh/re-signing obeys attempt state,
  not the default response to failed settlement.
- Redemption first fences sale/reconciles winner, then retires/ships claim.
  Relist requires previous sale terminal/reconciled and current owner verified.
- Config/treasury/mint/key rotation must not reinterpret history. Version and
  retain evidence; fence obsolete open sales before removing old acceptance.

Non-atomic cases remain: DB commits attempt but chain opening fails; chain
payment finalizes during DB outage; chain revoke succeeds but DB ack is lost.
No distributed rollback exists. Durable intent/outbox plus external outcome
checks hold claim unavailable while unknown. Watcher independently scans retained
Sale state/events/finalized transactions with overlap/backfill cursors, discovering
payment without browser submission. Events alone fail when history unavailable:
retain sale state and archival RPC access. A winner with no corresponding DB
attempt becomes unresolved/alert, never arbitrary ownership.

Finalized chain winner establishes payment entitlement. Verifier matches immutable
attempt/digest/domain/instruction, then atomic DB settlement writes ledger/cache.
Browser closure/lost response/quote expiry/wallet relinking/key rotation recover
the ORIGINAL user/attempt; no new payment signature or current-wallet substitution.
Wallet linking cannot transfer recovery rights. Account recovery needs approved
identity policy; admin cannot silently change beneficiary. Conflicting legacy
ownership/redemption freezes further actions and creates an explicit obligation.
Correction/fulfillment/reimbursement needs an approved operator policy; no automatic
refund or recovery of seller funds assumed. Halt availability on divergence.

## Proposed database entities, permissions and transitions (no SQL)

| Entity | Required fields / role |
|---|---|
| sale_authorizations | ID, listing/Card/seller, generation, genesis/program/config/PDA, revision, policy/custody evidence/version, state, mutation intent, open/revoke candidates/finality, winner, timestamps/CAS version. |
| purchase_attempts | Opaque ID/session buyer/initiation idempotency key; sale/listing/Card/seller; frozen wallets AND token accounts; network/mint/token/program/config/ABI; MYR sen/FX evidence/rounding; exact USDC split/fee rules; canonical terms/digest/authorization ID; valid interval/issuer version; state/order/timestamps. Terms immutable once authorized. |
| payment_submissions | Attempt, network/signature candidates, message digest, last-valid height when known, observation/source, pending/failed/finalized state. Client candidates are NOT proof; replacements can belong to one attempt. |
| verified_payments | Immutable attempt/sale/revision/digest, network/signature/instruction index, program/config/ABI/mint/signers/accounts/units, slot/time/finality, verifier identity/version/time, evidence digest/location and chain consumed record/order. Verifier-only writes. |
| payment_resolution_events | Append-only reason/actor/evidence/action/outcome/timestamps, attempt/payment/order links, responsible owner and review deadline. Not user-editable proof. |
| outbox / reconciliation cursors | Transactionally enqueued lifecycle/settlement/notification jobs; lease/retry/idempotency keys and per domain/program progress. Completion checks external durable outcome. |
| orders additions | Immutable payment rail, attempt/payment FKs, seller settlement rail/status/units/evidence. Keep MYR snapshots. paid_out/stripe_transfer_id retain Stripe meaning; payout_release_at does not mean on-chain seller funds held. |

Constraints: unique listing/generation and domain/PDA, one current sale per Card,
consumed sale cannot reopen, one winning attempt/order per sale, one order per
attempt/payment, unique (genesis, signature) consumption for launch's ONE purchase
per transaction. Store instruction index but reject batched purchases initially;
batching requires explicit uniqueness redesign. Unique domain/program/authorization
ID and buyer initiation idempotency key; immutable digest. Enforce consistent
foreign keys across sale/attempt/payment/order, integer/nonnegative/exact-split
amounts, distinct buyer/seller and valid interval. Deletion cannot free payment
for reuse. Legacy string references remain a separate semantic domain.

- Sale: preparing -> opening -> open -> consumed -> reconciled; or open ->
  revoking -> revoked/expired. Unknown stays opening/revoking plus alert.
  Consumed beats a pending DB cancellation intent.
- Attempt: initiated -> authorized -> submitted -> awaiting_finality -> paid
  -> settled. Watcher can discover paid directly from authorized. Abandonment
  before any permit is safe; after authorization it is intent only.
  expired_unpaid needs expiry/revoke AND finalized no-consumption for this
  attempt. Another winner terminalizes losers not_paid after evidence review.
  Conflicts become unresolved, resolution names an audited specific outcome.
- Payment/finality and claim settlement are separate axes. Paid never becomes
  unpaid because response or quote expired. Unknown remains unknown.

Users initiate/read own attempts, attach candidate signatures/request cancellation;
buyer derives from auth session. No setting financial terms/evidence/paid/order,
changing bindings, or reading other buyers. Seller sees relevant sale/order view.
Admin has audited resolution views, not evidence fabrication. Separate issuer and
verifier least-privilege entry points from ordinary service processes; permit
publication cannot precede committed immutable terms.

Replace reference-string settlement with verified-payment-ID settlement. Revoke
authenticated/anon/PUBLIC execution on EVERY fn_purchase_card/core overload,
including default-argument paths and fn_purchase_card_with_credit if live.
Checked-in intent: five-arg wrapper in 021; three-arg removal 022, four-arg removal
021, credit-wrapper removal 022b. Human inspects actual catalog/grants before
migration: checked-in intent is not live state. Retire/hard-disable even service
reference-only shortcuts after migrating callers, including dormant webhooks.
Frozen TypeScript signatures may remain but refuse unsupported use; add a new
verified-settlement contract with explicit privileges. Stripe webhook must not
gain verifier authority or settle v2 sale.

Atomic settlement takes consistent locks (Card, listing/sale, attempt/payment,
required user/account rows), checks recovery access/verifier role and full
correspondence before returning existing order. Consume evidence, assert seller
owner/status, intended generation/winner, immutable quote terms and approved
custody; write order/balanced append-only ledger/provenance/cache, mark listing
sold/attempt settled and enqueue notifications in ONE transaction. Expired quote
or pending DB cancellation cannot alone reject valid chain winner. Actual claim
conflict is unresolved, not ignored. All list/cancel/redeem/trade/custody RPCs and
direct-table permissions must enforce this same protocol. Unique-violation
handlers check correspondence, never return arbitrary existing ID. Real isolated
DB tests must verify constraints, locks, roles and definer search paths.

## Founder decisions and operating implications

1. Approve direct-transfer chain-order entitlement/cancellation and issuer trust,
   or explicitly choose another model. Direct USDC cannot provide seven-day seller
   hold. Escrow/custody/refunds are separate designs, not hidden workarounds.
2. Approve/reject vaulted-only public launch. If adopted, enforce verified
   items.custody=warehouse, eligible authentication/grade and no fulfillment lock
   under DB locks at opening/issuance; fence custody exit while open/unreconciled.
   UI/builder checks supplement this. Historical seller-held stock is not
   grandfathered. This review does not adopt policy or change physical custody.
3. Choose managed issuer/lifecycle keys, rotation/revocation SLA and independent
   pause/Squads admin/upgrade authority. Treasury receiver is separate. Current
   initialize accepts first signer; Squads treasury does not establish Squads
   admin. Restrict initialization/admin transfer before mainnet. No keys read.
4. Choose rent/transaction-fee payer, outstanding-sale/rate limits, archival
   retention and named unresolved on-call owner/SLA. Sale/CardControl rent needs
   implemented ABI sizes and human-approved read-only estimate, no invented costs.
   Sponsor never gains buyer purchase authority.
5. Retain consumed/revoked tombstones or permanent generation fences. Closing and
   recreating PDA cannot reset consumption. Rent recovery differs from buyer
   refund; retain recoverable evidence. Pause cannot undo finalized transfers.

## Existing orders and Panda rehearsal

Do not rewrite old orders as v2 attempts or mark paid_out to suppress Stripe.
Identify/preserve exact order/listing/Card/item/provenance/ledger, full signature,
cluster/program/mint/quote if available, wallets/token accounts and slot/deltas.
Classify legacy/unverified where evidence missing; sol: prefix is insufficient.
Preserve references while adding domain uniqueness; resolve collisions first.

wizzy/Panda purchase is reported history, not verified here. Human identifies
order/current owner/custody before cleanup or redemption. A settled-unpaid sol:
order is unpaid by Stripe, not a reason wizzy owes another payment. Never replay
purchase. V2 prospective only; legacy unrecorded payment needs evidence review,
not a permit fabricated after payment. Redemption has separate unclosed payment/
fulfillment protections; do not rehearse against shared Supabase for this task.

## Implementation sequence and exact lane handoffs

1. Human/market gates issuance/signing first, retaining receipt/support recovery.
   Outside scope paths: app/api/solana/build-tx/route.ts, quote/route.ts,
   components/market/SolanaBuyPanel.tsx, CheckoutModal.tsx, PrivyBuyBridge.tsx.
   Do not deploy settlement refusal while presenting operational Pay.
2. Founder resolves decisions. Human/data authors/reviews migrations in isolated
   environment and separately inspects deployed grants/catalog read-only. No SQL
   authored here; inventory all claim-mutating callers and shared lock order.
3. Solana lane implements ABI/vectors, shared Sale/CardControl/config versions,
   issuer validation, execution time/revision fencing/winner evidence, disabling
   v1 and initialization/admin upgrade safety. Paths include program lib.rs,
   Cargo.toml and initialize scripts. Undeclared mainnet feature/mint mismatch
   and first-signer initialization remain independent launch gates.
4. Data lane implements attempts/outbox/issuer/verifier/watchers/new verified
   contract/RPC. Extend scope for builder/quote/SDK/worker routes after ABI/schema
   approval. Retain historical config/key versions. Use separate devnet/mainnet
   projects or enforced domain partitioning; unpartitioned shared Card/order
   state cannot safely operate both markets.
5. Market restores durable attempts across devices/tabs; preserves full attempt/
   signature on server; after broadcast retries ONLY status/verification/settlement.
   Ambiguous send is not cancel. Record message identity before broadcast where
   possible; watcher covers closure before attachment. localStorage/logs are
   convenience only. Recovery does not require wallet relinking. Honor
   receiptOnly/paymentVerified; never label unknown unpaid or return it to Buy.
6. Admin app/admin/** gets unresolved queue, chain winner versus DB conflict,
   pending cancels, immutable resolution history and stale watcher alerts.
   New contract readers require data assignment. No ad hoc owner/ledger/ref/
   paid_out edits. Name responsible operator and approved corrective paths.
7. Isolated program/DB/UI acceptance plus NORMAL validation; human deploys paused,
   closes legacy paths/grants, verifies domain/mint/config/issuer/admin, opens
   only reconciled sales. Main auto-deploys, so integration needs this sequence.
   No push/deploy here. Rollback cannot undo funds; recovery runs during pause.

## Failure-case acceptance tests for next implementation

- Two buyers/permits SAME Sale PDA, simultaneous/delayed sends through different
  RPCs: exactly one transfer pair/winner/order. Loser pays at most network fee.
- Duplicate/replaced transaction or reuse for another attempt/listing/user/cluster:
  one consumption/order, exact authorized recovery, no other-buyer data leak.
- Wrong issuer, Ed25519 offsets/domain/message, signer, mint/program/recipient/
  amount/Card/listing/revision or unrelated outer transfers: fail before USDC.
  Sponsor alone fails. Second CPI failure rolls back first and consumption.
- PDA closure/recreation/relisting cannot revive old permits. Buy versus cancel/
  reprice/redeem/expiry in both chain orders, signed before but executed after
  fence/deadline: original winner gets claim or no USDC transfer.
- Chain success plus DB failure/restart, browser closure, lost response, quote
  expiry/wallet relink/key rotation: watcher settles original without repayment.
  Pre-finality fork remains pending; archival gaps alert/backfill, not unpaid.
- Actual isolated DB roles/constraints/locks: concurrent retry one order;
  conflicting receipts/IDs error; every legacy overload/default grant and direct
  table/definer bypass refused for anon/authenticated/unapproved service roles.
  Mocks cannot prove these protections.
- User cannot fabricate evidence/set paid/read another attempt/bypass custody.
  USDC excluded from Stripe selection/execution/cron; dormant webhook cannot
  settle v2 or mark paid_out. If vaulted-only adopted, seller-held/ineligible/
  fulfillment-locked inventory cannot authorize and custody exit is fenced.
- Outbox retry does not duplicate effects; notification failure cannot make paid
  unpaid. Unresolved obligation survives restart and evidence-preserving cleanup.

## Current validation and exact human dependency preparation

STANDARD npx tsc --noEmit: PENDING / NOT RUN.
STANDARD npm test: PENDING / NOT RUN.
STANDARD npx next build --webpack: PENDING / NOT RUN.
No node_modules here. Aliased checks below are NOT those commands.

Human actions need explicit dependency-file authorization outside this task:
1. Preserve/review main's EXACT existing manifest/lock pair: memo manifest range,
   resolved 0.10.0 and related lock metadata. Human records/commits when ready;
   do not regenerate or overwrite that work with this branch's memo-less pair.
2. Explicitly authorize human integration of the exact reviewed pair here.
   No dependency edit, merge/rebase/cherry-pick or transfer performed by agent.
   Do not import old data commits, especially ignore-TypeScript-errors.
3. Human npm ci here using that pair; verify file hashes/installed memo 0.10.0.
   Do not copy main node_modules, env files or shared Supabase credentials.
4. Run normal installed commands here: npx --no-install tsc --noEmit, npm test,
   npx --no-install next build --webpack prevent silent downloads. Runtime config
   must target isolated/local fixtures/services with outbound effects denied.
   Build may prerender server code; never supply shared credentials to pass.
   Report isolated setup failures, never ignoreBuildErrors. Real integration
   needs separately approved isolated DB/program environment. No prep executed.

Supplemental OFFLINE adapted checks in THIS review: main's installed Vitest
4.1.11/TypeScript, explicit resolver mapping to task source, config:false,
no cache/installation/env-file loading:
- Current full suite: 402 passed, 2 failed / 404; 13 files pass, 1 fails.
  Dedicated production payment suite: 40/40 within that run (previously 34).
- Unchanged e62795b virtual source overlay with same resolver/settings and base's
  13 files: 362 passed, 2 failed / 364. Same untouched FSC-copy assertions fail
  at invariants.test.ts:1901 and :1960. This is a NEW adapted comparison, not
  historical baseline presented as standard result. No checkout changed.
- Base AND current adapted no-emit compiler: identical 3 TS2749 diagnostics,
  sign-in/page.tsx:20 and sign-up/page.tsx:20 PageProps; app/layout.tsx:41
  LayoutProps. Same options/typeRoots/dependency fallback; base overlay excludes
  task-added files. These sources default-import next values as generic types.
  This explains compared diagnostics; normal Next-generated types/build still
  pending. No task-file diagnostic in this comparison.
- Earlier 4-failure run has no preserved failing names/logs. Additional two
  NOT reproduced; cause UNKNOWN. Current/base show only deterministic FSC two.
  Market cache tests restore timers in afterEach; do not guess timer leakage.
  If recurring, capture names/assertions/seed/pool/workers/timings and reproduce
  individually/together. No shared assertions changed or clean-suite claim.
- git diff --check passes (CRLF normalization warnings may appear).

OpenCode shim exists; suitable enforced read-only mode not established and no
model invocation made. OpenCode NOT used. Codex performed review/design/checks.

## Revision files, exports and unverified evidence

Changed this revision: settle route (fail closed, receipt-only response),
lib/db/purchase-payment.ts (conflicting-ID rejection), lib/solana/verify.ts and
quotes.ts (correct authority comments), tests/purchase-payment.test.ts (six
focused cases) and this handoff. No new exports or changed frozen signatures.
Prior strict inspector/payout containment remain unchanged.

Unverified: live schema/grants, deployed program/config/admin/upgrade authority,
Panda finalized evidence/ownership/custody, dependency reproducibility, standard
tests/typecheck/build, real DB constraints/races and on-chain execution.
Blockers remain authoritative DB permissions/attempt settlement, on-chain sale
exclusivity/lifecycle, durable watcher/recovery, market double-payment UI/build
gating, founder/key decisions and normal validation. Balanced MYR ledger does
not prove USDC movement, seller hold, entitlement or correct external payouts.
No actual loss/exploit claimed from static review.
