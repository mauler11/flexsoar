# Payment security implementation handoff

Branch: track/payment-security, C:/Users/Family/flexsoar-payment-security.
Starting commit: f777694e86b08c42cab84d297b52ea2d2bbb76f6. Local main remains
 e62795ba3d05d5face22456535f755476a86974c; HEAD..main empty at preflight.
This supersedes the documentation-only contract in f777694 (retained in history).
The founder approved seller-held escrow, vaulted direct settlement, full principal
refund and the policy defaults below. Implementation is NOT deployment approval.

## Release verdict

FUNDING IS DISABLED. No environment flag can turn on the application signing path.
Rust program/source and application protocol/adapters are implemented, but Rust/SBF
compilation, validator execution, real Postgres grants/locks, schema and operational
signing/configuration are NOT verified or complete. Never describe this as launch
ready, a completed database integration, or proven atomic purchase recovery.

The legacy builder and quote endpoints now refuse issuance. Checkout exposes only
payment-status recovery, with no signing, top-up or wallet-link-to-buy prompt.
Legacy Stripe/FSC purchase/redemption actions refuse payment/completion; reference-
only purchaseCard/purchaseCardSplit refuse before DB access. Stripe webhook still
validates signatures, but returns 503 for handled historical events without mutation,
settlement, external emails or false acknowledgement of processing. Such historical
obligations require operator review; retries must not be mistaken for settlement.
Stripe seller payout selection AND execution remain disabled; paid_out unchanged.

Listing/cancellation/redemption wrappers now require the new v2 RPC names below;
missing schema fails closed. This closes APPLICATION call paths, NOT direct live
RPC grants. All frozen/existing contract signatures remain unchanged. New funding
must stay gated until legacy grants/triggers and every claim mutation are corrected.
Do not deploy only the settlement refusal, or re-enable an old builder to work around it.

## Executable source and protocol

- lib/solana/protocol-v2.ts and program src/protocol.rs freeze a fixed 690-byte
  Borsh Permit and 145-byte Attestation, with independent byte-vector tests.
- Authorization variant chosen: online issuer AND buyer transaction co-signing,
  not detached Ed25519-precompile permits. Canonical bytes are IN the instruction
  signed by both. No provider/private key is fabricated. This is the live cosigner
  option from the earlier design and avoids a second detached-signature parser.
- Permit: tag FSOARV2 plus zero byte, version 2, mode (0 escrow / 1 direct); 19
  fixed 32-byte fields in KEY_FIELDS order; seven u64 LE fields in U64_FIELDS order;
  validFrom/expiresAt i64 LE. Fields bind domain/genesis, program/config, sale ID,
  Card/pair, attempt/beneficiary, policy, buyer/seller/treasury/mint/token program,
  source/recipient/refund accounts, issuer, generation/revision/custody/authority
  versions and exact total/net/fee. No JSON signing or floating-point USDC math.
- Attestation: tag, action u8, Sale PDA/attempt/pair/evidence commitments, revision
  u64 LE. Action numbers: receipt 0, pass 1, fail 2, release 3, refund 4, hold 5,
  clear-to-fresh-release-approval 6, dispute refund 7, independent reinspection 8.
  Signatures cover the transaction and all arguments; an evidence hash alone is
  not physical truth or authority. Program checks the enrolled signer role.
- v2-sdk.ts builds buy, attestation and outcome instructions, unsigned v0 buy
  transactions and only the ORIGINAL bound ATA recreation. Full permits require
  reviewed explicit lookup tables to fit packet limits; no implicit creation or
  client-provided replacement accounts. No application issuer service is installed.
- policy module freezes MY-USDC-ESCROW-1; digest covers sorted [field,value] JSON
  entries, SHA-256 834ca943173d4db87622426e161eeb17afcdbac94e37368e6f697430961925c5.
  Human must store immutable version AND full rule record, not just version label.

## Program behavior and authority (source implemented; runtime unverified)

