# Payment security: seller-held escrow and vaulted direct-sale contract

Design revision: 2026-10-15, starting HEAD 93d4e31bcf2fb467df051e7ae6976740957a98f8,
track/payment-security, C:/Users/Family/flexsoar-payment-security. Local main is
still e62795ba3d05d5face22456535f755476a86974c; HEAD..main is empty. This revision
changes documentation ONLY. Proposed contracts below are not deployed behavior.

## Approved business model and release boundary

The founder approved SELLER-HELD FIRST-SALE ESCROW and ALREADY-VAULTED DIRECT
95/5 RESALES. This supersedes vaulted-only launch and the earlier direct-only
architecture in 93d4e31. Seller-held inventory may list before reaching FlexSoar;
funding reserves the buyer's claim, locked until exact-pair acceptance and
finalized release reconcile. Accepted first sale releases 95% seller / 5%
treasury. Seller default or authentication failure leads to refund/cancellation
under an explicit policy. Approval does NOT authorize deployment, funds movement,
or the proposed deadlines, fees, refund/dispute rules or authorities below.

PUBLIC PAYMENTS REMAIN BLOCKED pending program/database/UI implementation and
validation. Current settle route still refuses unrecorded legacy settlement,
and supports authenticated exact buyer/listing/signature/status receipt lookup
with receiptOnly=true, paymentVerified=false. Do not deploy that refusal alone:
current builder/UI can still send money. No production behavior changed here.

## Current source evidence and migration hazards

- solana/programs/flexsoar-settlement/src/lib.rs buy:78 only transfers directly
  and ignores vault_ref. No escrow, consumed sale or acceptance/refund state
  exists. Sale/program changes below are NEW contracts, not inferred capabilities.
- 023c_vault_custody.sql has pending_vault, vault_intakes, and tracking states.
  fn_vault_receive currently marks received, stamps authenticated_at/by and
  unlocks Card immediately. Receipt MUST NOT imply authentication or release
  in the new model. Preexisting authenticated_at is insufficient: 041 approval
  stamps it for a seller-held submission before physical receipt.
- 023c fn_vault_mark_defaulted accepts both awaiting_shipment and in_transit
  when due_by passes; fn_confirm_sale_cancellation trusts a refund string,
  mirrors accounting, burns Card, marks item returned and can ban consignor.
  Neither proves USDC refund or actual return of shoes. The existing 48-hour
  clock conflates dispatch and arrival. Replace, do not reuse blindly.
- trg_open_vault_intake skips if ANY prior intake ever existed, not just an
  active one. New intake must bind the current winning sale/attempt/pair;
  historical intake is not sufficient acceptance or a reason to skip locking.
- 032 fn_list_card leaves relisted Card active; 041 approval locks it; 048
  fn_redeem_card and 024b trade entry points rely on active-status checks.
  All paths, including outstanding offers/alternate RPCs/direct updates, need
  the same reservation/generation/escrow locks, not status checks alone.
- 043 purchase core locks Card but lacks owner/status checks; 021 wrapper plus
  022b/026 grants retain authenticated reference-only settlement. Human must
  close ALL overloads/default routes. Checked-in SQL is intent, not live proof.
- 050 payout_release_at change and 057 fee settings are accounting metadata,
  not escrow or evidence of seller USDC delivery. Stripe eligibility/execution
  remains blocked by contract.ts; paid_out retains Stripe meaning.
- Prior review verified strict instruction/CPI attribution, buyer signature
  despite fee sponsorship and conflict-aware receipt retries in isolated tests.
  Legacy quote/card-hash ABI lacks attempt/network/custody binding. Those
  helpers cannot authorize new paid settlement or represent escrow funding.
- Other tracks' handoffs were previously read and remain unchanged from base;
  their old Stripe/FSC/receipt-unlocks descriptions are historical, not this
  approved money model. No live schema/program/customer records inspected.

## Immutable sale modes and common authorization

Names below are proposed versioned contracts, not existing exports/signatures.

| Mode | Authoritative eligibility | Atomic winning buy | Buyer claim after DB reconciliation |
|---|---|---|---|
| seller_held_escrow | Exact Item in verified seller custody, seller owns Card, approved submission, no other funded sale/reservation/fulfillment lock | Consume shared sale AND debit full USDC into that sale's program escrow | Reserved for winning buyer, pending_vault; no transfer/list/trade/redeem until accepted release is final and reconciled |
| vaulted_direct | Exact Item physically warehouse-held AND acceptance current/valid, current owner sells, no unresolved escrow/reservation/dispute/fulfillment lock | Consume same kind of shared sale AND atomically transfer 95/5 | Paired ownership ledger transfer and active Card; resale allowed after reconciliation |

Mode is derived by a locked database custody/acceptance operation, mirrored by
a separately authorized inventory attestation on CardControl, and copied into
Sale and signed permit. Client never supplies/selects it. Program checks mode
against CardControl custody version and Sale snapshot; an ordinary issuer may
not mark seller custody as warehouse. Warehouse RECEIPT alone is not warehouse
ACCEPTANCE. Unknown/inconsistent custody blocks authorization, not a direct-sale
fallback. Once funded, the sale's mode cannot change even when shoes arrive.
No conversion of escrow funds into direct-sale funds or replacement sale.

Custody attestation binds Item/Card/pair fingerprint, seller/holder, custody
state and monotonic version, acceptance evidence, issuing staff authority and
domain. Inventory authority is distinct from permit issuer. Before changing
custody/owner/price/eligibility on an OPEN sale, stop permits and finalize the
on-chain generation/revision fence. An executed winning buy takes precedence
over a database-only cancel. A funded sale cannot be revoked as if unpaid;
seller-held cancellation goes through controlled refund. Direct terminal
payments cannot be clawed back through escrow instructions.

One Sale PDA per immutable listing UUID/generation, NOT per buyer. One current
sale per Card via CardControl fencing. All buyers' permits use the same writable
sale; only one transaction can change open -> consumed. For escrow, consumption
and full funding are atomic; for direct, consumption and BOTH transfers are
atomic. Failed second transfer/funding rolls back state and token movements.
Competing loser may pay a SOL network fee, never a second USDC purchase.
Consumed/refunded/revoked sale IDs never reopen. A reconciled future resale is
a NEW sale generation, not permanent consumption of the Card. Relisting after
refund requires separate review; no automatic replacement sale bypass.

