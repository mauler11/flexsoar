# Payment security — track/payment-security

Task exception: isolated data lane, branched from e62795ba3d05d5face22456535f755476a86974c.
Main's manifest/lockfile memo changes and the divergent track/data commits were
not imported or changed. No SQL, Rust, market UI, auth, or shared tests changed.

## Release verdict

PUBLIC PURCHASE PAYMENTS REMAIN BLOCKED. This is application hardening, not a
claim of exclusive or recoverable payment authorization. Do not deploy it as a
complete fix. The existing UI can still invite another signature after a failed
settlement response, and unrecorded chain payments have no durable attempt row.

## Actual chain and enforcement points

CheckoutModal -> SolanaBuyPanel -> build-tx -> wallet signing/broadcast -> settle
-> purchaseCardSplit (service role) -> fn_purchase_card -> fn_purchase_card_core.
Cards remain database claims; the program transfers USDC directly to seller and
treasury. It does not transfer a token representing the Card.

1. Payment authority: settle now uses strict program/argument/account/CPI checks.
   DATABASE BLOCKER: a raw RPC reference still is not proof.
2. Attribution: configured-cluster finalized RPC, program/config PDA, buyer
   signer (sponsored fee payer permitted), mint, token program/owners, exact
   total/split, Card hash, account deltas and wallet deltas are checked. Exactly
   one top-level settlement invocation with its two matching token CPIs is
   required. Extra non-settlement instructions are allowed. Existing token
   accounts with pre/post evidence are required, matching current builder.
   Missing metadata, blockTime, or evidence fails closed.
   BLOCKER: quote/ABI has no unique attempt ID and binds no listing on chain.
3. Signature consumption: existing orders_settlement_ref_uidx (017) and
   ledger_sale_gross_settlement_uidx (016) are relied on, NOT reverified live.
   Cluster is not stored; the sol: prefix is not full payment evidence.
4. Retry: authenticate caller + original quote, then query by exact sol:signature
   before checking listing liveness. Require matching buyer/listing/reference
   and settled status. Re-read receipt after both successful and failed RPCs,
   including a competing request making the listing disappear during verify.
   Never return a mismatched RPC order ID on trust.
5. Recovery: finalized transaction inclusion within the original five-minute
   quote interval is accepted even after wall-clock expiry. HMAC authenticity
   and expiry are separate. Missing finalized data is retry-only, not evidence
   of failed payment. A late-included payment becomes an unresolved obligation.
   The interval is conservative legacy inference from expiresAt, NOT a nonce or
   exact signing-time proof. Current production issuer uses five minutes.
6. Races/cancellation: advisory reads reject unavailable claims, but cannot
   enforce atomic ownership or prevent chain payments. Errors explicitly signal
   retrySettlementOnly/recoveryRequired; this does NOT persist an obligation.
7. SQL must lock and validate Card owner/status and listing identity/state in
   the same transaction that consumes payment and transfers claim. Existing
   043 locks the Card but does not perform those checks.
8. Stripe containment: checkPayoutEligibility marks every candidate ineligible;
   executePayout independently reads the reference and refuses. USDC gets a
   specific refusal, missing/non-Stripe evidence is refused, and even pi_ orders
   remain dormant. No Stripe Transfer creation or paid_out updates remain in
   executePayout. Do not overload paid_out to mean chain payment.

## Direct database authorization: release blocker

021 defines the five-argument idempotency wrapper; 022 removes earlier cash
arities; 022b drops fn_purchase_card_with_credit and grants the five-argument
fn_purchase_card to authenticated and service_role. Core is service-role-only,
but the SECURITY DEFINER wrapper invokes it. 026 revokes anon/PUBLIC, leaving
authenticated grants intact. 041/043 replace core without closing this grant.

For a cash leg, core checks nonempty settlement_ref, not external payment.
025's self/admin payout-method reader prevents an ordinary buyer from settling
another seller's listing directly. It does not prevent the seller, acting in
their own session, from naming another buyer and an unsupported reference.
Admin contexts also pass that reader. The wrapper's early reference lookup
returns an existing ID without buyer/listing authorization. Route protections
do not close either direct RPC behavior. No live exploit probe was performed.

## Minimum human migration design (plain English; no SQL supplied)