initialize_v2 restricts bootstrap to THIS program's upgradeable ProgramData PDA
and actual upgrade-authority signer. Initializes six-decimal mint, domain, policy,
fixed future treasury, distinct roles and three distinct governance members;
funding paused, both exposure caps ZERO, outstanding principal zero. No chosen
production caps, mint, public-network authority or deployment identity is supplied.
Old buy and initialize reject explicitly. Existing remote bytecode is unchanged.

Roles are issuer, inventory, receiver, authenticator, independent reviewer,
release controller, reconciler and guardian; all distinct and distinct from the
three governance members. Native governance requires TWO DISTINCT members out
of three. Controlled installation can enroll an explicitly reviewed OFF-CURVE
Squads vault signer and external policy digest; both governance AccountInfos
then refer to that vault and require its CPI signature. The program does NOT
inspect Squads' threshold/account internals. Actual 2-of-3 Squads setup, execution
integration and policy audit remain REQUIRED human evidence, not an existing
multisig claim. Issuer cannot enroll itself as governance or withdraw escrow.

Governance configures limits/roles only while funding is paused, increments
issuer epoch, rotates native members or updates future treasury/policy. Enrolled
vault cannot overlap operational roles. Funded escrows retain their old accounts,
amounts and policy even across rotation. Governance/upgrade authority is trusted:
upgrading code could change restrictions. No runtime principal sweep or close
instruction is provided; retaining tombstones is deliberate.

CardControl PDA: seeds card-v2 + Card commitment. Registration requires inventory
AND authentication signers, exact pair/current owner and mode. This is a trusted
physical custody attestation, NOT client choice. Warehouse enrollment must use
real acceptance evidence; old authenticated_at or SKU equality is insufficient.
Sale PDA: sale-v2 + immutable sale ID. One current generation per CardControl.
Open derives/checks mode/custody version/owner from registry and freezes seller,
treasury, mint, policy and role/context bindings. Shared writable sale consumption
serializes ALL buyers, not one independently consumable account per attempt.

SaleV2 combines sale AND escrow state data (not separate Escrow data PDA).
Per-sale SPL token account: escrow-v2 + Sale PDA; token authority=Sale PDA, data
owned by SPL Token. It is created at opening (including empty direct-mode account),
with no external delegate/close authority. Program keeps exact principal separate
from balance; unsolicited dust is neither funding proof nor sweepable principal.

States: 1 open -> 2 funded escrow OR 3 direct paid OR 6 revoked. Funded escrow
2 -> 4 released OR 5 refunded. Terminal IDs never reopen. Card generation cannot
advance until reconciler acknowledges the exact terminal outcome after DB commit.
Refund acknowledgement quarantines Card; no automatic relist or replacement pair.
Release/direct acknowledgement sets current owner=original buyer and vaulted mode.
Receipt never changes the registry to accepted/available by itself.

buy_sale requires buyer AND configured issuer signatures; sponsor may pay fees.
Checks immutable sale/generation/mode/custody, current issuer epoch/treasury/policy,
program/config/domain, exact split and Clock validity at EXECUTION. Escrow branch
atomically consumes sale, transfers full principal to escrow and increments bounded
aggregate principal. Direct branch atomically consumes and transfers both 95/5 legs.
Rollback relies on actual Solana transaction semantics; no validator proof yet.
revise_sale increments revision only while open; revoke closes only unconsumed sale.
A buy winning first beats cancel/reprice; a fence winning first rejects old buy.
A funded sale requires a controlled refund, never unpaid cancellation.

Receipt signer records exact-pair evidence only. Authenticator independently records
pass/fail after receipt. Release signer must differ from receiver/authenticator/
reviewer/original issuer and attest final acceptance; only matching receipt + pass,
no hold and no competing decision may authorize release. Failed-auth reinspection
requires a DIFFERENT configured reviewer and held escrow, preserves first evidence,
and never releases money by itself. Dispute resolution clearing hold requires a
fresh independent release approval. Governance alone cannot fabricate auth pass.

Refund needs manual governance approval and returns FULL stored total to original
buyer ATA, zero fee/deduction. No timer refunds. Disposition revision fences stale
commands; guardian can hold, governance supersedes unexecuted decision with a new
revision. execute_outcome is permissionless but can only perform the stored bounded
branch. Shared escrow lock permits exactly one release OR refund; failed execution
keeps prior state. No refund after release or release after refund. Missing original
ATA may be recreated for same owner/mint/address, never wallet-relink substitution.