Permit issuer signs only after durable attempt terms commit. Recommended permit
mechanism remains canonical domain-separated Ed25519 authorization, checked by
program against a real Ed25519 verification instruction and instruction sysvar,
exact bytes/offsets/key version. HMAC alone is insufficient. Bind protocol/ABI,
genesis/domain/program/config, sale/generation/revision, mode/custody version,
Item/Card/pair digest, attempt/authorization IDs and opaque beneficiary identity,
buyer wallet/source/refund account, seller/treasury wallets and recipient accounts,
mint/token program, integer total/net/fee, fee rule, policy version/digest,
valid-from/expiry and immutable attempt digest. No PII on chain. Program uses
Clock at execution; recovery of valid execution never depends on current quote
expiry. Genesis is pinned config domain plus verifier RPC identity check, not
something this instruction can discover intrinsically.

Same permit/another transaction cannot fund twice. Valid permit for other Card,
sale, buyer, mode, network or generation must fail. New wallet links, treasury
changes, FX changes and authority rotation never reinterpret a funded purchase.
Buyer remains signer with optional SOL sponsor; sponsor gains no claim/refund
right. A DB reservation cannot prevent an already-signed transaction landing:
the chain consumption, execution expiry and revision fence are mandatory.

## Program accounts, balances and instruction contract

| Account | Required invariant / contents |
|---|---|
| Config PDA | Protocol/domain/mint/token program and supported ABI; bounded issuer/lifecycle/inventory/receipt/authentication/release/refund/dispute roles with key epochs; governance/pause policy. Issuer is NOT withdrawal authority. |
| CardControl PDA | Opaque Item/Card/pair commitment, monotonic custody/acceptance version, current sale generation, unresolved-claim fence. No NFT and no independent replacement for Postgres ownership ledger. |
| Sale PDA | Immutable listing/generation/mode/custody snapshot, seller/treasury bindings, revision; open/revoked/consumed; winning attempt/beneficiary/terms digest and execution evidence. Winner cannot be overwritten. |
| Escrow PDA | One per sale, initialized/funded only by winning escrow buy; immutable buyer/refund/seller/treasury/mint/accounts/total/split/policy/digests; funded slot/time, receipt/authentication evidence and revisions, dispute hold, disposition revision/kind, terminal outcome/amounts/slot. |
| Escrow token account | SPL Token-owned token account for pinned six-decimal USDC mint; token AUTHORITY is escrow PDA, whose DATA account is program-owned. No operator, issuer, seller, buyer or treasury key owns withdrawal authority; no external delegate/close authority. Per-sale isolation, not pooled seller balances. |
| Terminal tombstone / durable outcome | Retained consumed sale and release/refund outcome sufficient to prevent PDA closure/recreation replay and support scanning. Closing rent accounts must never reset generation/consumption. |

Use deterministic per-sale escrow authority/USDC account, created in winning
funding transaction or precreated with rigorously checked authority/mint/state.
Never adopt arbitrary preexisting accounts or init-if-needed over terminal state.
Funding records exact received principal and requires buyer source ownership,
signer, mint and amount; reject Token-2022/unsupported fee-bearing extensions
unless separately designed. ATAs for buyer refund/seller/treasury are frozen in
terms. A missing/closed destination may be recreated at that SAME derived address
for the SAME owner/mint using a sponsor; no mutable wallet-link substitution.
Compromised/lost original destination requires a separately approved recovery
policy, not an administrator-supplied alternate destination.

At funding: escrow principal=total, seller=0, treasury=0. At release: exactly
net=total-floor(total*500/10000) to seller, fee to treasury, principal liability
zero. At refund under recommended full-refund policy: exactly total to original
buyer destination, seller/treasury=0, principal liability zero. Fees cannot be
taken early or used for rent. Release/refund use stored amounts, never current
price/FX or caller amounts. Rent/transaction SOL is a separate operational budget.
Unsolicited token dust is NOT another funding or spendable escrow entitlement;
principal stays fixed, balance must cover it. Do not let dust block principal
resolution or sweep it through arbitrary-admin withdrawal. Excess disposition
and account closure need a separate auditable governance policy; leave excess
isolated until approved. Pending principal cannot be swept under any such path.

Proposed instruction interfaces (semantic input contracts, no Rust/SQL authored):

| Instruction | Signer / guards / atomic effect |
|---|---|
| initialize_v2 / configure_roles | Intended bootstrap authority restricted in program, then Squads-governed role/config changes. Separate payer from admin; no first-signer takeover. Cannot retarget existing escrows. |
| register_existing_inventory / attest_inventory | Scoped inventory authority records exact pair/custody version; cannot bypass active-sale fence. Initial warehouse-accepted bootstrap also requires independent authentication/acceptance approval; receipt or inventory signer alone cannot create accepted eligibility. No funds move. |
| open_sale / revoke_sale / revise_sale | Lifecycle authority plus valid inventory snapshot; one current generation. Mode derived by program from attested custody. Revocation/revision affects only unconsumed sale and fences stale permits. |
| buy_sale | Buyer plus verified issuer permit; shared Sale/CardControl write locks; mode branch internally, no client choice. Escrow branch creates/binds/funds Escrow and consumes sale. Direct branch consumes and splits. |
| record_receipt | Scoped receiving authority, exact funded sale/attempt/intake/pair and evidence digest; no payout, unlock or automatic authentication. Receipt binds custody revision. |
| record_authentication | Scoped authenticator, matching receipt/current escrow/pair and signed result/evidence version. Pass/fail recorded separately; failure cannot authorize release. Corrections append versions, never erase evidence. |
| set_dispute_hold | Scoped incident/dispute authority; specific escrow, reason/evidence/version; stops outgoing execution while effective. Users REQUEST review, cannot arbitrarily drain or permanently freeze another user's escrow. |
| authorize_release | Independent release controller, valid matching receipt AND current successful authentication/final DB acceptance digest, no effective hold, no refund disposition, expected decision revision. Stores exact release decision; cannot move arbitrary amounts/destinations. |
| authorize_refund | Recommend Squads-controlled refund decision at launch, reason/policy/evidence digest, no terminal outcome, expected decision revision. Full principal to immutable buyer only; no payout/release simultaneously. Timeout alone is not on-chain proof of non-dispatch. |
| resolve_dispute | Squads-controlled adjudication, evidence/policy and expected revision. May maintain hold or supersede UNEXECUTED disposition by incrementing revision. Release still requires valid receipt/pass/acceptance; cannot rewrite failed result into pass. Terminal outcomes cannot be reversed. |
| execute_release / execute_refund | Any relayer after valid on-chain decision, expected disposition revision, no applicable pause/hold; stored accounts/units only. One shared Escrow lock, terminal compare-and-set and token transfers in same transaction. Record terminal outcome atomically; reject stale/opposite/repeated requests without transfers. |
| acknowledge_claim_resolution | Constrained reconciler, matching terminal chain outcome and DB reconciliation digest; clears current-sale fence only after DB commit. Does NOT pay, change beneficiary or reopen sale. Refund leaves quarantine/review fence unless separately cleared. |
| set_pause / resume | Guardian may only engage defined pause flags; Squads controls resume and role recovery. No sweep or arbitrary withdrawal. |