- Durable purchase attempts, created by authenticated initiator only. Assign
  an opaque ID; bind buyer, listing and Card IDs; seller identity; immutable
  wallet addresses; network/cluster identity; program and config; token mint;
  integer MYR price; FX evidence; integer USDC total/net/fee; authorized interval;
  transaction/message reference and expected instruction version.
- Store authorization issued time and expiry explicitly. Do not infer them
  from a TTL forever. Never reread mutable user wallet links to define a paid
  attempt. New links affect new attempts only.
- Persist broadcast/payment evidence and verification slot/finality/time.
  Signature uniqueness belongs to network plus signature; one verified payment
  consumption authorizes one attempt/order. Record instruction index if future
  batching is supported. Enforce one order per attempt atomically.
- States: initiated/authorized; submitted; awaiting_finality; paid;
  settled; abandoned; expired_unpaid; unresolved; resolved. Timeout alone cannot
  transition submitted/unknown payment to a safely unpaid terminal state.
  A payment arriving after expiry/cancellation must become unresolved, not be
  discarded. Record resolution actor, reason, reference, and timestamps.
- Users initiate/read only their own attempts, and may attach candidate
  signatures without marking payment verified. Only the trusted verifier may
  record verified evidence and call paid settlement. Revoke legacy user cash
  settlement grants; drop obsolete overloads in the same migration.
- Settlement locks attempt/payment consumption, listing and Card in a
  documented consistent order. Validate exact seller ownership, eligible Card
  status, exact live listing and immutable amount. Redeem/trade/cancel must
  coordinate the same locks. Consume payment and update ledger/owner/provenance/
  order atomically. Idempotent lookup verifies buyer, listing, attempt and
  payment correspondence before returning the original result.
- Explicit immutable settlement rail and seller-settlement meaning: USDC orders
  record seller paid on chain and cannot enter Stripe. Preserve paid_out's
  historical Stripe-transfer meaning. MYR accounting does not describe USDC
  units or prove a held seller payout. Classify historical orders from evidence,
  not merely missing or client-supplied prefixes.
- A worker/reconciler owns submitted/paid/unresolved attempts independently of
  the browser. Recovery uses the original evidence/attempt, no new payment.
  Recovery reads and retries are authorized, and operational failures remain
  visible until a human/worker records a final resolution.

## Two buyers pay / architectural decision

Both buyers can receive valid quotes and pay on chain. Database locks can award
only one claim; the loser already paid. A database reservation, even with TTL,
cannot stop an already-signed transaction landing after cancellation/expiry.
The current program has no listing or attempt account, backend authorization,
deadline enforcement, replay consumption, or global sale exclusivity. The
verified Card hash alone does not solve this, and the quote does not bind it.

Recommend retaining direct USDC transfers only with an explicitly approved
on-chain sale authorization/exclusivity design: unique listing-generation and
attempt references, authorized immutable terms, chain-enforced deadline and
single consumption. Coordinate cancellation, claim reservation and fulfillment
across chain/database. Database may still fail AFTER chain success; durable
paid attempts must retry settlement, with an explicit operator resolution path
if claim state is irreconcilable. On-chain exclusivity does not by itself solve
cross-system cancellation ordering or lost database writes.

Alternative: retain current direct transfers, acknowledge multiple/late paid
attempts, and adopt a funded, staffed reconciliation/refund obligation. This
requires explicit product approval and the ability to recover money already
sent to seller/treasury; it is not an automatic refund implementation.
Escrow/platform custody is a different business/architecture decision and is
NOT introduced or assumed here. Do not claim first-sale seven-day holds when
the seller has already received USDC. Human must choose the model before launch.

## Required lane handoffs

Market: SolanaBuyPanel currently returns to ready after settle failure, so it
can pay again. After broadcast preserve original signature + attempt identity,
disable every signing path for that attempt and expose RETRY SETTLEMENT ONLY.
Never discard evidence when opening/closing checkout. Durable server attempts
must restore this state across tabs/devices/reloads; browser storage or logs
are convenience only. Present pending finality separately from verified unpaid
failure and unresolved paid attempts. Add an authenticated attempt-status API.
Needed paths are components/market/SolanaBuyPanel.tsx, CheckoutModal.tsx and
related bridge/status surfaces, outside this task's write scope.