Normal funding pause keeps already-authorized exits and observation/reconciliation
working. Emergency outflow pause additionally blocks exits; principal stays in
escrow and claim locked. Guardian only pauses; governance resumes/recovers roles.
No deadline bypasses security pause and no escrow is expired back to unpaid.

## Application contracts and durable recovery

Real typed adapters are in lib/db/payment-v2.ts; sanctioned exports are additive
in lib/api/contract.ts. No production in-memory store, browser payment record or
fabricated receipt. Missing RPC throws PaymentSchemaUnavailable with original
code/message. These contracts have NOT been supplied/applied to any database.

Customer GET attempts is session-bound, no caller buyer ID. POST settle version=2
only attaches a candidate to its original owned attempt and returns 202 PENDING;
it cannot mark paid. Legacy POST receipt recovery stays intact. GET receipts reads
existing orders by authenticated buyer AND listing, marks legacy_record_only and
paymentVerified=false. Panda remains a reported legacy DIRECT transfer, never
escrow or a new charge; unrecorded legacy payment still needs original evidence
and operator resolution. Empty/error lookup is not proof that no payment happened.
UI restores account-bound state on mount/retry, independent of wallet linking;
never returns possible broadcast to a signing or top-up state.

Admin /admin/payments has separate receipt/authentication/release/refund/dispute
intent controls, exact pair/evidence/revision/command IDs and unresolved queue.
Generic is_admin is navigation only. RPC must verify enrolled staff role and
independent HUMAN identity, not just different pubkeys. No staff key/provider is
configured; form success can only record an intent, not paid/refunded/unlocked.

LocalV2Observer uses ONLY explicit loopback HTTP, rejects redirects/credentials,
checks genesis and actual program-owned Sale PDA/discriminator. Retained slots
index original finalized blocks, avoiding a last-1000-signatures recovery trap.
Validates exact instruction/accounts, buyer+issuer signature metadata, full permit,
scoped token CPIs, token owners/mint/units/deltas and terminal revision. Program-
recorded funding Clock must be within original permit interval; current expiry
never rejects an already valid execution. Missing archive remains unresolved.
It reads program state, not browser claims or current linked wallets.

Worker separates observation, verification, verified-event persistence and atomic
DB consumption. Durable begin/finish scan leases checkpoint ordered sweeps; maximum
20 sales per invocation, at most two events each. Finish persists failures and
advances/wraps cursor; process death before finish replays idempotently. Up to 500
retained accounts per scan; larger scans fail closed pending partitioned indexer.
Notifications are enqueued by settlement RPC, NOT delivered by this observer.
Independent delivery and signing/execution providers remain integration work.

Internal POST /api/internal/solana/reconcile requires PAYMENT_RECONCILE_SECRET,
PAYMENT_V2_ENABLE_LOCAL_RECONCILIATION=true, explicit PAYMENT_V2_LOCAL_RPC,
PAYMENT_V2_PROGRAM_ID, PAYMENT_V2_GENESIS_HASH and LOOPBACK SUPABASE URL. It cannot
run against localhost's existing shared cloud Supabase. No internal route was
invoked. A public production observer/service is deliberately not configured.

## Human database migration contract (plain English, NO SQL)

Create immutable policy_versions, sale_authorizations, purchase_attempts, candidate
submissions, verified_chain_events, escrow_purchases, intake/inspection/acceptance
versions, conditional claim reservations, escrow_decisions, leased chain_operations,
notification outbox, unresolved events and per-domain scan cursors. Bind foreign
keys across exact Item/Card/pair/listing/sale/attempt/buyer/order/escrow, not isolated
valid UUIDs. Snapshot all Permit fields, MYR sen/FX evidence/rounding and USDC units.
Store original funding Clock and proof, not a new application deadline on retry.