Program cannot inspect Postgres or physical shoes. Receipt/authentication/release
signatures are trusted staff attestations, verified against enrolled on-chain
roles; an evidence hash alone proves neither truth nor staff authorization.
Persist attestations in DB BEFORE signing. Bind every attestation to this escrow,
winning attempt, physical-pair commitment, intake and revision, not a reusable
Item authenticated_at boolean. Ordinary issuer cannot attest acceptance or fund
withdrawal, alter escrow bindings, approve disputes/refunds, or change roles.

Pair evidence must include original consignment identity, both shoes' identifying
details, size/model/labels, original submission photos, parcel seal/label and
recorded unboxing/condition comparison. SKU equality is not pair identity. Staff
records receipt mismatch or materially different condition as a hold/review, not
substitution or repricing. Existing Card grade immutability must not be bypassed
to make a mismatched pair pass; final acceptance criteria and buyer-consent rules
for material discrepancies belong in the approved policy. Chain stores opaque
commitments, while controlled DB evidence supplies the inspection audit trail.

Already-vaulted legacy inventory needs reviewed enrollment into CardControl:
verify physical stock, current ledger owner and acceptance evidence using the
independent inventory/authentication approval path. Do not infer warehouse
acceptance from an old authenticated_at timestamp or import arbitrary client
flags. This bootstrap does NOT turn a legacy payment into escrow funding.

## Explicit on-chain state machine and authority matrix

Sale: preparing/open (chain only open after committed DB intent) -> revoked OR
consumed_direct OR consumed_escrow. No consumed -> open transition.
CardControl keeps an unresolved-sale fence until outcome AND DB reconciliation.

Escrow lifecycle:

1. Unfunded -> funded_awaiting_receipt by winning buy; disposition=none.
2. Funded -> received_pending_auth on valid receipt. Dispatch/tracking itself
   does not produce receipt or release authority.
3. Receipt -> authentication_passed OR authentication_failed; disputes can hold
   a funded escrow at any nonterminal stage. Only passed + matching final
   acceptance may proceed toward release. Failed stays locked for review/refund.
4. Eligible funded escrow -> release_authorized OR refund_authorized through
   bounded authorities. Refund can cover non-dispatch without receipt, or
   rejection/loss under approved policy. A normal auth failure cannot authorize
   later release without a new valid reviewed authentication revision.
5. Execution -> released OR refunded, atomically with transfers. Mutually
   exclusive terminal outcomes forever. Failed transaction leaves prior state.
   Exact retries query the original outcome; no second money movement.

Represent physical/auth stage, dispute hold and disposition as separate fields,
not one ambiguous paid status. Disposition has a monotonic revision. Ordinary
controllers cannot authorize both branches. Squads can supersede an unexecuted
decision only by a new audited revision while held; old signed executions then
fail. If execution lands first, the terminal outcome wins and supersession
fails. A DB refund request or UI dispute is not an effective chain fence.

| Actor | Permitted | Explicitly prohibited |
|---|---|---|
| Buyer | Session-bound initiation, buyer signature, own receipt/status, dispatch/default/dispute requests | Choosing mode/amount, release approval, unilateral refund, changing destination after funding |
| Seller | Listing own eligible pair, tracking/evidence submissions, own order/dispute access | Receipt/authentication self-certification, USDC withdrawal before acceptance |
| Permit issuer | Sign committed purchase permit and limited lifecycle operations if assigned | Escrow withdrawal/acceptance/refund, role/config changes, custody promotion |
| Warehouse receiver | DB physical receipt and scoped chain receipt attestation | Stamping auth pass, payout approval, unlock on receipt |
| Authenticator | Exact-pair examination and versioned pass/fail evidence/attestation | Payment execution approval alone, editing buyer/seller/mode, erasing failed inspection |
| Release controller | Approve release only for committed final acceptance + receipt/pass | Arbitrary withdrawal or refund; self-approving issuer terms as acceptance |
| Refund/dispute controller | Recommend Squads threshold approval of full refund/resolution at launch | Alternate beneficiaries, partial deductions, refund after release, release after refund |
| Reconciler/relayer | Read finalized chain, idempotent DB consumption, execute already bounded decision, acknowledge outcome | Manufacturing verified evidence, selecting amounts, deciding dispute, paying twice to repair DB |
| Guardian | Pause new buys; request incident/dispute hold under scoped policy | Resume, redirect funds, key rotation or sweep |
| Squads governance | Role rotation, pause recovery, dispute decisions, deployment/upgrade governance | No generic runtime principal sweep; existing bindings enforced by current program |

Recommend release controller is a different human/key from permit issuer AND
authenticator (two-person acceptance/release control); staffing and exact
threshold need approval. Receiving/authenticator may be distinct roles even if
staffing overlaps, but receipt never substitutes for examination. Staff DB
sessions, enrolled signing roles and authenticated decision IDs must map in an
audited directory; Supabase is_admin alone is not a Solana signature.

Squads must control the appropriate vault PDA authority via its execution/CPI
mechanism, not merely a receiving wallet label. Key initialization/admin transfer
must be implemented and tested. Program upgrade authority can change enforcement
and ultimately access escrow: disclose governance trust, threshold, change review
and any approved timelock; runtime restrictions do not make an upgradeable system
trustless. Do not give unrestricted keys to cron workers or browser sessions.

Pause proposal: independent new-funding and escrow-outflow flags. Normal purchase
pause blocks both buy modes but keeps previously authorized release/refund and
read/reconciliation working. Suspected escrow vulnerability can pause outflows
too; funds remain in their PDA, Card stays locked, obligations stay visible,
Squads investigates/resumes a bounded resolution path. No automatic deadline
refund bypasses an outflow pause. Set an incident review SLA and communicate
delay; no emergency withdrawal-to-treasury escape hatch. Existing authorities
must remain recoverable if an operational key is lost/revoked.

## Database implementation contract and Card controls

All names are proposed additive contracts; do not change frozen signatures.
Human authors migrations in plain-schema review later. No SQL is provided here.