Data/build: build-tx, quote issuer and SDK transaction builder must issue and
embed immutable attempt/listing bindings after migration/program approval.
app/api/solana/build-tx/route.ts, quote/route.ts, and lib/solana/sdk.ts were not
edited. Legacy fresh quote responses still omit the needed attempt binding.
Freeze historical verification config: current quote recovery still depends
on current wallets/program/treasury/mint/quote secret and can fail after changes.

Admin: build a minimal unresolved-payment queue using durable attempts, showing
chain evidence, intended claim, conflicting order and recorded resolution. No
automatic refunds, fabricated payment references, or ledger cleanup shortcuts.

Solana: approved exclusivity/authorization ABI, cancellation ordering and upgrade
plan. Mainnet feature is undeclared in current Cargo manifest. Initialization
authority and Squads administration remain independent launch blockers.

Stripe: this task disables outgoing payout execution, but dormant purchase/
redemption/Connect entry points elsewhere remain reachable. Do not enable them.
Their complete removal/gating requires separately assigned market/webhook work.

## Validation and limits

New tests exercise production strict verification, receipt orchestration, and
actual contract payout functions with isolated dependencies. Fixtures include
sponsored signing, extra instructions, wrong instruction/program/Card/signer/
mint/owner/amount/recipient, unrelated transfers, expired quote authenticity,
lost RPC response and concurrent duplicate requests. Mock persistence is NOT
proof of database uniqueness, locks, permissions, or two-buyers-pay safety.

Dependency files are unchanged and this worktree has no installed dependencies.
It does not include main's uncommitted memo 0.10.0 addition. Targeted validation
can use the already installed runner with explicit offline resolution aliases;
that is not validation of this branch's dependency graph. Standard checks need
human dependency preparation: preserve and review/commit the memo manifest and
lockfile changes in the human checkout, make the reviewed dependency pair
available here through an authorized integration step, then run npm ci in this
isolated worktree. Do not install from a lockfile known to omit the required memo
dependency or import the old data branch's ignore-TypeScript-errors change.

No environment files were loaded and no application/DB/network mutations were
invoked. No deployment or push is authorized. Exact check results are recorded
in the task delivery; no historical baseline is claimed as a current result.

Final offline results (existing Vitest 4.1.11 / TypeScript from main's installed
dependencies, explicit resolution back to this worktree, no installation):
- Dedicated production-code suite: 34 passed / 34.
- Full adapted suite: 396 passed, 2 failed / 398; 13 files passed, 1 failed.
  The final two are the existing FSC-copy assertions at invariants.test.ts
  lines 1901 and 1960, untouched. One interim full run reported two additional
  shared-test failures (4 total) that did not reproduce on the final full run;
  their cause was not established. Do not call the suite clean.
- Adapted no-emit compiler check: 3 TS2749 diagnostics, in untouched sign-in and
  sign-up pages (PageProps at line 20) and root layout (LayoutProps at line 41).
  No task-file diagnostics remain. This is NOT standard npx tsc validation.
- Standard npx tsc --noEmit, npm test, npx next build --webpack: NOT RUN because
  this branch has no installed dependency tree. No build was attempted using
  shared credentials or main's copied dependency tree. git diff --check passes.

New production helper exports (existing/frozen signatures unchanged):
- inspectPurchaseTransaction(tx: PurchaseTransaction, signature: string,
  expected: PurchaseBinding): Promise<string | null>
- verifyPurchaseTransaction(signature: string, expected: PurchaseBinding,
  fetchImpl?: typeof fetch): Promise<VerifyResult | VerifyFailure>
- verifyQuoteSignature(q: Quote): Promise<boolean>
- authorizedPaymentOrder(order: PaymentOrder, identity: PaymentIdentity): boolean
- recoverOrSettlePayment(identity: PaymentIdentity,
  deps: PaymentSettlementDependencies): Promise<string>
- stripePayoutBlockReason(reference: string | null): string
Supporting interfaces are exported alongside their helpers for typed adapters
and offline fixtures. The legacy delta-only verifier remains for compatibility;
it is explicitly documented as unsuitable for authorizing payment settlement.