Constraints: one current sale per Card; monotonic generation/revision; one winning
attempt/order per sale; one order/payment consumption per attempt; network/genesis-
scoped unique payment signature for one-purchase-per-transaction launch; unique
(domain,program,authorization ID), event identity and immutable decision command ID;
only one terminal escrow outcome. Foreign-key-correspondence and immutable terms
must survive deletes/retries. Terminal references must never be freed for reuse.

Conditional escrow reconciliation appends paired seller->buyer Card entries and
owner cache update with pending_vault, intake/reservation and funding receipt;
NO seller/treasury delivery yet. Release after exact accepted pair appends seller/
fee delivery and unlocks atomically. Refund appends full principal return and paired
conditional buyer->seller claim reversal, quarantines, cancels reservation/order;
never erase ledger, assume shoe returned, auto-ban seller or create another Card.
Direct verified sale writes paired ownership and active availability atomically.
USDC base-unit movements balance separately from MYR valuation, never *_cents.
held_in_escrow, released_direct/released_escrow, refunded and unresolved are distinct
axes; paid_out remains historical Stripe. Unavailable/unknown does not mean unpaid.

Use one lock order for Item/Card (sorted for trades), sale/listing, attempt/escrow/
evidence, intake/decision and user/account rows. Enforce owner/status/custody and
winning attempt under those locks. All list/cancel/redeem/trade/accept-offer/mint/
reject/custody/direct updates coordinate fences, including stale offers and rows
that accidentally appear active. Status-only UI guards are insufficient.

Exact RPC boundary (JSON keys below are contract names, not migration code):

| RPC | Inputs / result | Mandatory authorization and atomic behavior |
|---|---|---|
| fn_payment_v2_initiate | p_listing_id, p_idempotency_key, p_policy_version, p_policy_digest -> AttemptStatus | Session buyer only, server-approved immutable policy row; derive mode/custody/price/wallets, fence Card and store full canonical permit BEFORE issuer approval. Retry exact buyer/key returns same immutable attempt; reject conflicting reuse. |
| fn_payment_v2_own_attempts | p_listing_id -> AttemptStatus[] | Session buyer owns rows; no supplied buyer override. Return camelCase id/listingId/mode/funding/dispatch/authentication/sellerSettlement/claim/signatures/operationPending, accurate separate states. Never disclose another buyer's evidence. |
| fn_payment_v2_attach_candidate | p_attempt_id, p_signature -> no financial result | Own original attempt; candidate is untrusted and cannot set verified/paid or retarget terms. Repeated attachment idempotent. |
| fn_payment_v2_admin_queue | no arguments -> controlled queue JSON | Enrolled operations role, not a generic user; show intents, holds, chain state vs DB, unresolved obligations and approvals. No private keys/customer address dumps. |
| fn_payment_v2_record_decision | p_decision containing escrowId/commandId/expectedRevision/action/evidenceDigest/pairCommitment -> operation ID | Enrolled action-specific staff role; exact current funded pair/intake; revision, policy and independent-person checks under locks. Persist intent/outbox only, never claim chain paid/refunded or unlock. Release needs committed acceptance/pass; refund manual governance; no raw-clock authorization. |
| fn_payment_v2_claim_operations | p_worker_id, p_limit=10 -> [{id,payloadDigest,expectedRevision,action}] | Restricted worker, durable exclusive leases, bounded approved commands; payload immutable. Not a withdrawal key. Signing provider and operation completion protocol still require integration, not a simulated implementation. |
| fn_payment_v2_begin_scan | p_genesis, p_program, p_limit<=20 -> {leaseId,afterAddress:null or address} | Restricted verifier/observer role; one durable sweep lease per domain/program. Expired lease retry starts from original committed cursor, never skips unconsumed payment. |
| fn_payment_v2_recovery_binding | p_attempt (base58 commitment), p_genesis, p_program -> {permitHex,appliedKinds:[]} | Verifier-only immutable PREEXISTING attempt, exact 1380 hex chars; applied kinds funded/direct/released/refunded based on committed consumption, not candidates. No live wallet lookup or retroactive fabricated attempt. |
| fn_payment_v2_record_verified_event | p_event: genesis/program/sale/attempt/kind/signature/slot/fundedAtSeconds/permitHex/decisionRevision/finality -> event UUID | Restricted verifier; validate all stored context and immutable event identity. Exact retry returns same event only after correspondence. Cannot accept arbitrary user reference as payment. App supplies finalized chain evidence; retain proof/digest/verifier version. |
| fn_payment_v2_reconcile_event | p_event_id -> original order/outcome result | Restricted settlement role; consume verified event once and transfer/reserve/unlock/cancel claim + ledger + notification outbox under same locks. Existing result only after authorization/full correspondence. No payout side effect or new payment. |
| fn_payment_v2_finish_scan | p_lease_id, p_last_address null or address, p_failures [{sale,error}] -> no financial result | CAS matching lease; persist failures as unresolved work and next review; advance/wrap cursor only for examined batch. Crash after event commit but before finish is safe replay. |
| fn_payment_v2_list_card | Existing listCard parameters unchanged -> listing UUID | Session seller/current owner; no escrow/reservation/dispute/fulfillment/old-sale fence; authoritative custody/mode derivation, no client payout-method authority. Never bypass fresh sale generation on chain. |
| fn_payment_v2_request_cancel | p_listing_id,p_actor -> no claim unlock result | Actor from session, persist cancel/fence intent; unconsumed sale closes only after finalized revocation wins. Consumed escrow becomes reviewed refund request, direct winner reconciles. No immediate status-only unlock. |
| fn_payment_v2_redeem_card | Frozen legacy redemption arguments -> currently MUST refuse unsupported payment | Enforce owner AND all claim/sale fences atomically. Do not accept caller fee as shipping proof. Keep disabled until a separately reviewed additive paid-redemption contract exists; this purchase task does not invent redemption payment policy. |