| Entity | Required durable fields / constraints |
|---|---|
| sale_authorizations | Listing/generation/Card/Item/pair commitment, seller, authoritative mode/custody/acceptance version and attestor; program/domain/PDA/revision; open/consume/revoke states and outbox evidence. One current generation per Card; never reopen consumed sale. |
| purchase_attempts | Session buyer/idempotency key, sale/attempt/authorization IDs, immutable canonical terms/digest, mode/policy version, frozen wallets/ATAs/mint/program/domain/config/key versions, integer MYR sen and FX snapshot/rounding, integer USDC units/split/interval; submitted candidates, winner/order link and recovery state. |
| verified_chain_events | Genesis/program/sale/escrow, kind (fund/direct/release/refund/receipt/auth/dispute), signature/instruction/slot/time/finality, exact immutable terms/units/accounts/result, verifier/version/evidence digest. Client signature is only a candidate, never verified evidence. |
| escrow_purchases | One per winning sale/attempt/order; Escrow PDA, principal/split/destinations, funding evidence, physical/auth stage, hold/disposition revision, release/refund intent and finalized outcome, DB reconciliation state. No caller-editable paid/refunded flags. |
| vault_intakes and evidence | Intake/order/attempt/escrow/Item/Card/pair foreign keys; dispatch due separately from transit review date; tracking/carrier scans and verification provenance; received parcel/contents/location/staff/time, item identity evidence, independent auth verdict/version, final acceptance decision. Open-state uniqueness includes received_pending_auth, disputed, release/refund pending, not just shipping states. |
| escrow_decisions | Unique command/decision ID, escrow and expected revision, action, policy/reason/evidence hashes, staff identities/signing role/approvals, accepted/rejected/superseded state, timestamps; immutable prior versions. |
| chain_operations / outbox | Decision and immutable payload digest, nonce/revision, signed-message identity when available, every candidate signature/last-valid height, retries/lease/deadline, observed final outcome and reconcile job. Persist BEFORE external signing/broadcast. Operation ownership is server-durable. |
| claim_reservations / ledger/provenance | Winning buyer/sale/attempt/conditional entitlement and lock, associated paired ownership entries and pending lifecycle, terminal resolution event. Ownership cache updated with ledger in same transaction. |
| orders and seller settlement | Separate buyer funding, seller delivery and claim lifecycle. Immutable rail=solana_usdc plus mode, attempt/escrow/evidence FKs; funded/in_escrow/released_direct/released_escrow/refunded meaning explicit. paid_out/stripe_transfer_id remain Stripe fields, never repurposed. |
| dispute/audit events, notifications and scan cursors | Append-only reasons/evidence/actors/approvals/action/result; responsible operator/SLA; transactional notification jobs and per-network/program reconciliation checkpoints/backfill. |

Uniqueness: one winning attempt/order/escrow per sale; one order per attempt;
one escrow terminal outcome; unique (genesis, signature) payment consumption
for one-purchase-per-transaction launch, with instruction index retained as
evidence; unique domain/program/authorization ID and buyer initiation key;
unique escrow/action command ID and monotonic disposition revision. Verification
event uniqueness can include instruction/event kind without consuming a purchase
again on release/refund. Financial evidence, terms and references cannot be
deleted or rewritten to make a payment reusable. Foreign keys enforce matching
sale/attempt/pair/escrow/order, not merely independently valid UUIDs.

Proposed DB state axes (new fields/enums need human migration, not assumed live):

| Axis | Transitions and authoritative evidence |
|---|---|
| Attempt | initiated -> authorized -> submitted/awaiting_finality -> funded_escrow or paid_direct -> reconciled; escrow later completed_released or cancelled_refunded. Watcher may discover a winner directly from authorized. abandoned_unissued is safe only before permit publication. expired_unfunded needs chain expiry/revocation AND finalized non-consumption, never a browser timeout. |
| Seller settlement | held_in_escrow -> release_pending -> released, or held_in_escrow -> refund_pending -> not_payable_refunded. Direct winner -> released_direct after verified split. Store original funding history; refund is not evidence that no payment happened. |
| Claim | sale_locked -> reserved_pending_vault -> accepted_locked -> active after finalized release reconciliation; or reserved/accepted_locked -> refund_pending -> cancelled_quarantined after finalized refund. Conflicts -> unresolved_locked. Direct winner -> active only after atomic DB ownership reconciliation. |
| Physical intake | awaiting_dispatch -> dispatch_evidence_pending -> in_transit -> received_pending_auth -> authentication_passed or authentication_failed; recorded final acceptance/rejection and separate return_pending/returned physical evidence. A late/unscanned receipt can be recorded without inventing prior carrier events. |
| Dispute | none -> requested -> hold_pending -> held -> adjudicated -> outcome_pending -> resolved; chain hold is effective only after chain confirmation/finality policy. Track request and actual hold separately so UI cannot promise a fence that does not exist. |

No operational due date can move a FUNDED attempt to expired_unfunded, and no
intake state by itself makes seller settlement released or claim active.
Expose authenticated attempt/order status by these distinct axes; API/UI errors
after broadcast must preserve attempt and candidate evidence, indicate pending
or resolution-required, and offer no replacement payment. A failed unexecuted
release/refund command can be retried; a successful terminal transfer cannot.

Recommended claim representation, consistent with existing pending_vault UX:
verified escrow funding atomically appends paired conditional Card ownership
transfer seller -> buyer, updates owner_id=buyer and status=pending_vault,
creates the buyer reservation/intake/order and marks listing consumed. This is
a CONDITIONAL locked claim, not a completed seller settlement or tradeable Card.
No second Card/item is minted. On refund reconciliation append paired reversal
buyer -> original seller (do not erase history), cancel buyer reservation/order
and quarantine/retire availability pending review. Do not automatically burn
the shoe, mark physically returned, ban seller or relist. The Card remains
1:1 with its original Item; rejected goods cannot regain active status through
refund. This is the proposed bookkeeping representation, not a new claim that
the legacy seller-held direct payment was escrowed.

Before ANY permit is issued, lock/fence that Card for its active sale in DB so
DB failure after chain funding cannot leave it tradeable. A buyer-specific
temporary reservation is optional; it cannot substitute for shared chain
consumption. On finalized direct sale atomically consume evidence, paired
ownership transfer, provenance, seller settlement and Card unlock. On escrow
funding atomically consume FUNDING evidence and conditional claim only: no
seller revenue delivered, treasury fee received or payout eligibility yet.

Separate USDC movements in exact base-unit accounting from MYR valuation:
funding records buyer -total / escrow +total; release records escrow -total /
seller +net / treasury +fee; refund records escrow -total / buyer +total. Each
asset's entries balance and reference verified chain evidence once. MYR sen
order/FX snapshots remain immutable; do not put USDC units in *_cents or record
escrow as earned treasury revenue. Any required USDC asset/entry types and
escrow account semantics need human schema/accounting review. No FSC issuance
or Stripe geography payout for these USDC flows. A balanced ledger alone still
does not establish chain movement or physical acceptance.

Proposed operations (semantic signatures, implement later):