All new functions need explicit grants/RLS, hardened security-definer search path,
no PUBLIC/anon default execution and no session-user verifier role. Revoke ALL
legacy fn_purchase_card/core/with_credit overload/default paths from users; retire
service string-reference shortcuts after identifying historical callers. Audit
actual deployed catalog, not just checked-in migrations. Replace 023c intake
opening/hold/receive/default/cancellation triggers and functions: receipt cannot
stamp pass/unlock; every funded unresolved state holds; historic intake never
substitutes current purchase; no default merely because in_transit passes due_by;
no cancellation by arbitrary refund string. Harden all grade/auth/submission/mint/
reject/custody and 024 trade mutation paths as part of that SAME migration.
These database controls are NOT implemented by application guards or mock tests.

## Policy defaults implemented as versioned rules

48 elapsed hours from program-recorded finalized funding to dispatch, plus 24-hour
evidence/correction window before REVIEW. Carrier acceptance or independently
reviewed drop-off required; label only/unknown becomes review_required, NEVER an
automatic refund. Verified transit is not non-dispatch. Review transit at 7 calendar
days Peninsular / 14 East Malaysia, escalate unresolved trace after another 7.
Authentication target 2 business days after receipt; preliminary rejection has
48-hour challenge and independent second review, target 5 business days resolution.
Seller inbound shipping; platform rent/exit transaction fees; full original USDC
principal on approved refund with no shipping/platform/network deduction.

These constants and dispatchReview are executable, not autonomous financial
policy. No business-day calculator invents holidays. Carrier-loss liability,
counterfeit handling/return/disposal, changed-mind/post-release promises and lost-
wallet redirection remain unresolved operational terms. They do not weaken the
independent release/refund controls; refunds remain manual at launch.

## Local verification and honest limits

Production TypeScript is exercised by purchase-payment.test.ts and payment-v2.test.ts:
wire vectors, integer/interval/split checks, sponsored buyer+issuer signatures,
wrong program/amount/mint/recipient/pair/attempt/CPI attribution, finalized observer
RPC fixtures, durable recovery orchestration through lost responses/schema failure,
original destinations, ATA recreation, policy digest/transit behavior, paused UI,
legacy receipt classification, real endpoint gates and Stripe payout containment.
Persistence/RPC doubles are in TESTS ONLY, not evidence of Postgres authorization,
constraints, locks, physical truth, real signatures or transaction rollback.

Rust has seven production-code unit tests (wire/attestation vectors, binding/time,
role independence, two-of-three and actual execution eligibility predicate). None
has been compiled or executed here. The local-v2.mjs harness drives the compiled
program on a newly owned validator, no DB: ephemeral in-memory keys and valueless
six-decimal mint, loopback only, explicit opt-in, no default wallet/key files,
no public RPC, no existing-port reuse, unique temp ledger. Checks validator flags
before starting. Tests two buyers both modes, insufficient funding/second-transfer
rollback, expiry/reprice fence, receipt/failed-auth refusal, independent authorities,
manual refund/release, duplicate/stale terminal commands, dust, normal/emergency
pause and future-term rotation preserving funded destinations. Failed commands are
actually sent to the OWNED local validator (skipPreflight), not just simulated.
This harness has ONLY passed node --check; never claim these runtime tests passed.

Cargo/rustc/Anchor/Solana validator are absent; wsl --list --quiet found no usable
distribution. No toolchain was installed. Human must provide compatible existing
Rust/SBF and Anchor 0.31.1 tooling, then run cargo test for the workspace and a
local SBF build. Anchor.toml now points at 127.0.0.1 and an absent explicitly local
wallet placeholder, never ~/.config/solana/id.json. Use ephemeral test identity
only. Build/test can expose Rust compiler, IDL, lifetime, stack or packet issues;
none is silently waived. Run the guarded helper only AFTER successful build:
node solana/tests/local-v2.mjs --run-local-validator --program-so <reviewed-built.so>.
No harness/validator transaction has run during this task.

Standard npx --no-install tsc --noEmit / npm test / npx --no-install next build
--webpack: PENDING / NOT RUN (no node_modules here). Human must preserve/review
main's EXACT memo manifest/lockfile pair (resolved memo 0.10.0), authorize exact
pair integration into this worktree, npm ci here, verify hashes/version, then run
normal commands with ONLY isolated services and outbound effects denied. Do NOT
copy node_modules, env files or shared credentials; do not regenerate dependencies
or import old data commits/ignoreBuildErrors. Next build can execute server code.
No SQL may be authored/run by this agent; isolated database integration follows
human migration application. No new npm dependency is required by these helpers.

Adapted checks use main's already-installed Vitest/TypeScript with explicit alias
resolution to this source, config:false, no install/cache/env-file loading. They
are supplemental, NOT standard validation. Results are updated below before commit.
Earlier f777694 virtual-source baseline comparison: 402 passed, two FSC-copy failures.
One current full run before final additions: 447 passed / 2 failed; later run:
448 passed / 5 failed (same FSC two plus consignment mock missing maybeSingle and
two market empty-state assertions). Shared file has repeated hoisted mock factories
at 253/2941 (contract) and 2925/2998 (Supabase); mock interaction is suspected, not
proven cause. These additional failures remain explicitly unresolved, not declared
pre-existing merely because source is unchanged. No shared assertions edited.

## Missing integration, authorities and next actions

Application FUNDING_AVAILABLE=false is intentional; no enable env override exists.
No issuer signing provider, actual people/keys, enrolled roles/Squads vault policy,
production program/mint/genesis/config, reviewed lookup tables, exposure/rent budget,
production archival watcher, operation executor/notification dispatcher or migrated
Postgres service is supplied. All remain integration/release blockers, not excuses
to use legacy settlement. Source signing builders are not an operational signer.

Next human steps: preserve/integrate memo pair and prepare npm ci; provide isolated
Rust/SBF/validator environment and execute the source tests/harness; author/review
and apply the exact schema/RPC/grant/trigger changes in an ISOLATED Postgres project.
Then run real role/lock/constraint/concurrency tests. Supply identities/providers/
governance policy and budgets through an explicit later secure configuration step,
not this handoff. Add remaining runtime cases (full dispute supersession and real
ATA close/recreation, cancellation execution ordering and DB/process crash matrix)
and production-grade partitioned/archive recovery validation before any enablement.