- initiatePurchase(session, listing, idempotencyKey): authoritative locks and
  eligibility, derive mode, commit immutable attempt and sale fence. No caller
  buyer/mode/price authority. Returns same attempt on authorized exact retry.
- recordVerifiedPurchase(chainEvidenceId): verifier-only; atomically locks
  Item/Card/sale/attempt/payment, validates winner/mode/owner/terms, consumes
  payment and creates conditional escrow or completed direct outcome. Existing
  receipt returns only after full buyer/listing/attempt/domain/evidence match.
- recordVaultReceipt(intake, physicalEvidence, staffSession): warehouse role,
  exact parcel/contents/pair match; set physical warehouse custody but NOT
  accepted/unlocked. Commit receipt evidence and chain-attestation outbox.
- recordAuthentication(intake, receiptVersion, verdict, evidence, staffSession):
  authenticator role, exact current purchase/pair; no use of historic submission
  approval flag. Failed verdict remains locked/rejected; may open review.
- approveAcceptanceAndRelease(escrow, inspectionVersion, decisionId, staff):
  independent release approval, no conflicting hold/refund, authoritative
  custody/auth check under locks; commit final acceptance and release intent.
  Worker must reconcile required receipt/auth attestations before release.
  This records an obligation to release; it does not mark seller paid.
- requestRefundOrDispute(escrow, reason, evidence, session): record request and
  notify reviewer, never mark refunded or sign a withdrawal. Controlled
  approveRefund / resolveDispute persists policy/approvals/expected revision,
  confirms required chain hold/fence before superseding a disposition.
- reconcileEscrowOutcome(verifiedEventId): verifier-only, idempotent full
  correspondence; terminal chain release + matching final acceptance/warehouse
  evidence atomically records delivered seller funds/fee and unlocks buyer Card.
  Terminal refund atomically cancels/resolves conditional claim and money legs.
  Conflicts freeze and create an unresolved obligation, never another payment.
- acknowledgeClaimResolution(outbox): after committed DB outcome, clear chain
  fence with matching immutable resolution digest; no token movement.

Lock all relevant objects in a consistent global order (Item/Card IDs sorted,
then listing/sale, attempt/escrow/evidence, intake/decision, user/account rows).
Trades involving multiple Cards lock sorted IDs. Retries cannot evade actor or
identity checks; unique-violation handlers must compare original result rather
than swallow conflicts. Ownership/status/custody checks happen UNDER these
locks. No status-only unlock or alternate owner-cache update.

Replace/restrict legacy fn_vault_receive, trg_hold_card_pending_vault and intake
opening: receipt must not unlock; hold includes ALL funded unresolved states.
fn_authenticate_item / fn_approve_submission cannot bypass final escrow acceptance;
fn_vault_mark_defaulted cannot default parcels solely because arrival misses
dispatch due_by; fn_confirm_sale_cancellation cannot accept arbitrary refund
strings for v2. Revoke user-accessible reference-only fn_purchase_card/core and
all obsolete overloads/default-argument paths, including fn_purchase_card_with_credit
if still live; move v2 to evidence-ID operations with narrowly assigned verifier
role. Retire legacy service shortcuts too, after legitimate callers are accounted
for. Audit live catalog/grants as human, not assumption from migrations.

fn_list_card, fn_cancel_listing, fn_redeem_card, fn_create_trade_offer,
fn_accept_trade_offer, submission/mint/reject/custody-change and direct table
permissions must all reject funded/reserved/pending/disputed/release-unreconciled
claims, even if status accidentally appears active. Existing offers cannot settle
across the fence. Finalized release plus acceptance AND DB reconciliation is the
only normal escrow unlock. Failed auth never unlocks. Already-vaulted resale
requires previous fence resolved and a new immutable generation. Seller cannot
cancel or substitute another pair/sale after funding.

## Cross-system recovery and race contract

Solana and Postgres do NOT share an atomic transaction. Always persist business
intent, immutable message/decision identity and outbox BEFORE signing/broadcast;
observe finalized chain outcomes, then atomically reconcile DB. A worker may
retry bookkeeping or an unexecuted SAME on-chain command, never repay/refund
again to make records agree. Already-terminal retry returns original outcome;
chain program independently rejects extra transfers. Missing RPC result is
unknown, not failed/unpaid. Re-sign only an unchanged eligible command after
querying state/candidates; terminal compare-and-set prevents repeated funds.

| Failure / race | Durable recovery; what stays locked |
|---|---|
| Escrow funded, DB response/update fails | Sale/attempt fence already committed before permit; watcher discovers consumed Sale/Escrow and exact winner without browser. Retry funding-evidence DB consumption, not buyer payment. Conditional Card remains unavailable until recorded. |
| Acceptance committed, release fails | Acceptance/release intent and decision ID survive. Check receipt/auth attestations, pause/hold, destination accounts and chain outcome; retry SAME eligible release command if still unexecuted. Seller remains unpaid and Card locked. Auth failure cannot be papered over. |
| Release final, Card unlock DB write fails | Escrow already released; watcher consumes exact release event, atomic seller/fee accounting and unlock. Do NOT execute another payout. If claim mismatch, unresolved freeze/escalation, not silent overwrite. |
| Refund final, cancellation DB write fails | Refunded principal already delivered; watcher retries bookkeeping/conditional ownership reversal/quarantine. No second refund, no new listing or physical-return assertion. |
| Browser closes or worker restarts | Durable attempts, decisions, candidate signatures and scan cursors resume independently of session/browser. Users recover their attempt by account, even after quote expiry/wallet relink; original destinations stay fixed. |
| Release/refund/dispute requests race | DB locks serialize intents; actual chain shared Escrow lock and expected disposition revision serialize outcomes. Chain hold/supersession must finalize to defeat an old signed execution. Terminal winner prevents other branch; record losing request/conflict explicitly. No priority claimed for a merely recorded DB refund. |
| Normal pause while funded | Stop new buys; allow bounded authorized exits and all observation/reconciliation. Never expire funded escrow to unpaid. |
| Emergency outflow pause or authority outage | Funds remain in escrow; obligations/alerts visible and Card locked. Governance rotates roles or resumes audited exit path; no automatic fallback withdrawal/refund or clock-based unlocking. |

Watcher scans retained Sale/Escrow state plus events and finalized transactions
using durable per-domain cursors, overlapping scans, retries and backfill; events
alone are insufficient when RPC history is missing. Keep archival access and
evidence digests/versions. Funding/release/refund evidence must inspect expected
program instruction, mode/state transition, signer/authorized decision, mint,
accounts, exact amounts and scoped CPIs, not just balance deltas. Direct mode
requires both transfers; escrow funding requires escrow credit; release/refund
cannot masquerade as a new purchase. Quote expiry does not invalidate valid
earlier execution. Config/wallet rotations use frozen historical bindings.