Cutover: stop BOTH issuance and signing, inventory in-flight v1 signatures, fence
legacy bytecode (a new program alone does not revoke old signed buys), reconcile
late v1 payments as explicit legacy obligations. Coordinate v2 program, migration/
legacy grants/triggers, compatible UI/builder/settle and recovery worker as ONE
paused rollout. No deployment/upgrade/push is authorized here. Keep recovery on
while funding paused; rollback cannot undo payment/refund. Never replay Panda or
label its original direct transfer escrowed.

Verification this task: no SQL files created/edited/executed; no database calls
against actual shared/cloud data, no real signing/broadcast/payment/email, no key
files read/generated, no deployment/push, no dependency edits/install, no existing
worktree reset/import. Only local fixture verification and syntax/source checks.
OpenCode executable shim exists but suitable enforced read-only mode was not
established; OpenCode was NOT invoked. Codex designed/implemented/reviewed this work.

Primary wire/API references inspected (not live deployment evidence):
- https://github.com/solana-program/token/blob/main/interface/src/instruction.rs
- https://raw.githubusercontent.com/coral-xyz/anchor/v0.31.1/lang/src/bpf_upgradeable_state.rs

## Final verification for this implementation revision

- Latest adapted full Vitest run: 453 passed / 2 failed / 455, 14 files passed,
  one shared file failed. Within it dedicated payment suites are 91/91 (purchase-payment 45, payment-v2 46).
  Only failures: untouched FSC-copy assertions invariants.test.ts:1901 and :1960.
  Earlier 448/5 intermittent result remains above; no claim the flakiness is fixed.
- Latest adapted no-emit compiler: three TS2749 diagnostics only, sign-in/page.tsx:20,
  sign-up/page.tsx:20 and app/layout.tsx:41; no task-file diagnostics. One interim
  new implicit-any receipt-row diagnostic was corrected using runtime boundary
  validation, not suppression/cast-to-pass. Standard command remains NOT RUN.
- Source comparison: all 94 existing lib/api/contract.ts function headers unchanged,
  covering the frozen contract; no new ignoreBuildErrors or shared-test assertions.
- node --check passed for local-v2.mjs and disabled initialize.mjs. Seven Rust unit
  tests and local-validator program/rollback scenarios NOT RUN: toolchain absent.
- git diff --check passed. No SQL/dependency changes; no actual DB calls, keys,
  signing, broadcasts or external side effects. Existing main memo pair preserved.

Local worker currently uses the existing service client AFTER rejecting nonlocal
Supabase URLs. A least-privilege production verifier credential/client and its
actual grants have NOT been supplied/implemented; do not grant generic service
processes new evidence authority as a shortcut. Production deployment/bytecode
identity, archival service/Squads policy and real DB invariants remain unverified.

## Added export surface (source signatures)

Re-exported through contract where appropriate; existing signatures unchanged.

- lib/solana/protocol-v2.ts:
  - const PROTOCOL_TAG
  - const KEY_FIELDS
  - const U64_FIELDS
  - TypeAliasDeclaration PermitV2 (fields/methods in named source).
  - const PERMIT_SIZE
  - export function encodePermit(p: PermitV2): Uint8Array
  - export function decodePermit(bytes: Uint8Array): PermitV2
  - export function validatePermit(p: PermitV2, executionTime: bigint): void
  - export function equalBytes(a: Uint8Array, b: Uint8Array): boolean
  - export async function permitDigest(p: PermitV2): Promise<Uint8Array>
  - InterfaceDeclaration AttestationV2 (fields/methods in named source).
  - export function encodeAttestation(a: AttestationV2): Uint8Array
- lib/solana/payment-policy.ts:
  - const PAYMENT_POLICY_V1
  - export async function paymentPolicyDigest(): Promise<string>
  - export function dispatchReview(fundedAt: number, now: number, evidence: 'label' | 'carrier_accepted' | 'reviewed_dropoff' | 'unknown'): 'awaiting_dispatch' | 'in_transit' | 'review_required'