Late parcel: after refund authorization, receipt cannot authorize release;
after refunded terminal state, any arrived pair is quarantine/return evidence,
not a new sale or reason to charge buyer. Authentication dispute on a direct
sale AFTER irreversible direct payment is a separate post-sale policy question,
not access to a nonexistent escrow. Do not promise automatic direct-sale refunds.

## Policy proposals — founder approval required before encoding

These are recommended DEFAULTS, not approved terms, deployed timers, automatic
deductions, existing program functionality or legal findings. Version the final
accepted policy and bind its hash/rules to each sale/permit/escrow. Never apply
new deadlines or fees retroactively to already-funded attempts.

| Topic | Concrete proposal | Safety / approval boundary |
|---|---|---|
| Dispatch | Carrier takes possession within 48 elapsed hours of finalized escrow funding, plus a 24-hour evidence/correction grace window before default review. Notify immediately with exact MYT timestamp. | Dispatch means actual handover, not arrival at vault. Platform notification/instruction outage or documented closure requires a recorded extension/review, not silent automatic seller default. Policy must define holidays/exceptions. |
| Acceptable tracking | Supported carrier, unique tracking tied to this intake, destination matching FlexSoar, carrier pickup/acceptance scan with timestamp; or independently reviewed drop-off receipt plus parcel/label evidence pending scan. | Label created or arbitrary tracking text alone is NOT dispatch. Verify provenance/duplicate use/mismatched destination. No customer address/PII on chain; store controlled evidence and digest. Missing carrier API/lag -> review, not fabricated scan. |
| Transit | With verified carrier possession, enter in_transit; dispatch timer no longer determines default. Review at 7 calendar days after pickup for Peninsular Malaysia, 14 for East Malaysia routes; seek carrier trace and notify buyer/seller. | Review trigger is not refund permission. Escalate unresolved trace after another 7 calendar days; a reviewer decides loss/delay and any extension under approved policy. No automatic refund because parcel has not arrived by dispatch deadline or transit review date. |
| Authentication | Log receipt/unboxing same business day; target completed examination within 2 Malaysian business days of verified physical receipt. | Receipt and examination separate. At missed SLA notify/escalate, funds stay held; platform delay does not default seller or unlock Card. Define business-day calendar in final policy. |
| Buyer refund | Full original USDC principal, including unreleased 5% allocation, to immutable original buyer destination on approved default/rejection/loss. Zero marketplace/cancellation deduction. | No fee was earned/released first. Do not refund MYR-equivalent at new FX or deduct shipping/network costs from principal. Partial refunds are OUT of initial program scope unless separately approved/designed. |
| Network/rent and inbound shipping | Seller pays dispatch to FlexSoar; platform budgets program rent and release/refund execution fees; buyer initially pays only disclosed purchase network fee if not sponsored. | Recommend platform sponsorship to avoid charging buyer to receive refund. Original network fee is not recovered from escrow; any compensation is a separately approved payment, never a deduction or double refund. Carrier insurance/liability on loss needs explicit terms. |
| Rejected shoes and auth dispute | Notify seller/buyer with evidence; allow 48 hours to challenge a preliminary failure, then a second qualified examiner independent of first. Target resolution within 5 business days. | Hold funds/Card during review; SLA breach escalates, never implies auth pass. Final rejection refunds buyer even if physical seller return logistics remain open. Confirm exact return policy before launch. |
| Return costs | Recommend seller bears documented actual return shipping for upheld misdescription/auth failure, billed/paid separately; no charge for platform-caused incorrect rejection after review. | Never deduct return charges from buyer principal. Return only to verified seller with tracked handover/evidence. Address handling, nonresponse, suspect counterfeit retention and lawful return/disposal need approved specialist policy; no automatic destruction, retention fee or abandonment rule invented here. |
| Timeout automation | At launch, ALL refund decisions require reviewed Squads approval. Workers may flag deadlines and execute an already-approved immutable refund. | No raw-clock refund authority, even at 48/72 hours. Later automation may cover only confirmed no-dispatch after grace, notification, verified no carrier acceptance/receipt/dispute and an independently authorized non-dispatch attestation. Missing scan is not proof; transit/receipt/auth review/hold always excludes timeout automation. This requires new explicit policy/authority review. |
| Dispute resolution | Independent reviewer prepares signed evidence/reason; recommend Squads 2-of-3 threshold approves financial disposition; controller cannot approve own contested inspection alone. | Record request, reviewers/conflicts, votes/decision ID/policy version, chain hold/revisions/signatures/outcome and appeal notice. No erasure or arbitrary transfer. Threshold/staffing and emergency availability need approval. |
| Pause/service outage | Acknowledge incident within 24 hours, review held funds daily, publish case status and named next action. | This is an operational SLA proposal, not auto-unpause or automatic refund. Refund/release cannot bypass an active security outflow pause. |

Seller did NOT dispatch and parcel IS IN TRANSIT are different states/reasons
with different evidence. Carrier-confirmed pickup prevents a non-dispatch
refund even if delivery takes longer. A seller falsely claiming dispatch or a
wrong pair is a reviewed incident, not an inferred timeout. Parcel loss may
justify full buyer refund while carrier claim/seller liability continues
separately; who ultimately bears that loss remains a founder decision.

Proposed seller restrictions/bans require a separate reviewed conduct decision,
not automatic side effect of every refund or database cancellation. Do not
reuse legacy ban_consignor=true as a new approved policy. A buyer requesting
changed mind after funding or post-release complaint also needs explicit terms;
this contract does not silently grant unilateral cancellation of accepted sales.

## Legacy continuity and coordinated cutover

Panda was reported to have paid by DIRECT transfer. It was NOT escrow funded.
Do not relabel it, fabricate escrow balances/acceptance, replay purchase or debit
seller/treasury to create retrospective escrow. Preserve full signature/domain/
mint/accounts/quote/slot, order/listing/Card/Item/ledger/provenance/intake links
and current status. A settled-unpaid sol: order means not paid by Stripe; it
does not mean buyer owes another USDC payment. Human must identify exact records
and current custody/owner before any separate cleanup or redemption rehearsal.
If that old direct first sale needs cancellation, no program escrow exists to
refund it: it is a legacy operator obligation requiring separately approved
funding/recourse, not an automatic escrow refund. No such funds movement here.