- lib/solana/v2-sdk.ts:
  - export function v2Addresses(program: string, card: Uint8Array, saleId: Uint8Array)
  - export async function discriminator(name: string): Promise<Uint8Array>
  - export async function buyV2Instruction(p: PermitV2): Promise<TransactionInstruction>
  - export async function buildV2Buy(p: PermitV2, blockhash: string, feePayer: string, tables: AddressLookupTableAccount[]): Promise<Uint8Array>
  - export async function attestationInstruction(program: string, config: string, sale: string, signers: string[], name: string, a: AttestationV2, passed?: boolean): Promise<TransactionInstruction>
  - export async function outcomeInstruction(program: string, p: PermitV2, revision: bigint): Promise<TransactionInstruction>
  - export function recreateBoundAta(payer: string, owner: string, mint: string, expected: string): TransactionInstruction
- lib/solana/v2-observer.ts:
  - InterfaceDeclaration SaleSnapshot (fields/methods in named source).
  - export function localRpc(url: string): string
  - export async function decodeSale(address: string, bytes: Uint8Array, program: string): Promise<SaleSnapshot>
  - InterfaceDeclaration V2Transaction (fields/methods in named source).
  - TypeAliasDeclaration OutcomeKind (fields/methods in named source).
  - export async function inspectV2Transaction(tx: V2Transaction, signature: string, s: SaleSnapshot, kind: OutcomeKind): Promise<void>
  - ClassDeclaration LocalV2Observer (fields/methods in named source).
- lib/db/payment-v2.ts:
  - InterfaceDeclaration PaymentRpc (fields/methods in named source).
  - InterfaceDeclaration AttemptStatus (fields/methods in named source).
  - InterfaceDeclaration PaymentDecision (fields/methods in named source).
  - ClassDeclaration PaymentSchemaUnavailable (fields/methods in named source).
  - export async function paymentRpc(client: PaymentRpc, name: string, args: Record<string, unknown>): Promise<unknown>
  - export function parseAttempt(value: unknown): AttemptStatus
  - export async function ownPaymentAttempts(client: PaymentRpc, listingId: string): Promise<AttemptStatus[]>
  - export async function recordPaymentDecision(client: PaymentRpc, d: PaymentDecision): Promise<string>
  - export async function initiatePaymentAttempt(client: PaymentRpc, listingId: string, idempotencyKey: string): Promise<AttemptStatus>
  - export async function attachPaymentCandidate(client: PaymentRpc, attemptId: string, signature: string): Promise<void>
  - InterfaceDeclaration PaymentOperation (fields/methods in named source).
  - export async function claimPaymentOperations(client: PaymentRpc, workerId: string): Promise<PaymentOperation[]>
  - const FUNDING_AVAILABLE
- lib/db/payment-reconciliation.ts:
  - InterfaceDeclaration PaymentObserver (fields/methods in named source).
  - export async function reconcilePayments(client: PaymentRpc, observer: PaymentObserver, budget=20)

## Companion program commit and final ABI guard

Application gating/adapters commit: 4ade2bf. The companion commit supplies the Rust
program, unit-test source, guarded local validator harness and loopback Anchor config.
Financial instructions require the fixed instructions sysvar and exactly ONE
TOP-LEVEL own-program instruction per transaction, preventing unsupported batched
buys/exits and proxy-CPI financial calls. Other-program compute, memo and ATA
instructions remain allowed. Governance approval through Squads CPI is unaffected;
actual financial execution is a separate permissionless top-level command. SDK,
observer and fixtures include the appended sysvar account (buy account 11, exit 8).
The local harness checks batched exit refusal before terminal execution. This new
Rust guard is source-reviewed but NOT runtime-verified; no compiler/validator exists.
Final adapted full suite after this change: 453/455 pass, only the two known FSC
failures; dedicated suites 91/91. Normal validation and real DB/Rust guarantees
remain blocked as stated above.

Continuation verification note: the final compiler rerun using explicit React type
aliases reported four diagnostics: the same three TS2749 errors above, plus
TS2307 resolving @privy-io/react-auth/solana in unchanged EmbeddedWalletSection.
The installed package exports that subpath via dist/dts/solana.d.mts; the generic
adapted wildcard resolver does not model that export. A preliminary rerun without
React type aliases produced 349 resolver/cascading diagnostics and is not a useful
validation result. Neither adapted run replaces the pending standard typecheck.