Retain existing authorized receipt/recovery lookup and conflict checks, explicitly
legacy/unverified as appropriate; current quote-key dependency remains until a
separately authorized historical-evidence recovery path is implemented. Preserve
old verification config/key history without accepting a new quote as evidence
of old authorization. Add new durable account/attempt recovery alongside it,
not by pretending legacy orders satisfy v2 invariants. Do not erase legacy ledger
or mutate paid_out. Stripe stays dormant in eligibility AND execution; historical
Stripe checkout/webhook/refund entry points cannot become v2 escrow controls.

Cutover must gate issuance AND signing before changing settlement behavior.
Inventory any in-flight signed v1 transactions: app gate cannot stop them.
Human/Solana must fence legacy program buy (pause then upgraded rejection of v1)
and reconcile late finalized v1 payments explicitly. A new v2 deployment alone
does not stop an old program; close that old executable path too. No chain-to-DB
atomic cutover exists. Record cutover slot/version/domain and continue recovery.

Human migration versions existing orders as legacy_direct/legacy_other with
evidence, not mode inference from their CURRENT custody. New sales derive current
mode using new authority/locks. Old pending intakes do not inherit escrow or new
deadlines; preserve and manually classify. Avoid legacy triggers accidentally
unlocking/cancelling v2 claims during migration. Keep old endpoints read-only or
explicitly scoped until all callers and grants close; no unverified fallback.

## Required lane/path extensions and implementation sequence

This task authorizes ONLY this document. Every path below is a future assignment,
not permission to edit now. Main/migrations remain human owned. Do not import
old track/data commits or its ignore-TypeScript-errors change.

| Lane | Future paths / responsibility |
|---|---|
| Human/data schema | supabase/migrations/**: explicit rails/modes/escrow/attempt/evidence/decision/outbox/locks/RLS/grants, trigger replacement and overload retirement. Review actual function catalog/live grants separately; no SQL from this agent. |
| Data contract | lib/api/contract.ts and lib/db/**: additive semantic operations above, types/error mapping, escrow accounting and lifecycle/correspondence; preserve frozen signatures. Retire direct-reference settlement for v2, keep receipt reads. |
| Solana | solana/programs/flexsoar-settlement/src/lib.rs, Cargo.toml, scripts/initialize.mjs plus new local-validator tests: escrow PDA/token authority, shared sale state, role permissions, decisions/pauses/terminal outcomes, legacy instruction disabling and safe initialization/admin/upgrade. Program ABI/IDL generation only after review. |
| Data/Solana application boundary | lib/solana/sdk.ts, quotes.ts, verify.ts, purchase-verification.ts, config.ts and necessary new escrow SDK/verifier helpers; app/api/solana/build-tx/route.ts, quote/route.ts, settle/route.ts: versioned custody-bound authorization and mode-specific evidence/reconciliation, no client mode or browser money recovery. |
| Recovery worker | Explicitly assign proposed lib/db/payment-reconciliation.ts and app/api/internal/solana/reconcile/route.ts or equivalent audited worker entry point, outbox leases/cursors and signer-service boundary. Cron only enqueues/runs bounded authorized work; never gains unrestricted withdrawal keys. app/api/cron/process-payouts/route.ts remains Stripe dormant. |
| Market | components/market/SolanaBuyPanel.tsx, CheckoutModal.tsx, PrivyBuyBridge.tsx; app/(market)/queries.ts, card/[id]/page.tsx and account/sales/fulfillment surfaces: mode disclosure, escrow funding versus seller paid, conditional ownership/locked status, evidence/dispatch/transit/disputes and durable retry-only recovery. Existing short-signature error is not persistence. |
| Admin | app/admin/fulfilment/**, grading/**, cards/** and components/admin/db-writes.ts/auth.ts or new scoped panels: receipt/authentication/release/refund separate actions; exact-pair scanning/evidence, dual control, disputes/holds/outcome queue. Retire inappropriate legacy adapters, never reuse broad is_admin as withdrawal power. |
| Dormant integrations | app/api/webhooks/stripe/route.ts and legacy checkout/redemption actions: explicit assignment to prevent v2 settlement/refund/payout, retain only reviewed historical handling. Notifications move to transactional outbox after authoritative events. |
| Tests | tests/purchase-payment.test.ts currently assigned; new program/integration/market/admin test files need named lane extensions and isolated infrastructure. Do not edit other tracks' shared assertions. |

Sequence and dependencies:
1. Founder approves remaining policy/authority decisions below; human gates
   new buy issuance/UI and plans in-flight v1 resolution. Current refusal stays
   paired with this gate; no standalone settle-only deployment.
2. Agree canonical ABI, state/ledger mapping, inventory identity, role directory,
   account sizes/rent estimates, policy digest and operation IDs across lanes.
   Review signer/governance custody and incident recovery before holding funds.
   Approve per-trade AND aggregate outstanding-escrow exposure limits, with
   program-enforced principal counters/caps in the ABI if chosen; application
   caps alone cannot constrain a compromised issuer. Do not assume the old
   500-USDC per-buy cap bounds cumulative escrow risk.
3. Human/data designs/migrates isolated DB, closes ALL unverified cash/refund RPC
   overloads/default grants, replaces unlock/default triggers, tests actual locks.
   Solana implements isolated program/state/role tests with matching vectors.
4. Data implements attempts/outbox/authority adapters and mode-aware verifier,
   funded/terminal outcome reconciliation and browser-independent watcher. Prove
   full lifecycle using fixtures/local validator/isolated DB; no shared writes.
5. Admin implements intake/auth/independent approval/hold/refund and dispute
   queue. Market implements durable retry-only payment state and exact escrow/
   shipping disclosures. Both must agree receipt != accepted != released !=
   unlocked; neither interface may enable a missing backend safeguard.
6. Human prepares exact memo dependency pair without overwriting main changes,
   installs in isolated worktree and runs normal validation. No ignoreBuildErrors.
   Perform program/DB/UI failure tests, including funded escrow through outages,
   before mainnet. Separate devnet/mainnet data or enforce equivalent domain
   partitioning; shared unpartitioned Card/order data is unsafe.
7. Human deploys only with explicit later authorization: upgrades paused, closes
   v1 execution, verifies actual mint/config/roles/Squads/program authority,
   migrates permissions/triggers, enables compatible builder/UI/settle/watchers,
   confirms recovery/ops staffing, then intentionally opens both supported modes.
   Main auto-deploys; coordinate commits/integration accordingly. Pause/resume
   rollback cannot undo funds; preserve escrow authority and recovery workers.

## Failure-case acceptance tests (required before implementation sign-off)

These tests must exercise actual program + isolated Postgres + production
adapters, not mirrored test-only functions. Current tests prove neither escrow
nor real grants/locks. No real signing/broadcast/database mutation in this task.

1. Competing buyer transactions SAME sale: in escrow mode exactly one principal
   funding/no seller or treasury payment; in direct mode exactly one 95/5 pair.
   Second CPI/funding/initialization failure rolls back state and USDC movement.
2. Wrong mode or custody/acceptance version, spoofed warehouse flag, wrong pair,
   reused intake/authentication from another attempt, old submission auth flag:
   reject authorization/release; never direct-fallback a seller-held purchase.
3. Wrong domain/program/mint/issuer/Ed25519 bytes or offsets/signer/amount/Card/
   listing/attempt/generation; matching unrelated transfers; duplicate program
   invocation: reject. Sponsored fee payer accepted only with buyer signature.
4. Escrow token authority/delegate/owner spoof, fake config, wrong refund/seller/
   treasury ATA, account closure/recreation, unsolicited dust and insufficient
   principal: no redirected funds, replay or principal accounting corruption.
5. Receipt alone does not unlock/release. Fail auth cannot unlock. Wrong staff,
   ordinary issuer or seller cannot attest acceptance, approve withdrawal/refund,
   change roles/destinations or bypass decision revision. Two-person control is
   enforced at DB/signing boundary and program role model as specified.
6. Accepted release transfers exact stored 95/5 once; full refund transfers exact
   total once and no fee. Both program outcomes exclude each other. Concurrent
   release/refund/hold/supersession in every chain order: one legal terminal
   outcome; stale signed command fails. A DB-only refund intent cannot override
   a prior finalized release; show explicit conflict, never second refund.
7. Dispatch label only versus verified pickup versus missing carrier data;
   in-transit parcel exceeds dispatch deadline; delayed receipt/auth SLA: no
   unsupported automatic default/refund or Card unlock. Test approved extensions,
   late parcel after refund and failed-auth appeal with exact pair continuity.
8. Kill process after funding before DB, after acceptance before release, after
   release before unlock, after refund before cancellation and after DB commit
   before chain acknowledgement. Restart watcher/outbox: one original outcome
   reconciles; no buyer/seller/refund repayment, duplicate order or lost queue.
9. Browser closes before signature attachment, response lost, quote expires,
   wallet relinks, treasury/operational key rotates: original attempt/evidence
   recover independently of browser and destinations cannot silently change.
10. Claim pending-vault/disputed/refund-pending/released-unreconciled: direct RPC,
    relist/cancel/redeem/trade accept/mint/status update all refuse, including
    stale offers and races. Exact accepted/released buyer later resells vaulted
    in a NEW generation; old permit cannot fund any replacement sale.
11. Normal funding pause leaves approved exits/reconciliation working. Emergency
    outflow pause blocks exits without losing principal/obligation; governance
    key rotation/resume recovers constrained exits, not sweep. Direct terminal
    purchase has no escrow refund shortcut.
12. Real DB concurrent retries return same authorized order/outcome; conflicting
    receipt/reference/returned order ID fails. Test anon/authenticated/service
    grants and every legacy overload/default/direct table route, actual RLS and
    security-definer search paths. No fabricated refund strings or user-set paid.
13. Every accounting phase balances within actual asset/unit, no USDC in MYR sen,
    fee/revenue only on release, full principal on refund; notifications retry
    independently. Stripe never executes for either mode; paid_out unchanged.
14. PDA/tombstone lifecycle cannot reset consumption on account closure/resale.
    Archive/RPC gaps, pre-finality forks, misconfigured cluster, chain/DB
    mismatch and acceptance correction produce pending/alert/freeze, not invented
    evidence or automatic new payment. Observe meaningful backlog alerts.
15. Panda migration keeps DIRECT historical transfer/claim/evidence unchanged;
    no fabricated escrow, replay or automatic Stripe payout. Late v1 sends
    cannot slip into v2 finalization, and cutover gates builder and signing too.

## Remaining founder decisions (short approval list)

- Ratify policy defaults: dispatch/grace and proof, transit/loss review, auth
  turnaround/appeal, full-principal refund, shipping/network/insurance liability,
  rejected-shoe return and seller conduct/changed-mind/post-release dispute terms.
- Approve launch manual Squads refund/dispute decisions and proposed 2-of-3
  threshold; any future timeout automation requires separate approval, not a
  cron interpreting dispatch due_by as arrival deadline.
- Name receiver/authenticator/independent release controller and enrolled keys,
  managed issuer service, Squads admin/upgrade/refund authority and recovery/
  pause SLA. Confirm staffing and conflict-of-interest controls.
- Approve conditional buyer-claim/reversal/quarantine representation, legal
  ownership wording and what review permits relisting after a cancelled sale;
  preserve one Item/one Card and no automatic substitution/ban/physical return.
- Fund rent/exit-fee/archival/on-call budget; choose lost-wallet destination
  recovery and excess-token/terminal-account retention policies. Pending escrow
  principal is not available budget or sweepable treasury revenue.

Release blockers remain absent v2 program/accounts/authorities, authoritative
DB/grant/trigger changes, durable recovery, admin/market controls, approved
policy and normal plus isolated end-to-end validation. Business-model approval
alone does not enable funding or deployment.

## Historical validation from 93d4e31 and pending dependency preparation

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

Historical supplemental OFFLINE checks from the prior implementation review: main's installed Vitest
4.1.11/TypeScript, explicit resolver mapping to task source, config:false,
no cache/installation/env-file loading:
- 93d4e31 adapted full suite: 402 passed, 2 failed / 404; 13 files pass, 1 fails.
  Dedicated production payment suite: 40/40 within that run (previously 34).
- Unchanged e62795b virtual source overlay with same resolver/settings and base's
  13 files: 362 passed, 2 failed / 364. Same untouched FSC-copy assertions fail
  at invariants.test.ts:1901 and :1960. This was an adapted comparison, not
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

## This revision: verification and unresolved evidence

Only docs/handoff/payment-security.md changes: approved two-mode architecture,
program/accounts and database contracts, authority separation, recovery/state
machines, policy proposals, lane extensions, acceptance tests and cutover.
No exports or frozen signatures change. No Rust/application/database behavior
changed, and no policy values were implemented. This design is not validated by
prior implementation tests. Tests/typecheck/build NOT RUN for this docs-only
revision; standard validation remains pending dependency preparation above.

Live schema/grants, program/config/upgrade authority, escrow behavior, real
concurrency, Panda receipt/current owner/custody, standard validation and all
proposed roles/policy remain unverified. Existing worktrees and main dependency
changes preserved. No SQL written/executed, dependency edits/install, database
calls/mutations, signing, key generation, broadcasts, payments, emails, push or
deployment. OpenCode shim exists but suitable enforced read-only mode was not
established; OpenCode NOT used. Codex owns this design. Commit only this handoff.
