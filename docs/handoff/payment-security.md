# Payment security implementation handoff

Branch: track/payment-security, C:/Users/Family/flexsoar-payment-security.
Starting commit: f777694e86b08c42cab84d297b52ea2d2bbb76f6. Local main remains
 e62795ba3d05d5face22456535f755476a86974c; HEAD..main empty at preflight.
This supersedes the documentation-only contract in f777694 (retained in history).
The founder approved seller-held escrow, vaulted direct settlement, full principal
refund and the policy defaults below. Implementation is NOT deployment approval.

## Release verdict

FUNDING IS DISABLED. No environment flag can turn on the application signing path.
Rust/SBF compilation and bounded isolated-validator execution now pass (see latest
verification below). Application protocol/adapters are implemented, but real
Postgres grants/locks, schema and operational signing/configuration are NOT
verified or complete. Never describe this as launch
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

## Program behavior and authority (bounded local execution verified; production unverified)

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
Rollback has now been exercised on the isolated validator for the bounded cases
below; this does not prove database or deployed-production behavior.
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

## Earlier verification before toolchain installation (historical; superseded below)

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

## Verification follow-up from 44d5682 (2026-10-15)

Funding remains disabled; this follow-up adds no payment features or production
configuration. Deployment funding calculations are deferred.

### Actual WSL access, not Windows PATH inference

Running as desktop-3s6ohvc\family, C:/Windows/system32/wsl.exe:
- `wsl.exe --list --verbose`: exit -1, "Windows Subsystem for Linux has no installed distributions."
- `wsl.exe -d Ubuntu --exec bash -lc 'command -v cargo rustc anchor solana solana-test-validator; cargo --version; anchor --version; solana --version'`:
  exit -1, "There is no distribution with the supplied name. Error code:
  Wsl/Service/WSL_E_DISTRO_NOT_FOUND". The Linux shell never started.
- `wsl.exe --status`: default version 2; reports WSL1 optional-component unavailable.

This contradicts the older environment handoff for THIS account/session. It does
not prove that the founder's installation was removed or unavailable to another
Windows user. Human must expose the existing Ubuntu distribution/toolchain to this
session and provide its exact distro name; do not reinstall/upgrade as a workaround.
No Rust/Anchor/Solana version or executable location inside Linux could be obtained.
Cargo build/test, SBF build and validator execution remain NOT RUN, zero runtime
cases claimed. No keys, global Solana configuration or wallet files were read.

Read the entire local-v2.mjs harness again: RPC fixed to 127.0.0.1:18899, validator
bind 127.0.0.1, explicit .so/opt-in, supplied RPC/wallet/keypair/devnet/mainnet rejected,
no operational key loading; ephemeral keys generated only after safety guards.
No harness execution, key generation or transaction occurred. `node --check` passes
for both local-v2.mjs and initialize.mjs. Anchor provider remains loopback, with an
absent explicitly local wallet placeholder. Runtime safety and program semantics
are still pending actual validator execution, not established by this inspection.

### Exact dependency-pair review / human preparation

The payment pair is byte-hash unchanged from prior verification and its Git blobs
match local main's committed pair exactly. Copying main's working pair NOW would
replace no payment-worktree-only manifest/lock changes. Recheck before copying.
Main's existing uncommitted changes are memo ^0.10.0 (lock resolves 0.10.0), plus
lockfile date-fns placement: root 2.30.0 -> optional peer 4.4.0 and a nested 2.30.0
under @metamask/sdk. Do not describe the lock diff as only one memo entry or rewrite
it. No other root dependency/version changes were present in the reviewed diff.

SHA256 payment originals:
- package.json: 4F5597C94561D173EA833334301FE6854F0E43F394868A3D049F8AF1DA7C886D
- package-lock.json: 0C079FE9CB2A79117089A350AB4BBBCF0E114888E9F2C60CF5816C6F4C2B2B36
SHA256 main working sources:
- package.json: D98A62F311AF26DA6B39B095B1D19BA9D6C2CDE7843EBA6FB7A82F6A3201EC8A
- package-lock.json: 1DEC156573D13BFCA04776527634BBDDD3765B6F5AAFB443599FCE70341DA56F

Human-only PowerShell; NOT executed by the agent. Back up outside ALL worktrees,
check originals and sources before overwriting, then verify backup AND destination:

```powershell
$ErrorActionPreference = 'Stop'
$src = 'C:\Users\Family\flexsoar'
$dst = 'C:\Users\Family\flexsoar-payment-security'
$backup = Join-Path 'C:\Users\Family' ('flexsoar-payment-deps-backup-' + [guid]::NewGuid().ToString('N'))
$names = @('package.json', 'package-lock.json')
$old = @('4F5597C94561D173EA833334301FE6854F0E43F394868A3D049F8AF1DA7C886D', '0C079FE9CB2A79117089A350AB4BBBCF0E114888E9F2C60CF5816C6F4C2B2B36')
$reviewed = @('D98A62F311AF26DA6B39B095B1D19BA9D6C2CDE7843EBA6FB7A82F6A3201EC8A', '1DEC156573D13BFCA04776527634BBDDD3765B6F5AAFB443599FCE70341DA56F')
for ($i = 0; $i -lt $names.Count; $i++) {
  if ((Get-FileHash -LiteralPath (Join-Path $dst $names[$i]) -Algorithm SHA256).Hash -ne $old[$i]) { throw 'Payment dependency pair changed; stop and review.' }
  if ((Get-FileHash -LiteralPath (Join-Path $src $names[$i]) -Algorithm SHA256).Hash -ne $reviewed[$i]) { throw 'Main dependency pair changed; stop and review.' }
}
New-Item -ItemType Directory -Path $backup | Out-Null
for ($i = 0; $i -lt $names.Count; $i++) {
  Copy-Item -LiteralPath (Join-Path $dst $names[$i]) -Destination (Join-Path $backup $names[$i])
  if ((Get-FileHash -LiteralPath (Join-Path $backup $names[$i]) -Algorithm SHA256).Hash -ne $old[$i]) { throw 'Backup hash mismatch.' }
}
for ($i = 0; $i -lt $names.Count; $i++) {
  Copy-Item -LiteralPath (Join-Path $src $names[$i]) -Destination (Join-Path $dst $names[$i])
  if ((Get-FileHash -LiteralPath (Join-Path $dst $names[$i]) -Algorithm SHA256).Hash -ne $reviewed[$i]) { throw 'Destination hash mismatch.' }
  if ((Get-FileHash -LiteralPath (Join-Path $src $names[$i]) -Algorithm SHA256).Hash -ne $reviewed[$i]) { throw 'Source changed during copy.' }
}
Write-Output "Original pair preserved at $backup"
Push-Location $dst
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed; preserve the diagnostic output.' }
  for ($i = 0; $i -lt $names.Count; $i++) {
    if ((Get-FileHash -LiteralPath $names[$i] -Algorithm SHA256).Hash -ne $reviewed[$i]) { throw 'Dependency file changed during installation.' }
  }
} finally { Pop-Location }
```

No node_modules/env files/credentials copied. Installation is deliberately left to
human; source pair and existing worktrees were not changed by this task.

### Application validation and resolver diagnosis

This worktree has no node_modules and no next-env.d.ts. Normal commands
`npx --no-install tsc --noEmit`, `npm test`, `npx --no-install next build --webpack`
remain PENDING / NOT RUN until human dependency preparation. Historical adapted
453/455 and dedicated 91/91 results above are NOT new normal-command results.
Reviewed package scripts, vitest.config.ts and next.config.ts: no test lifecycle
script, Vitest @ alias only, no ignoreBuildErrors. Build loads server code and
uses next/font/google; isolate runtime credentials/outbound side effects before
build. No env values or shared credentials were read or supplied. Do not interpret
an isolated missing-config/font-fetch failure as proof of payment logic failure.

Concrete Privy resolution probe using installed TypeScript 5.9.3 and package 3.42.0:
- Standard Bundler package-exports resolution, with a READ-ONLY virtual node_modules
  host pointing at main's installed tree, resolves @privy-io/react-auth/solana to
  dist/dts/solana.d.mts; that declaration exports useCreateWallet.
- Earlier adapted `paths: {'*': ['.../node_modules/*']}` returns unresolved for the
  identical specifier: that wildcard file lookup fails the package-export mapping.
This reproduces the adapted TS2307 cause without changing source or asserting that
this worktree's future npm ci/build will succeed.

Source defects outside this lane: sign-in/page.tsx:10, sign-up/page.tsx:10 and
app/layout.tsx:2 default-import Next's VALUE as PageProps/LayoutProps and then use
it as a type. Installed Next page.md/layout.md document generated GLOBAL helpers,
not default imports. Missing generated types do not fix these shadowing imports.
Files are unchanged versus f777694. Auth/layout owner should remove the incorrect
imports and generate route types with the installed Next toolchain, then verify
normal commands. This task does not expand into that authentication/layout rewrite.

### Database implementation precision supplement

The table above remains the required RPC inventory; NO functions or grants have
been applied. Required argument types/results (PostgREST JSON unless stated):
- Initiate: listing UUID, idempotency UUID, policy version text, policy digest hex64;
  own_attempts: listing UUID; attach_candidate: attempt UUID, signature base58 text.
  Callers are the session adapters/routes, not verifier credentials. Initiate is an
  exported adapter without an enabled funding caller; do not enable it on install.
- list_card: p_card_id UUID, p_seller_id UUID, p_price_cents bigint MYR sen,
  p_payout_method text (legacy display input only, never rail/authority),
  p_fair_price_cents nullable bigint -> UUID. Derive seller from auth.uid and require
  supplied seller correspondence; ignore client routing policy. Cancel: p_listing_id
  UUID, p_actor UUID -> void, actor must match session. Redeem: p_card_id UUID,
  p_user_id UUID, p_address structured JSON, p_fee_cents bigint -> UUID ONLY when a
  separately reviewed paid-redemption contract exists; currently refuse safely.
- record_decision: p_decision JSON with fields in PaymentDecision -> operation UUID;
  action enum is exactly receipt/authentication_pass/authentication_fail/release/
  refund/dispute. commandId/escrowId UUID; expectedRevision decimal u64 STRING;
  pairCommitment/evidenceDigest lowercase hex64. Admin session caller must have the
  enrolled HUMAN action role, independence and approval evidence. An action request
  cannot invent a governance signature. No second-review/dispute-resolution adapter
  currently exists; require additive reviewed integration before exposing either.
- claim_operations: worker UUID, limit int <=10 -> JSON array of id UUID,
  payloadDigest hex64, expectedRevision decimal u64 STRING, action text. Descriptor
  alone is NOT a complete signing/execution protocol; fetching immutable payload,
  submission/unknown-outcome recording and terminal completion remain unimplemented.
- Scanner parameters genesis/program/attempt are base58 32-byte values; lease/event
  IDs UUID; slots safe nonnegative integers at current JS boundary; fundedAtSeconds
  decimal i64 STRING; decisionRevision decimal u64 STRING; permitHex lowercase
  hex1380. Store full canonical bytes and parsed typed bindings, not lossy numeric
  JSON. finality must equal finalized. Event kind funded/direct/released/refunded.
  record_verified_event returns UUID; recovery_binding returns exact immutable
  permitHex and committed appliedKinds; reconcile_event returns stable order/outcome
  JSON (currently ignored by orchestrator); finish_scan returns void. Exact order/
  outcome JSON shape is an outstanding additive consumer contract, not fabricated.

Each RPC is ONE Postgres transaction; never hold DB locks while waiting for chain,
issuer, email or carrier calls. Lock sorted Item/Card identifiers first, then
sale/listing, attempt/escrow/verified evidence, intake/decision, then sorted affected
account rows. Concurrent initiation doesn't reserve a second sale; many buyer
attempts may refer to ONE shared sale. A DB reservation cannot revoke signed txs.
Unique sale winner is decided by finalized program consumption. Cancellation/
repricing is intent until chain revision/revocation is finalized. Funded-first means
reconcile buyer obligation; revoke-first rejects payment. No lease timeout resets a
possible/funded payment to unpaid. Avoid scanning-worker lock-order inversion.

Idempotency must compare caller plus ALL immutable context BEFORE returning an
existing order/event/decision. Unique conflicts are not generic success: reload
matching key under lock, compare buyer/listing/sale/attempt/domain/program/signature/
amounts/mode, return same result only for exact retry; conflicting receipt aborts.
Unique verified events per domain/program/sale/kind; signature uniquely consumes
ONE purchase per network (terminal events separately classified), order unique by
sale and winning attempt; terminal release/refund mutually exclusive. Record proof,
verifier version, finalized slot, original funding interval and immutable wallet
history. Already consumed funded evidence cannot be reinterpreted as direct/release.
Persist failed correspondence as a separately audited unresolved obligation, never
replace ownership or duplicate money. Ledger+owner cache+availability+event-consumed+
notification outbox commit together, or all roll back. Acknowledgement to chain
comes only AFTER DB commit; failed acknowledgement leaves generation fenced and
is retryable without repeating payment. Lost response returns the original result.

Permissions: no PUBLIC/anon execute defaults; session users can initiate/read own/
attach untrusted candidate only. Action-specific staff can record bounded intents;
restricted operation worker can lease approved commands, not approve its own.
Dedicated verifier can read immutable bindings/record verified evidence; restricted
settler consumes it; notifier cannot mutate balances/claims. Current local route's
service client does not establish these production privilege boundaries. Harden
security-definer ownership/search path and underlying table/RLS writes. Revoke
legacy fn_purchase_card(uuid,uuid,text,bigint,uuid), its core equivalent, and
fn_purchase_card_with_credit(uuid,uuid), plus ALL actual catalog overloads including
3/4-argument survivors and default-arity resolution, from untrusted roles. Historical
service access must be separately reviewed; a settlement-reference string is never
v2 payment proof. Do not allow a generic service or session path around verifier.

023c_vault_custody.sql: fn_vault_receive currently stamps authentication at 267-268
and activates Card at 272-273; replace for v2. Receipt only records physical receipt
and exact pair/current purchase; never auth pass, payout or active Card. The existing
hold trigger at 174-198 covers awaiting_shipment/in_transit ONLY; broaden the
invariant to received, inspection/rejection/challenge/dispute, authorized exit,
unknown outcome and unreconciled funded/released/refunded obligations. Do not infer
resale eligibility merely because ANY historical intake exists. All 024 trade/
legacy offer, mint/reject/burn/redeem/list/custody/direct table paths must obey same
locks and fences. Existing Panda stays legacy direct; do not populate escrow funding
or replay it. Backfill only from reviewed historical evidence, preserving ledger.

Mandatory ISOLATED Postgres tests after human-authored migrations:
1. Catalog/grants: anon/session/generic admin cannot fabricate verification or call
   ANY old overload/default arity; verify service-core restrictions and table RLS.
2. Two buyers, one sale, both modes; consume the ONE finalized winner, loser gets
   no order/claim. Replay same evidence concurrently returns same order; conflicting
   buyer/listing/domain/signature reuse fails without leaking another buyer's data.
3. Inject failure between each ownership/cache/ledger/event/outbox write: all roll
   back; retry returns one receipt after lost response. Test actual locks/deadlocks,
   not sequential mocks. Scan/executor lease expiry and process restart lose no work.
4. Receipt cannot authenticate/unlock/pay; failed auth stays locked. Exact-pair and
   current-intake mismatch, same-human different-key inspection/release, stale
   decision revision and unauthorized refund/dispute approvals are rejected.
5. Finalized release/refund + failed DB commit stays unresolved/locked, retries only
   bookkeeping; acceptance alone cannot unlock. Full principal refund and paired
   reversal occur once; outbox retry never duplicates payment or changes paid_out.
6. Old offers, direct RPCs and direct row writes cannot trade/redeem/list locked
   claims. Cancel/reprice orderings reconcile the chain winner; wallet relinking,
   authority rotation, browser closure and quote expiry preserve original bindings.
7. Panda/historical receipt remains direct and recoverable; Stripe payout execution
   remains dormant and never consumes USDC orders. No automatic non-dispatch refund
   for verified transit; timers enqueue review only.

Missing production identities/providers, governance/Squads verification, isolated
schema, actual validator evidence and normal dependency validation remain release
blockers. No feature enablement, schema existence or live protection is claimed.

Equivalent compiler evidence: a read-only virtual node_modules host (NO wildcard
package aliases, no emitted files, incremental disabled) ran installed TS 5.9.3
against current 44d5682 and f777694 via virtual source overlays under identical
configuration. BOTH reported exactly the same THREE TS2749 diagnostics at sign-in
20, sign-up 20 and layout 41. No Privy or payment-file diagnostic remained. This is
supplemental adapted comparison, not either worktree's standard command passing.
No executable defect was confirmed/fixed in this follow-up; only this handoff was
changed, with no exports added. Standard validation and Rust/DB execution pending.

## Normal dependency/application verification (2026-10-15, after human npm ci)

Starting HEAD d2ebb990601bf092906f854f2b9783fd0aeb905a; correct track, HEAD..main
empty. Human copied the reviewed dependency pair and ran npm ci. Both files NOW
match main's working pair exactly by SHA256 (same reviewed source hashes above).
The uncommitted package.json/package-lock.json changes are HUMAN work and remain
unstaged/unmodified by this agent. Diff is memo plus reviewed date-fns lock placement;
no unique prior payment dependency changes were overwritten. No npm audit fix,
install-script approval, installation or dependency regeneration was run by agent.

Actual normal application commands, using THIS worktree's installed dependencies:
- First `npx --no-install tsc --noEmit`: exit 1, the three TS2749 diagnostics at
  sign-in 20, sign-up 20, layout 41, before next-env/route type generation.
- `npm test`: exit 1, 451 passed / 4 failed / 455 total; 14 test files pass, 1 fails.
  Two known FSC copy failures at shared invariants 1901/1960; two market rendering
  expectations at 3180/3186 fail because actual getListings hits the Supabase mock
  lacking select().in(). No shared assertions or factories were changed.
- `npx --no-install vitest run tests/purchase-payment.test.ts tests/payment-v2.test.ts
  --reporter=dot`: exit 0, 91 passed / 91 (two files). Actual production TS modules,
  with isolated RPC doubles; not database permissions or chain-runtime proof.
- `npx --no-install next build --webpack`: exit 0, successful compilation, built-in
  TypeScript step, page generation 40/40 and route/build-trace completion. Warning:
  Privy optional @farcaster/mini-app-solana unresolved from its ESM dependency.
  No dependency added to silence it. Stripe-connect module reported missing secret
  configuration; no webhook/cron/admin invocation or credentials supplied.
- AFTER that build, `npx --no-install tsc --noEmit`: exit 0, NO diagnostics.
  Build generated ignored next-env.d.ts and .next route helpers; tracked source and
  tsconfig unchanged. No ignoreBuildErrors or suppression introduced.

CORRECTION to this handoff's earlier diagnosis: generated route types DID resolve
all three auth/layout diagnostics without edits. The earlier claim that generated
helpers could not fix these imports was incorrect. They are NOT a demonstrated
remaining compile blocker. Privy subpath resolves under normal installed config;
its earlier adapted wildcard alias error is absent in the actual normal typecheck.

Build safety: checked no .env files in worktree (contents never read); removed
Supabase/Stripe/Resend/R2/Privy/Solana/Helius/payment/cron/quote/private-key integration
variables from the BUILD CHILD process and disabled telemetry. Next config has no
ignoreBuildErrors. No shared database credentials, program signing or fund movement
was available. Build may fetch public font/FX information; no mutation-capable
external integrations or application requests were invoked by this task.

Shared test diagnosis/evidence, NOT assertion changes:
- Shared file defines multiple hoisted factories for contract (253 and 2941) and
  Supabase (2925 and 2998). These disagree: getListings sometimes reaches real
  contract code, and both relevant Supabase select mocks lack a direct .in()
  method (one supplies only eq().in()). Cache->getListings->select().in() throws;
  browse catches it and renders an error, so empty-state expectations fail.
- First read-only baseline probe replacing ONLY contract with f777694 source:
  242 pass / 5 fail in shared file (FSC two, market two, consignment mock case).
- Second probe overlaying ALL existing changed production TS modules with f777694
  versions: 245 pass / 2 fail (FSC only). Both use installed Vitest/current config
  and unchanged tests, virtual source only; supplemental BASELINE probes, not
  normal npm test or a physical baseline checkout. Duplicate factories and module
  loading interactions remain unresolved; baseline is not proof the extra current
  failures are harmless. No real API/DB behavior defect was established by this.
  Shared test owner must consolidate the mocks in a separately authorized change.

### Ubuntu access now works; exact remaining Rust limitation

The human supplied `Ubuntu` (WSL2). Probe:
`wsl.exe -d Ubuntu --exec bash -lc 'id; command -v cargo rustc anchor solana solana-test-validator; cargo --version; rustc --version; anchor --version; solana --version'`
now DOES execute Linux, uid=1000(family). Exit 127; bash reports cargo, rustc,
anchor and solana "command not found"; command -v finds none of the five tools.
This supersedes the prior distro-not-found state; do not ask merely to expose Ubuntu.

Executable discovery (NO wallet/config reads): direct ls/find under /home, /opt,
/usr/local and /usr/bin to depth 7 finds no named tool executables. For family,
.cargo/bin, .avm/bin and .local/share/solana/install/active_release/bin do not exist.
/opt and /usr/local/bin are empty. Family cannot list root tool directories
(permission denied); repeating ONLY those executable-directory existence checks
as WSL root confirms the same three root paths do not exist either. No root key,
profile, shell startup file or Solana config/wallet contents were read. Two early
compound shell discovery attempts failed quoting/syntax; direct executable-argument
ls/find probes above completed and supplied the actual evidence. No global changes.

Thus Rust/Cargo/Anchor/Solana versions cannot be reported in this Ubuntu runtime;
compile, seven Rust unit tests, SBF build and local-validator scenarios remain
NOT RUN. No validator exists at discovered paths; no ephemeral keys/transactions
were generated. Human next action: run the same command in the founder's actual
Ubuntu session and supply the existing tools' ABSOLUTE executable locations/user
(or clarify which distro/filesystem holds the verified installation). Agent must
not reinstall/upgrade or assume the historical Anchor0.31.1/Solana2.1.0 versions.

No executable defect was confirmed that can be corrected within this verification
pass. Only this handoff was edited; exports added: none. Human dependency pair
remains uncommitted/unstaged. Funding still false, no production enablement, SQL,
DB writes, broadcasts, payments, emails, push or deployment. Missing schema/grant/
lock tests, signer/authority infrastructure and actual Rust execution remain release
blockers despite successful TS build. OpenCode not used.

## Authorized WSL toolchain installation and verification (2026-10-15)

Started at 5ed9245b50761767fe67791b92b82d9cb18dd005. Founder now explicitly
authorizes development-tool installation, superseding the prior no-install rule.
No project dependency manifest or lockfile was changed for these installations.
Ubuntu is x86_64, user family; initially Linux / had 955G available and /mnt/c
141G available. Rechecked existing tools/standard directories before installing.
No installation was overwritten. No production identity or wallet was loaded.

Official compatibility/source evidence:
- https://www.anchor-lang.com/docs/updates/release-notes/0-31-1 explicitly recommends
  Solana 2.1.0 with Anchor 0.31.1 (matches the project's Anchor Rust crates).
- https://solana.com/docs/intro/installation/dependencies documents Rust via rustup,
  pinned Agave releases and official Agave GitHub distributions.
- https://rust-lang.org/tools/install/ documents the official rustup installation.
- Official release assets were discovered using GitHub release APIs for
  solana-foundation/anchor v0.31.1 and anza-xyz/agave v2.1.0. GitHub redirects the
  historical Anchor repository to its current owning organization; no mirror used.

Installed into Ubuntu FAMILY environment, not Windows:
- /home/family/.cargo/bin/rustc -> rustc 1.85.1 (4eb161250 2025-03-15)
- /home/family/.cargo/bin/cargo -> cargo 1.85.1 (d73d2caf9 2024-12-31)
  Official sh.rustup.rs, -y --no-modify-path --profile minimal
  --default-toolchain 1.85.1. Host version deliberately pinned, not latest;
  supports the existing lock/config; SBF compiler is separate, below.
- /home/family/.local/opt/flexsoar-tools/anchor-0.31.1/anchor -> anchor-cli 0.31.1
  Official pinned prebuilt Linux x86_64 binary; no AVM build prerequisite needed.
  Binary SHA256 5e5f8fc0f75f2c3dc5cceb082a7f735d09be2207540291ffad370eb5b2dc959b.
- /home/family/.local/opt/flexsoar-tools/agave-2.1.0/solana-release/bin/solana
  -> solana-cli 2.1.0 (src:c1080de4; feat:3176011155, client:Agave)
- Same bin directory: cargo-build-sbf -> solana-cargo-build-sbf 2.1.0;
  solana-test-validator -> solana-test-validator 2.1.0 (same source/features).
  Official anza-xyz/agave v2.1.0 solana-release-x86_64-unknown-linux-gnu.tar.bz2;
  downloaded archive SHA256 7fe66a4fde1c0a905b022c4db3f68c399bcf6294abc9d81bdaf61930b3af90e1.
  bzip2 was absent; extracted using Ubuntu's existing Python stdlib tarfile,
  avoiding a system installation or untrusted archive tool.
- Build tool installed its official platform-tools v1.43 cache and rustup link:
  /home/family/.cache/solana/v1.43/platform-tools/rust/bin/rustc -> 1.79.0-dev;
  same directory cargo -> 1.79.0 (8d3d6ef09 2024-08-15).
  This is the intended SBF version noted by the existing manifest; no silent
  tools-version override or project lock update to change its compatibility.
- /home/family/.local/opt/flexsoar-tools/node-22.14.0/bin/node -> v22.14.0,
  needed to spawn the Linux validator from the JS harness. Official nodejs.org
  v22.14.0 Linux x64 tarball verified against its official SHASUMS256.txt.
  No Linux npm install/copy of node_modules or project dependency edits.

PATH was explicit per invoked process, no shell startup/operational Solana config
was modified. Rustup's new development toolchain state is the authorized install;
no solana config set, keygen, public deployment, wallet read or broadcast occurred.

### Actual Rust build attempts and the remaining interactive prerequisite

`wsl.exe -d Ubuntu --exec bash -lc 'cd /mnt/c/Users/Family/flexsoar-payment-security/solana && /home/family/.cargo/bin/cargo test --locked --lib'`
Downloaded the existing locked crates, began compilation, FAILED: linker `cc` not
found (No such file or directory); serde_core/quote/proc-macro2/libc/serde build
scripts cannot link. ZERO program unit tests executed; this is not a passing test
or a confirmed defect in the escrow implementation.

`wsl.exe -d Ubuntu --exec env PATH=/home/family/.cargo/bin:/home/family/.local/opt/flexsoar-tools/agave-2.1.0/solana-release/bin:/usr/local/bin:/usr/bin:/bin cargo-build-sbf --manifest-path /mnt/c/Users/Family/flexsoar-payment-security/solana/programs/flexsoar-settlement/Cargo.toml --sbf-out-dir /home/family/.cache/flexsoar-v2-local-build -- --locked`
Downloaded/installed pinned platform-tools and began compilation, FAILED at the
same host build-script linker `cc` not found. Warning: SBF Cargo1.79 does not use
resolver.incompatible-rust-versions; --locked retained the checked-in graph.
No .so produced, so validator payment/escrow scenarios NOT RUN. No signatures or
transactions occurred. No manifest/lock was updated to hide this environment failure.

Ubuntu lacks C compiler/build prerequisites. `sudo -n true` reports
"sudo: interactive authentication is required". Do NOT bypass with WSL root apt
or ask for a password. Human must run in Ubuntu:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends build-essential pkg-config libssl-dev libudev-dev clang protobuf-compiler bzip2 xz-utils
```

Question requesting completion was sent while independent downloads/tests continued.
After this succeeds, repeat both exact commands above. Use explicit PATH including
anchor/node paths for the guarded harness, only after a real successful SBF build:

```powershell
wsl.exe -d Ubuntu --exec env PATH=/home/family/.cargo/bin:/home/family/.local/opt/flexsoar-tools/anchor-0.31.1:/home/family/.local/opt/flexsoar-tools/agave-2.1.0/solana-release/bin:/home/family/.local/opt/flexsoar-tools/node-22.14.0/bin:/usr/local/bin:/usr/bin:/bin node /mnt/c/Users/Family/flexsoar-payment-security/solana/tests/local-v2.mjs --run-local-validator --program-so /home/family/.cache/flexsoar-v2-local-build/flexsoar_settlement.so
```

### Confirmed harness defect corrected before any validator execution

Actual Agave2.1.0 --help documents default --config as the operator's Solana config
and default --mint as client keypair. The previous harness did not explicitly
replace them, so its no-operational-wallet guarantee was incomplete. Changed
solana/tests/local-v2.mjs to require supported --config/--mint flags and create its
OWN unique temporary JSON-as-YAML config containing public loopback context and an
intentionally ABSENT unused-wallet path. Explicit --config, --url=loopback and
--mint=ephemeral bootstrap PUBLIC address prevent fallback to existing wallet/
config files. All transaction secret keys remain in memory; validator-local test
ledger identities are isolated temporary fixtures, never production identities.
No operational config overwritten. node --check passes. Runtime verification of
this fix still depends on successful program build and local validator execution.

### Continued market-render investigation

No shared source/assertion changes. Read-only Vitest loader instrumentation showed
factory2 (shared contract mock near2941) active and its getListings override called
when both market cases passed. A targeted diagnostic run: 2 passed / 245 skipped.
Full-file diagnostic runs varied: four failures in one, FSC two only in another;
in the latter the getListings override was called, not real listing retrieval.
Instrumentation changes no assertions or production persistence and is diagnostic,
NOT a standard suite result. The direct failure mechanism remains the real listing
query reaching an incomplete Supabase mock; duplicate hoisted mock/module loading
interactions remain the suspected underlying cause, not conclusively fixed.

Latest NORMAL `npm test -- --reporter=dot`: exit1, 453 passed / 2 failed / 455,
14 files passed/1 failed. Only known FSC-copy failures at1901/1960. Thus the two
extra market failures are demonstrably intermittent, not a persistent product
regression; they remain unresolved test-isolation debt, not declared repaired.
No shared assertions weakened. Earlier standard typecheck (after generated types)
and webpack build passed; no application TS changed in this continuation, so no
unnecessary full-build repetition. Dedicated payment tests remain 91/91 in latest
full suite. Standard build warning optional Farcaster dependency remains recorded.

Cargo.lock SHA256 remained 5E888973FEF604731800D767F42D347180718C95953D1D0785C595CD66FE36BF.
Human npm pair hashes unchanged and unstaged. Files changed this continuation:
solana/tests/local-v2.mjs (explicit local configuration/wallet isolation) and this
handoff (installed versions, real failed builds, evidence and next commands).
Exports added: none. Funding disabled; no SQL/database writes, production identities,
public signing/broadcasts, real funds, push or deployment. OpenCode not used.


## Actual Rust / isolated-validator verification after OS prerequisites (2026-10-15)

Starting commit 3e95bbf680e1de44caaefc2ce7d1139f6f4066ff, correct branch and
HEAD..main empty. Human npm pair preserved unchanged and unstaged. No project
manifests/lockfiles, deployment configuration, operational keys or SQL changed.
Funding remains hard-coded false. This section supersedes earlier NOT RUN Rust
and validator status; real database/production verification remains outstanding.

### Confirmed implementation defect: SBF stack frames

Native compilation alone missed an actual SBF defect. First locked SBF command
returned exit0 BUT emitted unsafe stack diagnostics: open_sale global offset4808,
buy_sale5672, execute_outcome4704, Open::try_accounts4744 and
Purchase::try_accounts4336 (limit4096). The first artifact was NOT accepted or run.
Changed program src/lib.rs: box ConfigV2/CardControl/SaleV2/TokenAccount account
wrappers in Anchor contexts. No data fields, instruction arguments, serialization,
account ordering, authority rules or dependency versions changed. Transfer helpers
still take Account references through deref coercion. This fixes stack allocation,
not a waiver/suppression of compiler diagnostics.

Native final command (explicit WSL Ubuntu, host Rust/Cargo1.85.1):

```powershell
wsl.exe -d Ubuntu --exec env PATH=/home/family/.cargo/bin:/usr/local/bin:/usr/bin:/bin TMPDIR=/home/family/.cache/flexsoar-rust-tmp CARGO_TARGET_DIR=/home/family/.cache/flexsoar-native-target CARGO_BUILD_JOBS=2 cargo test --locked --manifest-path /mnt/c/Users/Family/flexsoar-payment-security/solana/Cargo.toml --lib
```

PASS exit0, 8 passed/0 failed/0 ignored: 7 explicit production-function/protocol
unit tests plus Anchor-generated test_id. Repeated after boxing: same8/8. Native
warnings include Anchor macro unexpected cfg and deprecations; none suppressed.
An earlier attempt on the mounted Windows target failed linking with "No space
left on device" despite later disk checks showing ample capacity; moving build
and temp files to Linux disk with2 jobs resolved it. Exact transient cause was
not proven. No cleanup of preexisting build/user work was used as a workaround.

Final locked SBF command (Agave2.1.0, platform-tools1.43/Rust1.79.0-dev):

```powershell
wsl.exe -d Ubuntu --exec env PATH=/home/family/.cargo/bin:/home/family/.local/opt/flexsoar-tools/agave-2.1.0/solana-release/bin:/usr/local/bin:/usr/bin:/bin TMPDIR=/home/family/.cache/flexsoar-rust-tmp cargo-build-sbf --manifest-path /mnt/c/Users/Family/flexsoar-payment-security/solana/programs/flexsoar-settlement/Cargo.toml --sbf-out-dir /home/family/.cache/flexsoar-v2-local-build -- --locked
```

PASS exit0, release finished5m53s after boxing; NO stack-limit/overwrite diagnostics.
Two deprecation warnings remain (upgradeable-loader module and macro realloc).
Old Cargo warns about resolver fallback config; checked-in lock stays authoritative.
Artifact /home/family/.cache/flexsoar-v2-local-build/flexsoar_settlement.so SHA256:
99aa6bec4e949de3484bc7fef0b70a83b040bdf92a1060871fe4de8d4c64743c.
Build may create ephemeral local program-key artifacts; none was read or used as
an operational identity. Harness genesis uses only its in-memory test bootstrap.

### Confirmed harness defect: Agave binding is not what --bind-address implies

First startup inspection using ss found RPC18899, pubsub18900 and faucet18901
bound to0.0.0.0 even though --bind-address127.0.0.1 was supplied. Pinned official
Agave v2.1.0 validator/src/bin/solana-test-validator.rs confirms an unspecified
faucet address; this flag does not confine all services. Stopped the owned validator
and harness, verified host ports closed. That interrupted partial run is NOT counted
as successful loopback-only verification. All its transaction requests used127.0.0.1,
only valueless test assets/ephemeral keys; no public-chain connection or real funds.

New solana/tests/run-local-v2.sh launches the ENTIRE harness/validator inside a
fresh ROOTLESS user+network namespace, brings up ONLY lo, with no external network
interface/route and no sudo or host network changes. Agave's wildcard sockets are
therefore reachable only through that namespace's loopback, never the host/LAN.
Before key generation, local-v2.mjs checks that its namespace differs from the
parent and ip -j link lists exactly one UP loopback interface. Direct invocation
outside the namespace was tested: exit1 "private network namespace required",
before keys/validator startup. If unshare/ip/namespace checks fail, tests refuse;
no fallback to exposed host binding or public RPC. Host ss showed no test listeners
during isolated execution or after cleanup. Existing temporary local config and
absent wallet path protections remain; no operational config/key loaded.

Exact successful runtime command:

```powershell
wsl.exe -d Ubuntu --exec bash /mnt/c/Users/Family/flexsoar-payment-security/solana/tests/run-local-v2.sh /home/family/.cache/flexsoar-v2-local-build/flexsoar_settlement.so
```

PASS exit0: 84 ON-CHAIN SCENARIO GROUPS, no failures, using the compiled program,
ephemeral identities and a valueless six-decimal SPL mint. This is a group count,
not84 Rust #[test] functions or a count of all individual assert calls.

Actual runtime coverage:
- Unauthorized bootstrap rejected and config creation rolled back. Old initialize
  and buy instructions rejected. Duplicate governor cannot satisfy native2-of-3.
- Wrong domain/program/config/Card/pair/mode/generation/custody version/authority
  epoch/mint/token program/treasury account/amount split/refund account rejected
  in all3 sales; absent issuer or buyer signer rejected despite sponsored fees.
- Two competing buyers for each of escrow-refund, vaulted-direct, escrow-release:
  exactly ONE finalized purchase; winner debited1,000,000 units, loser debited0.
  Seller/treasury receive950,000/50,000 only for direct or accepted release.
- Insufficient escrow funding rolls back; direct first950,000 transfer followed
  by failed50,000 second transfer rolls back balance AND open sale state.
- Expired authorization rejected; reprice-first fences old revision (direct case).
  Buy-first fences later cancellation AND repricing in both modes.
- Receipt role and exact pair checked; authentication before receipt rejected;
  receipt alone/failed authentication cannot authorize release or acknowledge claim.
- Failed-auth escrow gets full1,000,000 refund including fee allocation; accepted
  escrow releases stored95/5 only. Opposing approval/duplicate execution cannot
  create a second terminal outcome. Concurrent duplicate exits plus conflicting
  refund approval produce one successful exit; stale/batched/replayed commands fail.
- Normal funding pause permits authorized recovery; emergency outflow pause blocks
  execution with principal unchanged, governance resume permits it. Dust7 stays in
  escrow; it neither prevents full principal exit nor becomes withdrawable surplus.
- Future treasury/policy rotation does not retarget already funded release accounts.
  Exit requests occur after original permit's wall-clock expiry without a new buy.
- Only enrolled reconciler can acknowledge terminal outcome; premature/duplicate
  acknowledgements fail. Refunded control quarantined; direct/released controls
  adopt original buyer/vaulted state. This acknowledgement uses a clearly labelled
  SIMULATED DB-commit digest, NOT evidence that Postgres consumed anything.
- Waited for finalized slots; all3 retained961-byte Sale accounts match original
  winner's690-byte permit exactly, with funding Clock inside original authorization
  interval, funded slot retained and terminal outcome slot for release/refund.

Negative tests now require LocalInstructionFailure with a real chain InstructionError;
transport, serialization, fee-signing or RPC/confirmation failures cannot satisfy
program-rejection assertions. Race losers must likewise have actual instruction
errors. This closes a test false-positive gap, not a weakening of assertions.
Captured bounded validator stderr helps diagnose failed startup using test context.

### Limits and release blockers remain

NO actual Postgres schema/RPC/grant/RLS/lock/ledger/outbox test has run. No shared DB
was contacted. Browser/process-loss reconciliation still requires durable human-
authored schema and real least-privilege verifier/settler/executor integration.
Native tests/validator cannot establish those guarantees. All migration contracts
above remain required, including retirement of directly callable legacy overloads.

Not covered by this bounded validator run: cancel-first ordering (reprice-first IS
covered); complete post-ack resale generation cycle; Squads CPI/enrollment and real
staff/human independence; full dispute/reinspection supersession; destination ATA
close/recreation at runtime; archival observer against real validator evidence;
actual browser/worker restart plus DB recovery; public deployments and operational
key rotation. Existing TS fixtures are not substitutes for those missing tests.
IDL-generation workflow was not run; manual canonical instruction/retained-account
ABI is what this harness exercised. No production authority/caps/policy unresolved
items have been silently configured. No launch readiness claim.

Files changed: program src/lib.rs (boxed contexts); local-v2.mjs (strict on-chain
failure assertions, safety/isolation guard and expanded recovery tests);
run-local-v2.sh (rootless loopback-only launcher); this handoff (actual evidence).
No added public TS/Rust exports or frozen signature changes. Human npm pair and
Cargo.lock hashes unchanged. Funding disabled; no SQL/shared DB/production keys/
public-chain activity/real funds/push/deployment. OpenCode not used.

Final normal checks AFTER this continuation's changes:
- npx --no-install tsc --noEmit: PASS exit0.
- npm test -- --reporter=dot: 453 passed / 2 failed / 455, exit1; only known FSC
  copy assertions1901/1960. Dedicated payment suites91/91 within that full run;
  the additional intermittent market failures did not reproduce this time and
  remain documented rather than repaired by unrelated source changes.
- npx --no-install next build --webpack: PASS exit0,40/40 static pages, full route/
  trace completion. Same optional Privy Farcaster module warning; no dependency
  added. Integration credentials removed from build child environment, telemetry
  disabled, no env files/operational secrets supplied. No API/admin/cron invocation.
- node --check local-v2.mjs, bash -n run-local-v2.sh and git diff --check: PASS.
- Final native test process exit0 confirmed; final isolated harness exit0 confirmed.
- Final host ss: no18899/18900/18901/18902 listeners. Direct unsafe invocation
  outside a private namespace fails BEFORE key generation. User dependencies and
  Cargo.lock retained the exact hashes listed above; old data worktree untouched.

Next human action is the reviewed migration/schema implementation in an ISOLATED
Postgres instance, then actual privilege/constraint/locking/crash-recovery acceptance
checks using the plain-English RPC contracts above. Program validation is now real,
but it cannot authorize production funding without database protection, enrolled
operational identities/signing infrastructure and the remaining integration tests.


## 2026-10-16: SQL drafting continuation ? AUTHORING ONLY, NOT APPLIED

Starting source: track/payment-security, HEAD64707bbfc00662d76f8c536f6095ff7626bd5d3a;
HEAD..main empty. No reset/merge/rebase. The founder explicitly authorized NEW SQL
migration/test authorship for this task, overriding the repository SQL-authorship
ban only. SQL execution remains forbidden. No database, SQL parser connected to a
database, migrations, seed, reset, container or database tests were run. The previous
plain-English contract is now backed by DRAFT SQL; none of it establishes live schema.

Human package.json/package-lock.json modifications are preserved, unstaged and exactly
match main's pair (SHA256 D98A62F311AF26DA6B39B095B1D19BA9D6C2CDE7843EBA6FB7A82F6A3201EC8A /
1DEC156573D13BFCA04776527634BBDDD3765B6F5AAFB443599FCE70341DA56F). No dependency edits.
No historical migration was changed. Funding remains compile-time FALSE. Existing
worktrees and old data commits remain untouched. OpenCode was not used.

### Draft file/application order

1.059_payment_v2_records.sql: preflightPG15+/required base columns/card pending_vault,
new NOLOGIN roles, private schema/domains, versioned policy, immutable financial
terms/evidence, sales/generation fences, attempts/candidates, escrow decisions,
operations/outbox/cursors, exact USDC journal, additive orders.payment_rail and
payment_v2_attempt_id. No network/staff/inventory activation or automatic backfill.
The only configuration seed is the already approved MY-USDC-ESCROW-1 policy, digest
834ca943173d4db87622426e161eeb17afcdbac94e37368e6f697430961925c5.
2.060_payment_v2_contracts.sql: session initiation/read/candidates, trusted issuer sale
preparation/canonical690-byte permit construction, verifier recovery/evidence recording.
3.061_payment_v2_settlement.sql: atomic evidence consumption, claim/cache/accounting/
orders/outbox, physical/independent/governance decisions and finalized attestation/
lifecycle consumption, durable administrative obligation queries.
4.062_payment_v2_recovery.sql: cursor/operation/outbox leases, immutable signed operation
identity, failure observation, listing/cancel/redeem adapters, reviewed dispatch evidence.
5.063_payment_v2_permissions_fences.sql: immutable correspondence/terms, exact deferred
USDC allocation and owner-cache/ledger checks, retained configuration audit, legacy
mutation guards/overload retirement, final ownership/RLS/revokes/explicit role grants.

Apply/review all FIVE as a coordinated cutover while application/program funding is
paused. Every intermediate public contract is sealed against PUBLIC/anon/authenticated/
service_role before commit;063 opens only its explicit allowlist. A partial application
is not a runnable marketplace. Do not deploy SQL or the settlement refusal alone.
No new enum values are introduced, so no same-transaction enum consumption issue.
If any preflight/object/ownership conflict occurs, stop and preserve the error/catalog;
write a separately reviewed forward repair. Do not edit migration history, drop financial
records or use a destructive rollback. New IDs059..063 were unoccupied at drafting.

### Durable records and invariants

All payment-v2 tables are private. No client/worker receives table DML. Most records
are immutable and all financial identities/consumptions are retained, with restrictive
foreign keys rather than cascade cleanup. Mutable records retain tombstones. Staff
key/person/user/role identities cannot be rewritten; active assignment can rotate to
a new row, while old decision actors remain referencable. Network/staff changes append
a configuration audit record. Human setup/authority changes are administrative trust,
not an application service-role capability.

Inventory enrollment binds exact Item/Card/pair commitments with independent inventory
and reviewer persons; enrollment is manual, never SKU inference or migration backfill.
Sales bind the listing, original seller/token account, immutable full network snapshot,
mode/custody version/generation/revision, MYR price and policy. Mode is derived from
Item.custody and enrolled CardControl mode, not client terms. One fenced sale per Card
and listing; generations cannot be reused. Repricing uses finalized revocation then a
NEW generation/listing/sale, not a mutable quote or unsafe reservation expiry. Rust's
revise_sale is not exposed by these DB contracts.

Trusted issuer quote books contain total USDC base units, FX source snapshot and time
interval. Users cannot insert them or choose amounts/wallets/mode/beneficiaries. Attempts
bind the buyer session/user, SHA256(UUID bytes) attempt and beneficiary commitments,
original wallet/ATAs, seller/treasury/refund accounts, quote, policy, MYR gross/fee/net
and USDC total/net/fee. Separate denomination columns: NEVER write USDC into legacy
amount_cents. Net/fee are exactly total minus floor5% / floor5%. All19keys, sevenu64s
and twoi64s encode in the existing Rust/TypeScript Permit order,690bytes, FSOARV2-NUL,
version2. No alternative signing protocol or digest-as-payment-proof was added.

Events are verified-role assertions about independently checked FINALIZED transactions,
not a SQL cryptographic verifier. They must correspond to the stored permit, original
funding time interval, network/program/sale/attempt/mode and revision. Unique genesis+
signature prevents cross-program reuse on the same chain; sale uniqueness permits
one funding/direct outcome and at most one release/refund terminal outcome. Signatures
submitted by buyers remain untrusted candidate rows. Deleting/relinking cannot release
an identity for reuse. Consumers compare full order/receipt context BEFORE returning
idempotent success. Conflicting evidence, references or returned order IDs fail.

Attempt states: initiated -> authorized -> funded/direct -> released/refunded as applicable;
unresolved is reserved for explicit investigation, never a downgrade of paid state.
Expiry is an immutable authorization boundary, not evidence no payment occurred. No
expiry job resets paid state, unlocks a sale or offers another payment. Expired/abandoned
unfunded authorization UI must still ask for chain status until finalized revocation or
consumption is established. Current API status retains the persisted finance state;
it does not invent terminal unpaid status from a wall-clock timeout.

### Atomic claim/accounting contract

Common lock order: Item -> Card -> Sale -> Listing -> Attempt -> Escrow -> Evidence/
Decision -> sorted user/account rows. Initial unlocked reads discover IDs only. Purchase,
terminal reconciliation and admin transitions re-read mutable predicates under these
locks. Cursor/operation/outbox claims lock only their own durable work rows; they never
perform a financial transition. Existing receipts are authorized by privileged consumer
role plus immutable buyer/listing/Card/attempt/network/permit/reference correspondence.

- Funded seller-held: seller ledger/cache ownership -> conditional buyer, Cardpending_vault,
listing sold, orderescrow_funded, escrowfunded, dispatch deadline fundedAt+48h and review
fundedAt+72h. Buyer-wallet debit / escrow liability credit in USDC journal. No seller or
platform revenue yet. Exact paired Card ledger entries and append-only claim_history.
- Vaulted direct: same atomic claim transfer, ordersettled, buyer-total/seller-net/treasury-
fee USDC allocation. Card active but sale fence remains until finalized chain acknowledgement.
- Receipt: immutable staff command and separately verified finalized record_receipt;
physical custody becomes warehouse, but authentication remains pending, no payout and no
Card unlock. Receipt never stamps authenticated_at/by. No legacy vault trigger runs.
- Authentication: separate immutable actor/pair/evidence, independent person from receiver;
failed authentication leaves claim locked. Independent rejection review requires a dispute
hold and distinct reviewer; resolving a hold does not replace release approval.
- Release: independent release person's acceptance command after receipt/pass, verified
on-chain authorization revision, then queued bounded execute_outcome. Only FINALIZED
released evidence moves escrow principal -> original seller95%/treasury5%, marks order
settled, updates Item authentication metadata from authentication evidence, and Card active.
The sale still fences all mutations until acknowledgement. No generic withdrawal authority.
- Refund: explicit reason and manual two-person governance, then verified authorized refund
revision and finalized full-principal outcome. Escrow -> ORIGINAL buyer principal, including
unreleased fee. Orderrefunded; paired conditional claim reversal to seller; Cardlocked and
inventory quarantined. No seller ban/relisting/new Card/physical-return assertion.
- Direct/released/refunded consumption enqueues acknowledge_claim only AFTER the financial
DB commit is guaranteed by the same transaction. Verified acknowledgement clears the sale
fence; success increments custody version/modevaulted; refund keeps quarantine. Another
sale cannot replace unresolved CardControl state.

Consumption, exact USDC journal allocations, Card ledger/cache/provenance, order/attempt/
escrow/sale changes and notification outbox are one Postgres transaction. Deferred checks
compare exact account allocations, not merely a zero sum, and cache against Card holdings.
Claim history is a NEW append-only private table; legacy card_provenance rows stay unchanged.
Market read/timeline integration must include v2 history before launch.

Orders' gross/fee/net remain MYRsen valuation snapshots. V2 cash_cents/credit_cents are0,
seller_payout/payout_release_atNULL; paid_out staysfalse and stripe_transfer_idNULL.
Those fields are not USDC seller-payment status. Solana proceeds are recorded in v2 state
and USDC journal. Stripe selection/execution remain dormant; no Stripe path was repaired.
A balanced journal alone cannot prove funds moved: that relies on the separate authoritative
verifier and actual chain evidence. No database function signs or calls networks.

### Actual public RPCs and callers

All names below are prefixed fn_payment_v2_. Argument names in the SQL are the JSON RPC
keys, not optional positional aliases. No old purchase overload remains callable.

| Suffix and actual input types | Result | Caller / DB principal |
|---|---|---|
| prepare_sale(p_listing_id uuid,p_network_id uuid,p_terms jsonb) | uuid | preparePaymentSale; issuer |
| authorize_attempt(p_attempt_id uuid) | text hex690bytes | authorizePaymentAttempt; issuer |
| initiate(p_listing_id uuid,p_idempotency_key uuid,p_policy_version text,p_policy_digest text) | jsonb AttemptStatus | initiatePaymentAttempt; authenticated session |
| own_attempts(p_listing_id uuid) | jsonb array | ownPaymentAttempts; session buyer only |
| attach_candidate(p_attempt_id uuid,p_signature text) | void | attachPaymentCandidate; session owner only |
| recovery_binding(p_attempt text,p_genesis text,p_program text) | jsonb permitHex/appliedKinds | reconcilePayments; verifier |
| record_verified_event(p_event jsonb) | uuid | reconcilePayments; verifier |
| reconcile_event(p_event_id uuid) | jsonb original receipt | reconcilePayments fourth injected client; settler |
| begin_scan(p_genesis text,p_program text,p_limit integer) | jsonb leaseId/afterAddress | reconcilePayments; verifier |
| finish_scan(p_lease_id uuid,p_last_address text,p_failures jsonb) | void | reconcilePayments; verifier |
| record_decision(p_decision jsonb) | uuid operation | recordPaymentDecision; enrolled action-specific staff session |
| approve_refund(p_command_id uuid) | uuid same operation | approvePaymentGovernance; independent governor session (also dispute resolution) |
| record_attestation(p_proof jsonb) | void | recordPaymentAttestation; verifier, NOT arbitrary admin session |
| record_lifecycle(p_proof jsonb) | void | recordPaymentLifecycle; verifier |
| record_operation_failure(p_operation_id uuid,p_proof jsonb) | void | recordPaymentOperationFailure; verifier |
| claim_operations(p_worker_id uuid,p_limit integer) | jsonb leases | claimPaymentOperations; executor |
| operation_context(p_operation_id uuid,p_lease_id uuid) | jsonb immutable context | paymentOperationContext; executor |
| finish_operation(p_operation_id uuid,p_lease_id uuid,p_outcome text,p_signature text,p_error text) | void | finishPaymentOperation; executor |
| claim_outbox(p_limit integer) | jsonb jobs | claimPaymentOutbox; notifier |
| finish_outbox(p_id uuid,p_lease_id uuid,p_delivered boolean,p_error text) | void | finishPaymentOutbox; notifier |
| list_card(p_card_id uuid,p_seller_id uuid,p_price_cents integer,p_payout_method text,p_fair_price_cents integer) | uuid | frozen listCard wrapper; session owner, explicit cash display election |
| request_cancel(p_listing_id uuid,p_actor uuid) | void | frozen cancelListing; owner session |
| redeem_card(p_card_id uuid,p_user_id uuid,p_address jsonb,p_fee_cents bigint) | uuid, always refusal | frozen redeemCard; unsupported shipping proof/CardControl retirement stays blocked |
| review_dispatch(p_id uuid,p_escrow_id uuid,p_kind text,p_digest text,p_route text,p_accepted_at timestamptz) | void | reviewed dispatch integration pending; reviewer session |
| admin_queue() / admin_obligations() | jsonb | enrolled staff session; existing queue plus separate full-obligation RPC integration pending |

prepare_sale p_terms keys: idUUID, saleAddress/escrowAddressbase58, totalUnitsdecimal,
fxSnapshotobject, validFrom/expiresAtdecimal i64seconds. SameID/fullterms retry returns
original sale; altered terms/listing/network raise conflict. Mode/buyer/routing are never
client financial inputs. authorize_attempt returns immutable original bytes even after
expiry for recovery; returning bytes is NOT permission to sign/broadcast an expired or
paused authorization. Builder/signing still disabled. New authorizations check current
epoch/issuer/policy and configured positive caps/independent enrolled authority set.

record_verified_event JSON matches the production orchestrator: genesis/program/sale/
attemptbase58, kindfunded|direct|released|refunded, signature, slotinteger,
fundedAtSecondsdecimal, permitHex, decisionRevisiondecimal, finalityfinalized. Funding/
direct revision is ALWAYS0, so later release/hold revisions do not change original funding
receipt identity. This fixes a production retry mismatch discovered during this drafting.

record_decision retains escrowId/commandId/expectedRevision/action/evidenceDigest/
pairCommitment. Added actions map to the EXISTING program: receipt->record_receipt tag0;
authentication_pass/fail->record_authentication tag1/2; release->authorize_release3;
refund->authorize_refund4; dispute->dispute_hold5; resolve_dispute_release/refund->
resolve_dispute6/7; review_authentication_pass/fail->review_authentication8 with explicit
boolean. Refund/refund-resolution additionally requires refundReason seller_default,
authentication_rejection or approved_loss. Default rejects verified transit OR receipt;
rejection requires original fail evidence+48elapsed hours. No automatic timer refund.

Attestation proof additionally binds commandId, action, exact pair/evidence, actorbase58,
network/program/sale, signature/slot/finality, executedAtSeconds and resultingRevision.
Lifecycle proof binds saleId/kindopened|revoked|acknowledged, network/program/sale,
generation/revision, signature/slot/finality; acknowledgement also binds outcome and
cardCommitmenthex. A finalized opening observed after a cancel request preserves the
cancel intent; it must not reopen purchase availability. A verifier MUST independently
verify actual instruction, all canonical arguments/accounts, signer/role/governance/CPI
and finalized account transition. The SQL proof JSON/digest is correspondence/audit only.
The existing financial observer does NOT yet implement receipt/authentication/lifecycle/
Squads-governance verification; wrappers are not substitutes. This is a release blocker.

### Permissions / deployment prerequisites

Roles: payment_v2_owner NOLOGIN owns objects/SECURITY DEFINER functions; issuer prepares
immutable quotes/permits, verifier writes verified observations, settler consumes them,
executor leases bounded operations, notifier leases notifications. All are separate roles.
Privileged functions check **session_user membership**, not current_role, JWT role, arbitrary
GUC, user-supplied signature or digest. Non-superuser workers must belong to exactly ONE
worker role and cannot be members of owner/authenticator/service_role/authenticated/anon.
Superuser/migration administrators remain an explicit trust boundary, like program upgrade
authority. They are never application credentials.

Human must provision distinct login principals/connections for issuer/verifier/settler/
executor/notifier, their per-role membership and connection secrets OUTSIDE this branch.
For NOINHERIT principals the direct connection adapter can SET LOCAL ROLE to its assigned
role inside a transaction; session_user must remain the distinct login. Do not grant
privileged roles to PostgREST authenticator/service_role or use JWT role spoofing to make
an RPC work. Existing Supabase createServiceSupabase cannot provide this separation.
No direct PostgreSQL driver/credential integration was installed or fabricated. PaymentRpc
is the typed injection boundary; a reviewed dedicated-login transport remains required.
Two wrapper objects pointing to one credential do not establish separation; DB checks do.

Internal reconciliation route now returns503 rather than calling shared service_role,
even when the previous local-reconciliation flag is set. Authenticated legacy receipt and
own-attempt reads remain available; they do not write settlements. The orchestration
requires a separately injected settler and fails before observation if missing/same object.
Current application workers cannot use the new privileged DB contracts until the dedicated
transport is supplied. Funding stays hardcoded false irrespective of flags/network rows.

Legacy retirement in063 enumerates actual pg_proc overload identities/defaults, replaces
all corresponding reference-only purchase/core/credit, list/cancel/redeem, vault shipment/
receipt/default/cancellation and money-moving trade bodies with refusal, and revokes all
non-owner execute ACLs. Old outstanding offers therefore cannot bypass locks. Guard
triggers also protect EVERY enrolled Item/Card/listing/order/ledger/redemption/vault/provenance/
trade/associated-credit-hold write even through legacy postgres-owned SECURITY DEFINER
helpers; registered Item replacement Card INSERT is fenced. Direct financial DML and column
grants to public/anon/authenticated/service_role are revoked; schema CREATE is revoked.
Legacy grading/mint/custody functions may operate only on unenrolled historical inventory;
registered pairs require v2 transitions. Unsupported trading/redemption remain disabled.
The generic old receipt/unlock/order-intake triggers are removed via the NEW migration.
These are intentional coordinated compatibility breaks, not a standalone production patch.

### Recovery / operations and cutover

Operation/cursor/outbox leases are durable, bounded5minutes, CAS on leaseID plus connection
identity, with SKIP LOCKED and30second retry backoff. Persist signed signature BEFORE
network submission using finish_operation(submitted); unknown/submitted never return to
unsigned pending or change signature. A lost response recovers the original operation.
Finalized failed transaction proof may close a failed operation without marking funds paid/
unpaid. Financial reconciliation resolves/supersedes pending commands with a verified-event
FK and explicit no-command-success inference; an old pending revoke cannot keep retrying
after funded consumption. Notification deliveryKey is the immutable outboxUUID; provider
idempotency and transport still need integration. Delivery failure never rolls back a prior
financial commit; crash after provider delivery needs that same delivery key.

Receipt/authentication/release intent persists BEFORE signing. Acceptance without release
remains funded/locked. Release/refund finalized with DB failure stays recoverable from original
retained Sale/attempt/evidence; no second payment/refund. Database commit without chain ack
keeps the sale fenced. Browser, worker or wallet relinking never changes destinations or resets
paid status. Scan failures append unresolved records; cursor wraps on complete scan and does
not erase obligations. No database transaction performs network, signing, email or cron work.

Solana/Postgres are NOT atomic together. One shared on-chain sale consumption protects two
competing buyers in BOTH modes; database reservations do not. Finalized program ordering
resolves purchase versus revoke/expiry; DB cancel intent cannot revoke a previously signed
transaction. A winning finalized payment is consumable even when cancel_requested, and quote
expiry is checked against ORIGINAL execution time, not recovery time. Impossible/conflicting
chain/DB ownership is an explicit unresolved obligation, not a silent loss or second payment.

Panda remains legacy direct: no escrow fabricated, no replay, no automatic classification
from sol: prefix.059 labels all existing rows legacy_unverified by new metadata only; original
rows/references/amounts/paid_out/transfers/journals are not rewritten. Existing authenticated
receipt/recovery of already-recorded orders stays intact. An old successful but UNRECORDED
legacy payment still needs separately reviewed authoritative legacy reconciliation; retiring
reference-only RPCs does not solve that case. Before cutover: freeze legacy issuance, inventory
signed/unknown attempts, observe original program/network history and explicitly resolve them.
Never tell a paid buyer to pay again. Program legacy-buy rejection, builder/UI gates, database
permission changes, verifier/settler deployment and operator procedures must roll out together.

### Human isolated application/test instructions and catalog evidence

See tests/payment-db/README.md for exact psql commands, target guard, fixture roles and
manual two-session procedures. These are INSTRUCTIONS FOR HUMAN REVIEW, not execution
authorization for this agent. Use new disposable loopback DB flexsoar_payment_v2_test,
Supabase auth/roles/extensions and checked-in historical schema through058; independently
verify synthetic-only identity, port/process/no tunnel and no production credentials/data.
Apply named059..063 in order only after review. Run10/20/30 separately;40..42 deliberately
commit synthetic concurrency fixtures and require two sessions.70/71 commit a30second
synthetic authorization then require actual expiry before relink/recovery; no timestamp rewrite.
All SQL scenarios remain NOT RUN, including syntax compilation under Postgres.

Before any eventual PRODUCTION migration the human must obtain read-only catalog evidence:
server_version_num; migration history/version inventory; table/column names/types/defaults/
nullability/generated attributes from pg_class/pg_attribute/pg_attrdef; pg_enum labels;
pg_constraint definitions/validation/FK delete/update rules; pg_index unique/partial predicates;
all relevant pg_proc identities, identity+full arguments/defaults, results, source, language,
prosecdef/proconfig/owner/ACL and dependent functions; pg_trigger definitions/enabled state and
functions; pg_policy definitions and RLS/FORCE flags; pg_namespace owners/ACL; table+column+
sequence ACLs; pg_default_acl; pg_roles attributes and transitive pg_auth_members membership.
Cover every purchase/core/credit/list/cancel/redeem/trade/mint/burn/authenticate/grade/custody/
vault/default/payout helper and any additional live SECURITY DEFINER entry point not checked
in. Include view definitions/owners/security options and function dependencies. Obtain aggregate
conflict counts for duplicate references, ledger/cache mismatches, dangling ownership/custody,
legacy pending payments/holds/intakes, outstanding offers and unresolved operations?no customer
PII dump. Inspect each unknown function/grant before accepting this allowlist. No live catalog
was contacted; a deployed extra bypass cannot be ruled out from checked-in files.

### Test authorship, static review, and release blockers

New SQL fixtures assert against ACTUAL new RPCs/constraints, not duplicated settlement logic:
10 canonical permit offsets/modes, correspondence/immutability/duplicate consume, exactMYR vs
USDC, claim fences, receipt/pass separation, failed-auth lock, all enumerated legacy overloads;
20 release/refund full principal+exclusion/idempotency, independent review/governance, signed
operation recovery, leases/outbox/rollback;30 real negative session authorization/JWT spoofing/
row access/direct DML and overloaded grants;40..42 actual held-transaction duplicate settlement
in both modes;70/71 expired original authorization, wallet relink, lost response recovery.
Synthetic historical sol: orders are compared unchanged; this is NOT access to the real Panda.

Static review found and corrected: funding receipt revision instability after later decisions;
shared service-role verifier+consumer route; NULL lease expiry checks; missing execution-intent
queue after approval; cancellation arriving before open observation; stale revoke/execution jobs
after financial consumption; governance retry correspondence; principal journal denomination and
exact allocation (including coincident buyer/treasury aggregation); physical receipt previously
conflated with authentication; retained staff rotation identities. None of these text reviews is
a passed SQL check. No Postgres syntax/grants/locking/deadlock/isolation/durability assertions have
been executed. Production compatibility remains conditional on live catalog comparison.

Still required: positive distinct non-superuser principal tests; full program-observer-DB loopback
integration; additional conflicting two-session evidence/release-refund/cancel/worker lease races;
actual finalized attestation/lifecycle/Squads verification; bounded signer and outbox provider
integration; Card history/status/customer/admin surfaces and claim retirement/trades support;
isolated schema execution/forward repairs; deployment identities/governance/caps/config readiness;
legacy signed-transaction cutover; independent security review. No funding activation authorized.
Business-day calendars, carrier liability, rejected/counterfeit disposal and post-release rights
remain unresolved operational policy; no deductions/timeouts/refund promises were invented.

Additive TS exports (all worker clients use PaymentRpc injection): preparePaymentSale(issuer,
listingId,networkId,PaymentSaleTerms)->Promise<string>; authorizePaymentAttempt(issuer,attemptId)
->Promise<string>; paymentOperationContext(executor,{id,leaseId})->Promise<Record<string,unknown>>;
finishPaymentOperation(executor,{id,leaseId},outcome,signature,error)->Promise<void>;
recordPaymentAttestation(verifier,proof)/recordPaymentLifecycle(verifier,proof)->Promise<void>;
recordPaymentOperationFailure(verifier,operationId,proof)->Promise<void>;
approvePaymentGovernance(session,commandId)->Promise<string>; claimPaymentOutbox(notifier,limit?)
->Promise<PaymentOutboxJob[]>; finishPaymentOutbox(notifier,{id,leaseId},delivered,error)->Promise<void>.
PaymentOperation now retains lease/payload/signature/recoveryOnly; PaymentDecision adds existing
program review/resolution actions and explicit refundReason. No frozen TypeScript signature changed.
Order types add optional drafted rail/attempt fields and escrow/refund statuses; no fixture casts.


Final executable verification for this SQL-drafting continuation:
- npx --no-install tsc --noEmit: exit0, including the final adapter/type/test changes.
- npm test: initial456total/452passed/4failed. A subsequent dot-reporter run461total/
456passed/5failed (extra shared-suite failures; terminal output truncated one failure's
identity). JSON rerun461total/459passed/2failed. FINAL npm test with JSON reporter:
463total/461passed/2failed, exit1, only unchanged FSC-copy assertions1901/1960.
Do not infer intermittent failures are repaired from this later successful subset.
Existing shared mocks at invariants110/2911 and2925/2998 collide/incompletely model
next/navigation/usePathname and Supabase .select().in(); earlier market renders either
throw missing usePathname or log missing .in and fail empty-state assertions. Their
underlying scheduling variability and the truncated fifth failure remain unresolved;
no shared assertion or market component was modified.
- Focused payment3files before the final two extra assertions:97/97, exit0. FINAL full
run includes payment-db-adapters6/6, payment-v248/48, purchase-payment45/45 =99/99.
These exercise actual production TS adapters/orchestration, using explicit RPC doubles;
they DO NOT prove PostgreSQL or role/lock guarantees.
- npx --no-install next build --webpack: exit0,40/40pages and route/trace completion,
including final production source changes. Existing optional Privy @farcaster/mini-app-
solana resolver warning remains; no dependency changes, ignoreBuildErrors or suppressions.
- git diff --check: exit0. Text-only inventory found28new public contracts all represented
in the final grant classifier and paired dollar delimiters. This is not SQL parsing,
compilation or a passed database check. ALL SQL/migration/integration/concurrency tests
remain NOT RUN. Rust/program untouched, no new Rust/validator run in this SQL task.
- No .env files or integration credential environment names were present in this worktree/
validation shell; no secrets supplied. No database/API/admin/cron calls were invoked by
this work. No SQL execution or database connections. No external signing/broadcast,
real funds, emails, push or deployment. Funding stays disabled.

Changed file inventory (only these task files are intended for this commit):
- supabase/migrations/059_payment_v2_records.sql ? durable records, denominations, policy and roles.
- supabase/migrations/060_payment_v2_contracts.sql ? canonical immutable authorization and trusted evidence RPCs.
- supabase/migrations/061_payment_v2_settlement.sql ? atomic financial/claim/physical/governance reconciliation.
- supabase/migrations/062_payment_v2_recovery.sql ? durable leases, signed-identity recovery and lifecycle adapters.
- supabase/migrations/063_payment_v2_permissions_fences.sql ? correspondence, legacy retirement, RLS/ACL/owner hardening.
- tests/payment-db/00_target_guard.sql ? explicit synthetic loopback identity acknowledgement.
- tests/payment-db/01_fixtures.sql ? reusable synthetic fixtures/assertion helpers, not independently runnable.
- tests/payment-db/10_contracts.sql ? canonical contract, ownership, immutable evidence and legacy-overload assertions.
- tests/payment-db/20_outcomes_recovery.sql ? release/refund, governance, outbox/operation/cursor and rollback assertions.
- tests/payment-db/30_permissions.sql ? negative actual connection-role/JWT/grant/ownership tests.
- tests/payment-db/40_concurrency_setup.sql ? committed disposable fixtures for two independent sessions.
- tests/payment-db/41_session_a.sql ? hold financial locks for duplicate-settlement race.
- tests/payment-db/42_session_b.sql ? competing duplicate caller and exact-order/count checks.
- tests/payment-db/70_expiry_setup.sql ? short-lived originally authorized synthetic payment observation.
- tests/payment-db/71_expiry_relink_recovery.sql ? expired/relinked original-attempt recovery without new payment.
- tests/payment-db/README.md ? human-only application/testing/forward-repair instructions.
- lib/db/payment-v2-workers.ts ? dedicated-role typed adapters; no fabricated DB transport or signer.
- lib/db/payment-v2.ts ? lease/identity-retaining operations, governance actions and refund reason.
- lib/db/payment-reconciliation.ts ? distinct settler injection and stable funding receipt revision.
- lib/db/types.ts ? optional new rail/attempt metadata and truthful financial status semantics.
- lib/api/contract.ts ? additive worker exports only; frozen signatures unchanged.
- app/api/internal/solana/reconcile/route.ts ? remove shared service-role fallback; fail closed.
- tests/payment-db-adapters.test.ts ? actual adapter/route tests with isolated doubles.
- tests/payment-v2.test.ts ? actual orchestration connection separation/stable receipt tests.
- docs/handoff/payment-security.md ? this exact contract, limitations, evidence and human dependencies.

The operational executor currently persists signature identity, not a complete durable
signed-transaction blob. Crash before broadcast may need explicit non-execution/status
investigation; no automatic replacement signature or buyer payment is authorized. A full
signing/transport integration must persist any required serialized transaction/blockhash
metadata before sending and prove safe recovery. No worker or route currently executes
those operations, and no production functionality is claimed for those missing pieces.

Next human action: review059..063 and the synthetic-target prerequisites, apply ONLY to
a new isolated test database, collect first application/errors/catalog and run authored
contracts/negative-role/multi-session tests. Keep funding disabled. Then provision/review
dedicated connection transport and actual attestation/lifecycle verifiers, and run the
full loopback program-observer-Postgres recovery scenarios. Production is blocked.

## Review fixes after bb3943e � 2026-10-17 local session

Status: executable application/offline changes plus REVISED UNAPPLIED DRAFTS; funding
remains disabled. No SQL, database connection, public-chain action or email occurred.
The user authorized revising059�063 as unapplied drafts. This session cannot establish
migration application state without a prohibited database connection. HUMAN MUST
confirm these drafts have never been applied before using the revisions. If any was
applied, preserve that deployed history and author/review forward migrations instead.
The earlier signature-only limitation above is superseded ONLY for the bounded
execute_outcome operation described below, not generic authority/funding operations.

Confirmed defects and corrections:

1.061 locked public.users FOR UPDATE despite063 supplying SELECT only. It neither
updates user balances nor depends on mutable current wallet links: attempts retain
original financial destinations. Removed those unnecessary locks, retaining the
Item ? Card ? Sale ? Listing ? Attempt/Escrow serialization and foreign-key integrity.
063 gives owner a SELECT-only users RLS policy and fails if table/column UPDATE is
inherited. No worker/service_role receives user mutation rights. Dedicated settler38
and administrator46 now test complete escrow/direct settlement under final ownership.
This privilege fix is statically reviewed, NOT runtime-proven until human SQL runs.

2.Different TS wrapper objects were insufficient credential separation. The new
worker_identity RPC checks actual session_user membership, rejects superusers and
unknown/null roles, and returns the login. Reconciliation asks both connections for
verifier/settler identities before scanning; equal logins fail. SQL require_role still
rejects owner/service/authenticator/ordinary memberships and multiple worker groups.
Do not implement both connections with one service-role credential. Offline doubles
test the application guard; only real separate LOGIN sessions prove permissions.

3.Operation finish formerly accepted signature-only submitted/unknown and could attach
a signature via unsigned retry. Both paths now fail without durable bytes or reject
that retry. New immutable signed_operations stores operation/network FK, exact raw
transaction, envelope, signature, transaction/message SHA256, blockhash and last valid
block height, staging login/time, unique(network,signature); UPDATE/DELETE forbidden.
It is private under final owner/RLS/ACL setup, readable only through live executor
lease RPCs. Customer/admin/outbox responses do not expose the raw transaction.

4.A new contradictory funded/direct observation after finalized revocation could enter
the event queue before later settlement refused it.060 now rejects novel funding when
Sale is not open/cancel_requested; an exact previously recorded receipt still recovers.
It does not reverse chain finality or fabricate a second valid outcome.

Durable signed-operation contract (SQL signatures / actual TS callers):

- fn_payment_v2_worker_identity(p_required_role name) ? jsonb:
  paymentWorkerIdentity(client:PaymentRpc,role:worker-role-union):Promise<string>.
- fn_payment_v2_signed_operation(p_operation_id uuid,p_lease_id uuid) ? jsonb
  {plan,envelope|null}: loadSignedOperation(executor,operationId,leaseId).
- fn_payment_v2_stage_signed_operation(p_operation_id uuid,p_lease_id uuid,p_envelope jsonb)
  ? void: stageSignedOperation(executor,operationId,leaseId,value).
- Existing finish_operation frozen arity is unchanged; submitted/unknown now requires
  matching signed_operations. retry must remain genuinely unsigned.
- Private exit_plan(uuid) derives execute_outcome program/accounts/data from immutable
  Sale, network snapshot, funded attempt and operation revision, never client terms.
- New additive contract exports: loadSignedOperation, stageSignedOperation,
  signedOperationRecovery, paymentWorkerIdentity. No frozen contract signature changed.
- Production helper exports parseExitPlan(value:unknown):ExitPlan;
  inspectSignedOperation(value:unknown,expected:ExitPlan):SignedOperationEnvelope;
  loadSignedOperation(...):Promise<{plan:ExitPlan;envelope:SignedOperationEnvelope|null}>;
  stageSignedOperation(...):Promise<SignedOperationEnvelope>;
  signedOperationRecovery(value,plan,observed:RecoveryObservation):RecoveryDecision.
  Types are declared in lib/db/payment-signed-operation.ts.

Bounded recovery and trust model:

The supported envelope contains ONE standalone execute_outcome instruction, one real
fee-payer signature, no lookup tables, nonce or extra instructions. Actual Ed25519,
canonical serialization, program, revision, ordered account keys/flags, instruction
bytes, signature/hash/blockhash correspondence are verified in production TS against
an INDEPENDENT leased DB plan on both staging and loading. Sponsored execution fees
are allowed; no buyer signing authority is inferred from this permissionless exit.
SQL checks envelope correspondence, canonical bytes/hashes and first signature bytes;
SQL DOES NOT independently implement Ed25519 or decode the complete Solana message.
Dedicated executor is trusted to use the production inspector. A malicious executor
cannot turn stored bytes into verified payment: verifier and settler remain separate.

Before broadcast, await stage RPC COMMIT acknowledgement. It stores bytes and pins
signature/state atomically, keeping the lease. If ACK is lost, DO NOT send or sign anew:
load under the live/reclaimed lease and compare immutable bytes. Before persistence,
no broadcast is permitted; a crash then creates no authorized send. After persistence
but before send, after a lost broadcast response, restart or takeover, first observe
original signature AND retained Sale at a consistent finalized context. The recovery
policy requires exact network/genesis/program/Sale/signature identity. Terminal Sale
or successful finalized signature means RECONCILE, not locally mark paid/unlocked.
Pending/unavailable/finalized failure/unknown state/hold/revision mismatch/pause/expired
or invalid blockhash stays blocked. Only a complete not-found observation with still
funded matching revision and valid original blockhash/height returns IDENTICAL bytes.
That decision function has no signing or send primitive. A missing RPC response never
means no execution. LastValidBlockHeight is provider metadata, not Solana-signed data;
the real trusted observer must also check blockhash validity and finality consistently.

Still required: dedicated-login transport, real trusted observation/sender integration,
blockhash provider binding, sender lease discipline, approved replacement-operation
protocol for irrecoverably expired/finalized-failed transactions, and full isolated
program-observer-Postgres recovery tests. No automatic replacement or buyer repay path
exists here. Other operations (authority attestations, Squads, open/revoke, funding)
have no supported signed-plan storage and CANNOT mark submitted through this path.
They need separately reviewed exact plan encodings/integration; remain fail-closed.
A stale executor can retain signed bytes after lease loss: database CAS cannot revoke
a transaction; program Sale terminal/revision fencing is the final financial guard.

Authored database verification � ALL NOT RUN:

-35 setup plus36issuer/37verifier/38settler/39executor/40notifier/46results require FIVE
actual non-superuser LOGIN connections, each ONLY one worker group. They test real
session_user, no owner/service/authenticator membership, positive role RPCs, cross-role
rejections and direct protected-table DML denial.30 retains JWT impersonation negatives.
Setup commits synthetic-only fixtures/roles in named loopback disposable target, creates
no credentials and refuses existing test role names. Two wrappers do not count.
-45 exports a public synthetic plan, offline make-signed-fixture.mjs generates a real
valueless ephemeral signature WITHOUT saving a key, and47 stages/retries/reads it and
rejects changed validity. Synthetic blockhash must NEVER be broadcast. Exact human
commands/order, authentication requirements and lease caveats are in payment-db README.
-50�57 add independent-session barriers for conflicting signature/attempt, canonical
release vs adversarial refund (both orders), pending cancellation vs funding, finalized
revoke vs contradictory funding, funded vs contradictory revoke, rollback after writes,
competing operation/outbox workers and expired lease takeover/stale completion. Only ONE
canonical chain result is asserted. Terminal observation uses verifier then a SEPARATE
settler56;53 asserts exact order/cache/claim history/ledger/event/consumption/journal/
outbox results.57 isolates queue eligibility to known synthetic IDs;54 changes only
synthetic lease clocks, avoiding nondeterministic sleeps. These tests do not prove
on-chain exclusivity; they test database arbitration only IF later executed.
-Existing deferred constraints are forced with SET CONSTRAINTS ALL IMMEDIATE before
rollback/commit. No single-session test is called concurrent proof. No SQL parser,
server, migration runner, container or database test was invoked in this session.

Changed-file inventory for this review (dependencies excluded):
- lib/api/contract.ts: additive durable-recovery/identity exports.
- lib/db/payment-reconciliation.ts: actual connection identity guard before observation.
- lib/db/payment-v2-workers.ts: identity adapter and reject signature-bearing unsigned retry.
- lib/db/payment-signed-operation.ts: exact signed-message validation/storage/recovery policy.
- supabase/migrations/059_payment_v2_records.sql: immutable private signed envelopes.
- supabase/migrations/060_payment_v2_contracts.sql: contradictory post-revocation funding guard.
- supabase/migrations/061_payment_v2_settlement.sql: remove unjustified users row locks.
- supabase/migrations/062_payment_v2_recovery.sql: bounded signed-plan/lease RPCs and identity.
- supabase/migrations/063_payment_v2_permissions_fences.sql: minimum users policy and RPC grants.
- tests/payment-v2.test.ts: actual credential-identity application guard cases.
- tests/payment-signed-operation.test.ts: actual SDK/Ed25519/adapter/offline recovery cases.
- tests/payment-db/01_fixtures.sql: optional initiate-only fixtures for real issuer/verifier.
- tests/payment-db/02_attestation_fixture.sql: shared synthetic canonical attestation helper.
- tests/payment-db/20_outcomes_recovery.sql: shared helper and reject signature-only finish.
- tests/payment-db/30_permissions.sql: ordinary identity/signed-store RPC denial.
- tests/payment-db/35_workers_setup.sql: committed disposable worker principals/fixtures.
- tests/payment-db/36_worker_issuer.sql: real issuer success and denied cross-role/DML.
- tests/payment-db/37_worker_verifier.sql: real verifier success and denied cross-role/DML.
- tests/payment-db/38_worker_settler.sql: real settlement/idempotency/permission regression.
- tests/payment-db/39_worker_executor.sql: real lease/context/signed-plan authorization.
- tests/payment-db/40_worker_notifier.sql: real notifier lease/retry and denied cross-role/DML.
- tests/payment-db/45_export_synthetic_plan.sql: public plan export under actual executor.
- tests/payment-db/46_worker_results.sql: exact persisted identities and financial results.
- tests/payment-db/47_signed_storage_contract.sql: exact offline signed-envelope SQL contract.
- tests/payment-db/make-signed-fixture.mjs: bounded OS-TEMP-only offline fixture generator.
- tests/payment-db/50_races_setup.sql: canonical/adversarial cases and real queue logins.
- tests/payment-db/51_race_a.sql: explicit first transaction/barrier.
- tests/payment-db/52_race_b.sql: explicit competing transaction/barrier.
- tests/payment-db/53_race_assert.sql: exact committed financial/lease invariants.
- tests/payment-db/54_expire_test_lease.sql: synthetic-only deterministic expiry.
- tests/payment-db/55_stale_worker.sql: old-lease completion rejection.
- tests/payment-db/56_consume_canonical_terminal.sql: separate authorized terminal consumer.
- tests/payment-db/57_prepare_queue_case.sql: synthetic queue eligibility isolation.
- tests/payment-db/README.md: human-only real-connection/race instructions and limitations.
- docs/handoff/payment-security.md: review evidence and remaining integration blockers.

Validation of this review:
- npx tsc --noEmit: exit0, normal installed dependencies/configuration.
- npm test -- --reporter=json --outputFile=<OS TEMP>/flexsoar-payment-review-final.json:
  488 passed /2 failed /490 total. ONLY the two unchanged PricePayout FSC-copy assertions
  in shared invariants.test.ts fail. No shared assertion changed.
- Focused npx --no-install vitest run tests/payment-signed-operation.test.ts
  tests/payment-v2.test.ts tests/payment-db-adapters.test.ts:81/81, exit0. Includes real
  offline SDK signing, Ed25519 and fixture-generator invocation, no network/SQL.
- Final normal webpack build result is recorded below after completion.
- SQL compilation, effective grants/RLS, real connection permission success, deferred
  constraints and all separate-session races: NOT RUN. TS doubles are not database proof.
- Rust/program unchanged this review; no new Rust/validator run. OpenCode was not used.
- Human manifest/lockfile remain byte-identical to reviewed main pair and are excluded
  from staging. No dependency request/install/change, no SQL execution, DB connection,
  production credentials, public-chain signing/broadcast, emails, push or deployment.

Next human action: confirm059�063 were never applied, review revisions and README,
prepare a fresh disposable named loopback database with reviewed baseline roles/schema,
then separately authorize/apply and run real-principal and multi-session tests exactly
as documented. Capture first error/catalog/role/lock/results evidence for forward repair.
Do not activate funding: actual DB/runtime authority/recovery integration is unverified.

Final webpack validation: npx next build --webpack exited0, generated40/40pages and
completed route/trace output. Existing optional Privy @farcaster/mini-app-solana resolver
warning persists; missing Stripe key was reported (no credentials supplied). No type
error bypasses or dependency edits. git diff --check exited0 (line-ending notices only).
Human race instructions explicitly use interactive psql with \\i and open connections;
psql -f exiting before a human barrier would roll back and is NOT a valid race run.

Additional authored terminal-consumption barrier files:
- tests/payment-db/58_terminal_consume_a.sql: actual settler holds terminal consumption
  transaction open after financial writes; explicit human COMMIT only.
- tests/payment-db/59_terminal_consume_b.sql: separate settler backend waits and returns
  the identical canonical receipt.53 checks both receipts and exact financial counts.
Use58/59 instead of sequential56 on a fresh terminal case. Both represent the same
canonical terminal evidence, never two purported valid release/refund outcomes. NOT RUN.

## Database suite final completeness gate (after5c3db0e)

Founder explicitly confirmed059�063 have NEVER been applied anywhere. No migration
file is changed in this follow-up; no SQL execution or database connection occurred.
Starting HEAD was5c3db0e05a103208b1aece2781dfacf838de3949 on track/payment-security;
HEAD..main was empty. Human dependency modifications and the pre-existing untracked
payment-security-5c3db0e.diff are preserved and excluded from the commit.

The incremental46/53 assertions remain, but only90_final_acceptance.sql can certify
suite completion. New03 creates private, disposable-test-only explicit completion
records with session_user, backend PID, timestamp and details. Its SECURITY DEFINER
recorder has a fixed scenario allowlist, verifies dedicated worker identity/expected
login for worker checkpoints, and reserves administrative checkpoints for its actual
setup owner. PUBLIC/anon/authenticated/service_role have no access; workers get only
helper execution, no direct table DML. This is trusted test instrumentation, not a
financial RPC or a malicious-administrator-resistant audit system.

Workers36�40 and signed-storage47 record success in their assertion transaction.
Core10/20/30 and expiry71 record completion only AFTER successful assertion flow and
intentional fixture rollback.46/53 now COMMIT successful checkpoint writes;53 still
skips unfinished cases for incremental use. Final90 requires34 explicit successful
checkpoints, including every five-role worker, core/signed-storage/expiry case, duplicate
settlement in BOTH modes, twelve named races, BOTH terminal-consumer backends for EACH
terminal case, explicit rollback acknowledgement, and BOTH stale-worker rejections.
Missing checkpoints fail. It reruns actual worker/financial assertions, checks dedicated
login names and distinct backend PIDs, and only after successful COMMIT emits the
persisted final row and PAYMENT_DB_FINAL_ACCEPTANCE_COMPLETE. Fixture rows or lack of
errors do not constitute successful completion.

41/42 now retain mode-specific committed checkpoints, with actual assertions replacing
boolean-only acceptance.50 records race backend PIDs.58/59 refuse missing consumption
rows and commit terminal checkpoints with the original financial transaction.55 refuses
missing original lease observations and commits explicit stale-completion rejection
checkpoints.60 is HUMAN acknowledgement in original A backend after its documented
ROLLBACK; final90 requires a distinct A/B backend for that case. A PID cannot prove
overlap or that a human observed a lock wait: retain interactive transcripts and
pg_locks/pg_stat_activity evidence. Sequential56 does NOT satisfy mandatory58/59.

Exact final HUMAN command, after all prerequisite/setup/scenarios in payment-db README,
using verified isolated PGHOST/PGPORT/PGDATABASE/PGOPTIONS and original setup owner:

```powershell
psql -X -v ON_ERROR_STOP=1 -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -f tests/payment-db/90_final_acceptance.sql
if ($LASTEXITCODE -ne 0) { throw 'Payment database final acceptance FAILED or incomplete' }
```

New test-only functions (no application exports/signatures changed):
- payment_db_acceptance.assert_true(p boolean,label text) ? void.
- payment_db_acceptance.complete(p_scenario text,p_details jsonb) ? void.

File inventory:
- tests/payment-db/03_completion_setup.sql: private explicit completion recorder/ACLs.
- tests/payment-db/10_contracts.sql: successful core checkpoint after fixture rollback.
- tests/payment-db/20_outcomes_recovery.sql: successful outcome checkpoint after rollback.
- tests/payment-db/30_permissions.sql: successful authorization checkpoint after rollback.
- tests/payment-db/36_worker_issuer.sql: explicit real issuer completion.
- tests/payment-db/37_worker_verifier.sql: explicit real verifier completion.
- tests/payment-db/38_worker_settler.sql: explicit real settler completion.
- tests/payment-db/39_worker_executor.sql: explicit real executor completion.
- tests/payment-db/40_worker_notifier.sql: explicit real notifier completion.
- tests/payment-db/41_session_a.sql: first duplicate-consumer mode/backend checkpoint.
- tests/payment-db/42_session_b.sql: asserted counts and second duplicate checkpoint.
- tests/payment-db/46_worker_results.sql: commit successful result checkpoint.
- tests/payment-db/47_signed_storage_contract.sql: explicit signed storage completion.
- tests/payment-db/50_races_setup.sql: actual race backend PID capture.
- tests/payment-db/53_race_assert.sql: commit successful named incremental race checks.
- tests/payment-db/55_stale_worker.sql: missing-row rejection and durable stale checkpoint.
- tests/payment-db/58_terminal_consume_a.sql: explicit successful first terminal consumer.
- tests/payment-db/59_terminal_consume_b.sql: explicit successful second terminal consumer.
- tests/payment-db/60_rollback_ack.sql: original backend human rollback acknowledgement.
- tests/payment-db/71_expiry_relink_recovery.sql: explicit successful expiry/relink recovery.
- tests/payment-db/90_final_acceptance.sql: strict34-checkpoint gate and committed final result.
- tests/payment-db/README.md: exact order/command, test semantics and isolated setup plan.
- docs/handoff/payment-security.md: evidence, scope and unverified boundaries.

Local database tooling investigation (NO CONNECTIONS): Windows wsl.exe exists; PostgreSQL
binaries, psql, Docker and Supabase CLI were absent from PATH and checked standard
Program Files/WinGet link locations. WSL Ubuntu executes as family, x86_64, filesystem
about950GiB available. Its PATH and checked system/local-user locations found no
PostgreSQL/Docker/Supabase tooling. Bounded inventory is not an exhaustive disk search.
An initial dpkg formatted probe and a later quoted shell loop had Windows/WSL quoting
errors; direct executable probes were used to avoid treating those errors as absence.

Immediate human setup step: provision a Docker-compatible runtime (e.g. Docker Desktop
with Ubuntu integration), reviewed standalone Supabase CLI, and psql client, without
project dependency edits. Official prerequisites reviewed:
https://supabase.com/docs/guides/local-development/cli-workflows . Then, after separate
SQL/bootstrap authorization, create a NEW out-of-worktree local Supabase stack with
empty app migrations/no seeds/no linked cloud project and loopback ports. Real auth
schema/functions and roles are required; vanilla PostgreSQL alone or an auth stub is
insufficient. Prepare the named flexsoar_payment_v2_test database using ONLY the fresh
local bootstrap schema, then review/apply001�058,059�063 and03 explicitly. See README
for default stack dbname versus named-test-target handling. No production/shared dump,
credentials or data snapshot is needed. No database is claimed ready or verified.

Verification this follow-up:
- npx tsc --noEmit: exit0.
- npm test -- --reporter=json --outputFile=<OS TEMP>/flexsoar-db-completeness-tests.json:
  488 passed /2 failed /490 total, only unchanged shared PricePayout FSC-copy assertions.
- Final webpack result will be recorded below when the running command completes.
- All new/modified SQL, completeness gate, permissions, constraints and concurrency:
  NOT RUN. Static source review is not SQL compilation or database proof.
- No production application/Rust/funding configuration changed. Funding remains disabled;
  existing dedicated connection, chain observer/sender, replacement-operation and isolated
  end-to-end integration blockers remain. No dependency install/change, keys, public-chain
  actions, emails, push or deployment. OpenCode was not used.

Final normal webpack validation: npx next build --webpack exited0,40/40pages and full
route/build-trace completion. Existing optional Privy @farcaster/mini-app-solana warning
remains; no configuration suppression or dependency edit. No environment files or
integration-credential environment names were present in this validation shell.
Final direct WSL probes (no shell quoting) reported dpkg-query: no packages found for
postgresql, postgresql-client, postgresql-16/17, docker.io/docker-ce/podman; ls reported
all checked PostgreSQL/local/user executable paths absent. Windows winget.exe exists
at the current user's WindowsApps link. Immediate HUMAN installer step may use
winget install --exact --id Docker.DockerDesktop --source winget, then enable its
Ubuntu WSL integration. Nothing was installed or started here. CLI/psql and reviewed
fresh-local Supabase schema preparation are still required afterward; no ready database
or one-command schema bootstrap is claimed. git diff --check: exit0.

Additional discovery: Windows per-user Programs/DockerDesktop and Programs/PostgreSQL,
plus Scoop Supabase/PostgreSQL locations were absent. wsl.exe --version reports
WSL2.7.14.0/kernel6.18.33.2-2. Official Docker Windows/WSL installation guidance:
https://docs.docker.com/desktop/setup/install/windows-install/ . Final90 additionally
requires complete current worker/race case inventories and retained terminal-consumer
results so no zero-row loop can stand in for actual verification.

## First actual isolated database run after69c6161 � BLOCKED before001

User explicitly authorized ONLY the disposable local DB, upstream bootstrap, isolated
connections, historical/application migrations and synthetic tests. No shared/cloud DB
access was authorized or performed. Starting branch/HEAD: track/payment-security at
69c616130622f200a6f578474c2a44185d965b21; HEAD..main empty. Human dependency pair and
payment-security-5c3db0e.diff preserved byte-for-byte; no environment/credential files read.

Windows AND Ubuntu Docker Client/Server verified29.8.2. Pulled official image
supabase/postgres:17.11.0.004, resolved immutable digest:
sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc.
Image entrypoint docker-entrypoint.sh, Cmd postgres -D /etc/postgresql, PGDATA
/var/lib/postgresql/data and actual migrate.sh/init files were inspected BEFORE
startup. Inspection used a NEVER-STARTED container; its metadata/zero StartedAt was
archived and that configuration-only object removed before configuring the same name
with exact approved mounts. No failed DB/data was removed or recreated. The first and
only executed database container is:
- name:flexsoar-payment-db-69c6161-20261016T022841Z
- ID:71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92
- preserved RUNNING/healthy for review, no reset/cleanup.

Before startup AND after bootstrap, inspected JSON assertions confirmed network none,
no port bindings/exposed runtime ports, privileged=false, and exactly three bind mounts,
all read-only: /audit/hba.conf, /audit/migrations, /audit/tests/payment-db. No repository
root, environment file, Docker socket or unrelated volume/network mounted/modified.
Main server listens only127.0.0.1:5432. All connections used docker exec with explicit
PGHOST=127.0.0.1, PGPORT5432, PGDATABASE=flexsoar_payment_v2_test, PGUSER=supabase_admin.
The container-only HBA permits socket/loopback test logins; it changes no host/global
configuration. Built-in upstream pg_cron/pg_net initialization is image bootstrap, not
application workers; no job, HTTP request, notification, email or chain action invoked.
No external network is available inside the container.

Actual upstream bootstrap executed initdb and official bundled migrations, reaching
ready/healthy PostgreSQL17.11. A preliminary pre-readiness TCP probe returned connection
refused and is preserved separately, not treated as a migration failure. Catalog checks
then succeeded and verified exact DB/address/session identity, API roles and real grants,
pgcrypto1.3 in extensions, citext1.6 available but not yet installed (001 would install),
supabase_realtime publication, zero public application tables, zero auth.users rows.
Postgres role is NOT superuser; supabase_admin IS superuser. Auth uid/role/email helpers
are owned by supabase_auth_admin, with PUBLIC execute and API schema access. Authenticator
is a member of anon/authenticated/service_role, not an invented worker/owner role.

FIRST BLOCKING FAILURE: auth.jwt() is absent from this image's DB-only bootstrap.
Explicit READ ONLY prerequisite assertion failed with psql exit3:
BOOTSTRAP_PREREQUISITE_MISSING: auth.jwt(); STOP before application migrations.
Thus the reviewed preparation document's claim that this DB-only image alone provides
all needed modern Auth helpers was incorrect.036 and053 depend on auth.jwt(). We did
NOT proceed until those files failed later, fabricate a helper, skip a policy, change
a guard, or recreate the environment. Historical001�058: NONE EXECUTED.059�063: NONE
EXECUTED. Database fixtures/tests/dedicated workers/races/expiry/90: ALL NOT RUN.
The34-checkpoint gate has NOT passed and no completion marker was inserted manually.

Exact forward bootstrap repair PROPOSAL (NOT executed; requires review):
Official Supabase Auth tagv2.197.0 resolves to commit
4eee58f296d9698a1c2c0ae14d7a0b379c7622d3. Review and apply its function-only files:
1.migrations/20220224000811_update_auth_functions.up.sql � canonical uid/role/email
  support null-safe individual claims plus request.jwt.claims JSON fallback.
2.migrations/20220531120530_add_auth_jwt_function.up.sql � canonical jwt() returns
  JSON from request.jwt.claim or request.jwt.claims, with upstream deprecation comments.
https://github.com/supabase/auth/tree/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3/migrations
Render ONLY the Namespace template as auth; execute as real supabase_auth_admin owner
in THIS preserved isolated DB after review, preserving existing helper ACLs/ownership.
Verify exact source/namespace/ownership, API execution rights, both claims formats and
missing/empty settings. Do not insert a permissive auth shim, mark all GoTrue migrations
applied, run an Auth HTTP server, or claim full auth integration. No payment forward
migration is necessary yet because no payment migration was applied. Re-run preflight
before starting the explicit001..063 manifest. User instruction forbids executing an
unreviewed repair; none was executed. No historical file modified.

Preserved evidence directory (Ubuntu):
/home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
- pull.log,image-digest.txt,image-metadata.json: actual image identity.
- docker-entrypoint.sh,upstream-init/,image-postgresql.conf: actual startup source.
- never-started-inspection.json,inspection-object-removal.txt: pre-start inspection lifecycle.
- container-id.txt,configured-before-start.json,runtime-isolation.json: isolation evidence.
- bootstrap.log,bootstrap-final.log: retained init/startup SQL logs.
- bootstrap-catalog-attempt1-connection-refused.txt: early readiness transport probe.
- bootstrap-catalog.txt,auth-ownership-after-stop.txt: actual catalog/role/function evidence.
- bootstrap-preflight-result.txt,bootstrap-preflight.exit: explicit missing-function failure3.
- migration-sequence-status.txt: explicit application sequence NOT STARTED.
No PGDATA, private keys or other key material were read/exported. Automatic upstream
local key initialization is confined to this test image; no operational wallet/key used.

Only source files changed this task:
- tests/payment-db/README.md: actual first-run blocker, evidence identity and reviewed-repair prerequisite.
- docs/handoff/payment-security.md: this verified run record and remaining blockers.
No new export, TypeScript, Rust, historical/payment migration or assertion edits.

Application validation (separate from the DB bootstrap):
- npx tsc --noEmit: exit0.
- npm test -- --reporter=json --outputFile=<OS TEMP>/flexsoar-isolated-bootstrap-app-tests.json:
  exit1,486 passed /4 failed /490 total. Two unchanged PricePayout FSC assertions plus
  BOTH Market page signed-out empty-state assertions at invariants.test.ts3180/3186.
  They expected Nothing listed yet in rendered HTML. No application/shared-test source
  was changed. Do NOT report this run as the previous488/2 baseline.
- Targeted npx --no-install vitest run tests/invariants.test.ts -t 'Market page'
  --reporter=verbose: exit0,2 passed /245 skipped. Additional full-suite render failures
  are therefore unresolved interaction/intermittence, not established production regressions.
  Inspection found TWO hoisted mocks for the same contract module (lines253,2941), only
  the later overriding getListings to []; cached.ts retains module-level results. This
  is a plausible interaction to investigate, not a proven cause. No shared assertion
  weakened and no market-lane edit. Relevant owner: market/shared-test track.
- Webpack final completion will be recorded below. No app credentials were supplied.
- Funding remains compile-time false; Stripe containment unchanged. No payments, wallet
  signatures, broadcasts, emails, pushes, deployments or unrelated Docker changes.
- OpenCode was not used. DB/full Solana?Postgres recovery guarantees remain UNVERIFIED.

Final validation completion: npx next build --webpack exited0, generated40/40pages and
completed routes/build traces. Existing optional Privy @farcaster/mini-app-solana resolver
warning persists; Stripe key absent as expected, no credentials supplied. No suppression,
dependency edit or source workaround. git diff --check exited0 (line-ending notices only).
Next concrete action: review/authorize the pinned official Auth function-only forward
bootstrap described above in the PRESERVED container, then repeat prerequisites before
any historical/application migrations. No unreviewed repair or further SQL transition
was executed after the catalog stop. The database-suite/full-chain acceptance is not met.

## Authorized Auth repair and first historical failure (after3cb6996)

User authorized ONLY the two reviewed official Auth files in the EXISTING isolated
container, then resumption of the already-reviewed migration/test manifest. Reverified
container71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92,
name flexsoar-payment-db-69c6161-20261016T022841Z, network none/no published ports,
three exact read-only mounts and actual DB flexsoar_payment_v2_test over127.0.0.1:5432.
No container recreated/reset; earlier logs and initial failure are retained. Image digest
remains6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc.
Starting branch/HEAD: track/payment-security at3cb6996a1302c0d8f718da3ba17b36b056dd3e92;
HEAD..main empty. Human package pair/exported diff preserved. No historical source edit.

Fetched from official supabase/auth at EXACT commit
4eee58f296d9698a1c2c0ae14d7a0b379c7622d3, in this order:
-20220224000811_update_auth_functions.up.sql:
 SHA2565b72022d73e64a8e474d2122ac42f299bb7ce4d59755cdcc78e72abfe5d47dc0.
-20220531120530_add_auth_jwt_function.up.sql:
 SHA25691d2d5e47f19e65a63ec411f6cbb18755ec1792cb4249694dc261ef59cc78a10.
Preserved raw sources/hashes and rendered copies; ONLY Namespace template replaced by
auth. Executed via actual session_user supabase_auth_admin, one stop-on-error transaction.
Recorded preexisting helper owner/ACLs and auth.schema_migrations before execution.
Within transaction compared all three old owners/ACLs unchanged, verified new jwt owner
supabase_auth_admin, LANGUAGEsql STABLE, returnsjsonb, prosecdef=false. No broad GRANT
or SECURITY DEFINER wrapper was issued. New jwt ACL inherits the existing upstream
creation defaults (PUBLIC execute plus postgres/owner/dashboard_user entries), observed
and recorded rather than silently changed. Schema USAGE plus function EXECUTE checks
passed for anon/authenticated/service_role.

Auth verification and COMMIT succeeded, exit0:
- uid/role/email individual claim GUCs return synthetic expected values.
- Empty individual settings fall back to request.jwt.claims JSON.
- jwt reads request.jwt.claim and request.jwt.claims; singular takes precedence.
- Missing/empty settings give NULL as upstream defines; '{}' gives empty JSON with
  NULL uid/role/email fields; jwt does not manufacture JSON from individual claims.
- Existing ownership/ACLs unchanged; no application tables/Auth users introduced.
- auth.schema_migrations exact seven-version array unchanged; no unrelated GoTrue
  migration version was inserted. No Auth HTTP service was started.
Post-commit full bootstrap preflight passed, exit0: exact target/identity, real API
roles, uid/role/email/jwt present, pgcrypto installed/citext available, publication,
zero application/Auth data. Actually invoked all helpers with synthetic JSON claims
under SET LOCAL ROLE anon, authenticated and service_role in a rolled-back read-only
transaction; returned values asserted. This is effective API-role execution testing,
NOT a substitute for dedicated worker connection tests (still not reached).

Historical application: the approved preparation document's EXPLICIT75-file manifest
was compared to git69c6161's tracked migration list. No wildcard runner/default seed,
no global wrapping transaction, no file modification. Each file has its own source
SHA256, stdout/stderr log and recorded exit.24 files exited0/committed:
001_schema through018_condition_grades (18files),019a/019b/019c,020,021,022.
FIRST FAILURE: file25,022b_permissions_lockdown.sql, psql exit3 at line233:
022b: 1 function(s) now have multiple arities.
Stopped immediately;022b's BEGIN..COMMIT transaction rolled back. Catalog proves its
fn_require_self_or_admin creation absent and fn_purchase_card_with_credit removal
rolled back. No022c or later historical file,059�063, fixture, dedicated worker,
signed envelope, concurrent session, terminal, stale lease, expiry or90 was run.
No manual success checkpoint. Payment_v2 schema does not exist. Final acceptance NOT MET.

Precise cause (source AND live isolated catalog):
014_fixes.sql281 drops3-arg fn_list_card and283 creates4-arg with payout defaultcash.
019c_settlement.sql324 recreates3-arg geography-derived fn_list_card WITHOUT removing
014's4-arg.022 drops old purchase overloads only.022b's no-multiple-arities assertion
therefore correctly finds fn_list_card twice. Later031 drops both, but cannot be run
out of order to bypass this failed historical assertion.
Actual remaining signatures, owner supabase_admin, both SECURITY DEFINER:
-public.fn_list_card(uuid,uuid,integer),3-arg body SHA256
 e3d880decc1b277f84bac789ff28a00d8158852271a765c0ad221cc83ec0e7d0.
-public.fn_list_card(uuid,uuid,integer,public.payout_method),4-arg body SHA256
 111d3b253c4b4f3c70cb3a372d773314ceab21627216ae6473bfc0e058341095.
pg_depend reports ZERO dependent objects for4-arg. Current public schema24tables,
public.users0rows, auth.users0rows. These are reference/schema-only migrations, no
customer records. Old local historical privileges are not yet hardened by022b/v2;
network-none/no app server/funding-disabled state remains essential. No source-only
finding is claimed to prove a production exploit or loss.

NEXT REPAIR PROPOSAL (NOT EXECUTED): review/authorize a separate forward compatibility
step at THIS post022 database state to retire EXACTLY obsolete4-arg fn_list_card with
RESTRICT after asserting exact identity/owner/body/dependency evidence above. Preserve
canonical3-arg geography-derived function and its grants. No CASCADE, data deletion,
blanket overload drop, changed assertion, historical edit or manually marked success.
Then rerun unchanged022b and resume only after it succeeds, without replaying001�022.
No payment migration was applied, so there is no payment-v2 schema repair yet. User's
instruction prohibits further unreviewed repairs; no drop/repair beyond approved Auth
files occurred. This is historical compatibility, not permission to rewrite history.

New evidence under original run directory:
-auth-repair-20261016T024714Z/: pinned raw/rendered upstream source, SHA256s,
 repair-transaction.sql, before.txt, repair-result.txt/repair.exit0,
 post-repair-preflight.txt/post-repair-preflight.exit0, isolation-before.json.
-migrations-20261016T024929Z/: explicit-manifest.txt,source-hashes.txt,results.tsv,
 each file.log,first-failure.txt,failure-catalog.txt,listing-overload-diagnosis.txt,
 preserved-container-after-stop.json. Initial bootstrap failure evidence remains.
Container/data are preserved RUNNING, no unrelated Docker resource touched.

Source changes this task:
-tests/payment-db/README.md: current repaired Auth state, actual historical stop and exact next repair proposal.
-docs/handoff/payment-security.md: this execution/verification/provenance record.
No production code, frozen export, SQL historical/payment migration, dependency or test
assertion changed. No new API exports. No Auth service, application worker, shared/cloud
connection, operational key, public-chain RPC/signing/broadcast, email, push or deployment.
Compile-time funding remainsfalse. OpenCode was not used.

Relevant application checks (NOT database acceptance):
-npx tsc --noEmit: exit0.
-npm test -- --reporter=json --outputFile=<OS TEMP>/flexsoar-auth-repair-app-tests.json:
 exit1,488 passed /2 failed /490total, only unchanged shared FSC-copy assertions.
 Prior run's two market-render failures did not recur; no source fix was made and
 their intermittent/shared-test interaction is not declared resolved.
-Webpack result will be appended on completion. Database-suite acceptance and complete
 Solana?Postgres recovery remain UNVERIFIED; no inference from application mocks/tests.

Final application validation: npx next build --webpack exited0,40/40pages and complete
route/build-trace output. Existing optional Privy @farcaster/mini-app-solana warning
remains; no dependency/configuration suppression. git diff --check exited0. All requested
Auth checks succeeded; historical022b is the NEW stop. Environment and failed transaction
evidence retained, no further repair executed. Next approval is specifically the obsolete
4-arg listing overload retirement and unchanged022b retry, not another Auth repair.

## Approved listing-overload compatibility repair; migration060 stop

Started track/payment-security atc3b3cd4dfd8397c4603b2d81bb92e3c501245997;
HEAD..main empty. User approved ONLY retiring obsolete4-arg fn_list_card in the EXISTING
synthetic DB, then continuing unchanged manifest. Actual target reverified:
container flexsoar-payment-db-69c6161-20261016T022841Z,
ID71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92,
network none, zero published ports, three exact read-only /audit mounts. All connections
internal127.0.0.1:5432, DBflexsoar_payment_v2_test, actual session_user supabase_admin.
No environment reset/recreation or unrelated Docker resource change.

Captured BOTH listing definitions/owner/ACLs/dependencies BEFORE the DROP. Asserted:
-two exact overloads, owners supabase_admin, SECURITY DEFINER;
-canonical3-arg body SHA256e3d880decc1b277f84bac789ff28a00d8158852271a765c0ad221cc83ec0e7d0,
 matching019c geography-derived implementation;
-obsolete4-arg SHA256111d3b253c4b4f3c70cb3a372d773314ceab21627216ae6473bfc0e058341095,
 matching014 payout-choice implementation;
-zero pg_depend dependents of obsolete4-arg;
-fn_require_self_or_admin absent and old fn_purchase_card_with_credit present, confirming
 failed022b rolled back. Guarded exact target identity again inside repair transaction.

First approved repair ATTEMPT ROLLED BACK: my post-drop verification joined pg_proc
and called pg_get_functiondef(p.oid); planner evaluation encountered an aggregate and
raised `"array_agg" is an aggregate function`. This was an orchestration verification
query defect, not a changed schema/dependency finding. That attempt's repair.sql/hash,
full before/error log and exit3 are preserved at listing-repair-20261016T025744Z/.
No DROP committed. Corrected ONLY the verification query to use direct canonical
regprocedure identity; owner/ACL comparison remained exact. Retry reran all exact guards
and found unchanged pre-repair state. Identical approved DROP FUNCTION ... RESTRICT
retired ONLY4-arg; full canonical definition/owner/ACL comparison passed; COMMIT exit0.
Successful evidence at listing-repair-20261016T025811Z/ includes SQL/hash/result/isolation.
No CASCADE, broad grant, policy weakening, historical edit or unrelated DROP.

Resumed fixed manifest at022b ONLY. Original001�022 successful files were not rerun.
Unchanged022b passed.022c through058 and059 also passed. Current unique successful
manifest files:71/75 (all70 historical files plus059). Later031/032 replaced3-arg
listing as explicitly encoded by unchanged history; canonical preservation was verified
at repair COMMIT, not asserted to survive intentionally superseding later migrations.

NEW FIRST FAILURE in resumed sequence:060_payment_v2_contracts.sql, psql exit3,
source line124 (end of fn_payment_v2_prepare_sale): syntax error at end of input;
error points to line111's `OR v.mode<>CASE i.custody WHEN 'seller' THEN 0 ELSE 1 END`.
The PL/pgSQL IF condition needs the CASE expression parenthesized to keep its internal
THEN within the expression parse boundary. Captured060 log and original failed SQL.
060's BEGIN transaction rolled back entirely: catalog confirms require_role(name) and
prepare_sale(uuid,uuid,jsonb) absent;059 records schema remains committed. Networks0,
attempts0. No061�063 or tests executed; no manual success checkpoint. No repair beyond
approved overload DROP was executed. No public/customer data or Panda imported.

Source correction DRAFTED, NOT EXECUTED: one line of failed/unapplied060 now reads
`OR v.mode<>(CASE i.custody WHEN 'seller' THEN 0 ELSE 1 END)`.
No custody interpretation, ownership rule, role, grant, amount or predicate changed.
Applied059 and ALL historical files untouched.060 correction is a reviewable pending
revision, NOT claimed SQL-compiled/passed. After review/authorization retry060 only,
then061�063 and full suite on success. Do NOT reapply059 (its schema already exists),
skip failure or label migration successful. A forward migration is unnecessary for060
because its complete transaction rolled back and no060 object persisted.

New preserved run evidence under /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/:
-listing-repair-20261016T025744Z/: first verification-query failure/rollback.
-listing-repair-20261016T025811Z/: guarded approved repair, canonical unchanged, commit0.
-migrations-resume-20261016T025824Z/: exact resume manifest, per-file logs/source hashes,
 results.tsv, first-failure.txt,060-failed-input.sql,060-failure-catalog.txt.
Prior Auth/bootstrap/022b-failure directories retained. No failed data/environment erased.
No SQL in tests/payment-db was executed. Dedicated worker, signed-storage, actual race,
terminal, rollback/stale-lease, expiry tests and90_final_acceptance are ALL NOT RUN.
The34-checkpoint gate has not passed. Full Solana?Postgres recovery is not verified.

Source files changed:
-supabase/migrations/060_payment_v2_contracts.sql: one-line parser correction, unapplied.
-tests/payment-db/README.md: actual71-file progress, approved repair and next review gate.
-docs/handoff/payment-security.md: this evidence/status record.
No TypeScript/Rust/export/signature/dependency/shared-assertion changes. Human package
pair hashes remain D98A62F311AF26DA6B39B095B1D19BA9D6C2CDE7843EBA6FB7A82F6A3201EC8A
and1DEC156573D13BFCA04776527634BBDDD3765B6F5AAFB443599FCE70341DA56F. Exported diff preserved.
This compatibility repair applies ONLY to this synthetic historical replay. Production
catalog must be independently reviewed before ANY analogous proposal/application;
no shared/cloud/production connection was used. Funding remains disabled, no network
configuration inserted. No operational keys, public-chain activity, emails, push or
deployment. OpenCode was not used.

Application verification, distinct from unrun database-suite acceptance:
-npx tsc --noEmit: exit0.
-npm test -- --reporter=json --outputFile=<OS TEMP>/flexsoar-listing-repair-app-tests.json:
 exit1,488 passed /2 failed /490total, only unchanged FSC-copy assertions.
-Webpack completion recorded below when finished. Application tests cannot validate
 060 syntax or Postgres grants/locking; revised060 SQL remains NOT RUN.

Final validation completion: npx next build --webpack exited0 with40/40pages and full
route/trace output. Existing optional Privy @farcaster/mini-app-solana warning persists;
no suppression or dependency change. git diff --check exited0. Final Docker inspection
still shows exact ID running, networknone, PortBindings{}. Next action is review of
one-line unapplied060 correction and explicit permission to retry060, then061�063 on
success.059 must remain untouched. No database-suite or full-chain acceptance claimed.

## Isolated execution update: 060�062 committed; 063 blocked (2026-10-16)

Reverified container flexsoar-payment-db-69c6161-20261016T022841Z, exact ID
71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92,
network none, no published ports, and exactly three read-only audit mounts.
Internal connection: flexsoar_payment_v2_test / 127.0.0.1 / supabase_admin.
Reviewed bbbf315: executable diff only parenthesizes the CASE expression in 060.
059 remained committed; require_role and prepare_sale were absent before retry.
Corrected diff, hash, per-stage input and results preserved outside the repository.

Retried ONLY 060, then 061 and 062: each COMMIT, psql exit 0. No historical migration
or 059 was rerun. Unique completed manifest files now 74/75.
063 failed, psql exit 3 at line 130: record "t" is not assigned yet. Its DO $triggers$
block declares record t and also aliases pg_trigger as t. PL/pgSQL resolves t.tgname
to the unassigned record, preventing the query from running. Entire 063 rolled back:
terms_guard() and configuration_history absent; both legacy automatic triggers remain.
Networks and attempts remain zero. 060 require_role and 061 reconcile_event persist.

STOP: this is PL/pgSQL variable/alias name resolution, not a SQL grammar error.
Proposed narrowly scoped repair for review: rename only the pg_trigger query alias
from t to tr in that block (SELECT tr.tgname, JOIN ... tr.tgrelid/tr.tgfoid, predicate
NOT tr.tgisinternal). Keep the loop variable t and DROP TRIGGER operands unchanged.
No repair source change or retry was made; permissions/locking/selection must remain
identical. After approval, revise only rolled-back 063 and retry only 063, then suite.
Do not rewrite successful 059�062. Do not execute tests before final permissions apply.

Evidence: /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
migrations-retry-20261016T040807Z/ contains corrected.diff, corrected.sha256,
060�063 inputs/logs, results.tsv, 063-failed-input.sql, 063-failed.sha256 and
063-rollback-catalog.txt. Earlier errors/evidence preserved. An initial WSL git lookup
failed because the worktree .git points to a Windows path; no SQL ran in that attempt.
Windows git inspected the commit; Linux diff compared the preserved failed input.

Database suite: NONE executed. Dedicated workers, signed storage, concurrent sessions,
terminal consumption, stale leases, expiry/relink and 34-checkpoint final gate NOT RUN.
No completion checkpoints or acceptance record created. Application checks not rerun
this documentation-only turn; preceding bbbf315 results were tsc 0, webpack 0, npm test
488 passed/2 known FSC-copy failures of 490. These do not establish DB correctness.
Funding remains disabled. No dependency or implementation change, no shared DB access,
public-chain activity, push or deployment. OpenCode not used.

## Execution update: 063 committed; first fixture blocked (2026-10-16)

The explicitly approved 063 correction changes ONLY pg_trigger alias t to tr and
its SELECT/JOIN/predicate references in DO $triggers$. Loop record t, returned fields,
selection predicates and DROP behavior are unchanged. Diff inspected. No other SQL
source change. Reverified exact preserved container ID, network none, no published
ports and three read-only audit mounts. Database/inet_server_addr/session_user were
flexsoar_payment_v2_test/127.0.0.1/supabase_admin. Preflight confirmed 059�062 objects
persist and 063 terms_guard/configuration_history absent. An initial preflight used
an incorrect claim_operations(text,integer) catalog signature and refused BEFORE
migration execution; correcting that evidence query to actual(uuid,integer) passed.
Both preflight logs retained; no application behavior was changed by this correction.

063 retry COMMIT exit0. ALL75 manifest migrations now committed. No successful stage
was rerun. Evidence at /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
063-retry-20261016T041422Z/ includes isolation, corrected input/diff/hash, preflight,
execution output and exit0. Original 063 failure/rollback evidence remains untouched.

Tests actually executed: 03_completion_setup.sql COMMIT exit0; 10_contracts.sql
FAILED exit3 at line7, before its substantive financial assertions. Its fixture
inserts handles pv2-s-/pv2-b-/pv2-st- plus complete UUIDs, exceeding historical007's
users_handle_format (3�24 characters). Entire10 transaction rolled back: zero users,
attempts and orders; zero successful checkpoints. 03's private acceptance schema
remains committed. No manual completion records. No20/30, worker login, signed-storage,
race, terminal, stale lease, expiry/relink or final gate execution. Gate NOT PASSED.

STOP: fixing synthetic data length is neither SQL syntax nor a variable/alias
collision. Proposed review repair: in01_fixtures.sql use short role prefixes plus
first20 hex UUID characters (remove hyphens) for seller/buyer/staff handles, retaining
full UUID primary/auth identities and all constraints/assertions. The same defect is
present in50_races_setup.sql's race- plus UUID handle; use the same bounded scheme
there too. No fixture repair was made or executed. Do not weaken historical007.
After explicit approval, retry10 only, then remaining suite; do not rerun03 or any
migration. Test fixtures have not established any settlement/permission guarantee.

Suite evidence: suite-20261016T041435Z/ contains03/10 input/output/exits, preserved
01-fixtures-failed.sql, failed-input.sha256 and rollback-catalog.txt. No environment
reset, broad grants, constraint changes or production/shared connection. Funding const
remains false, zero enabled networks. Human package/lock hashes unchanged; exported
diff preserved. OpenCode not used. No new TypeScript exports or contract signatures.

Application verification this turn: npx tsc --noEmit exit0; npm test (JSON reporter)
488 passed/2 failed/490 total, ONLY unchanged known FSC-copy assertions. No additional
market failures. Webpack outcome recorded below. Application checks do not prove SQL
suite or full Solana-to-Postgres recovery acceptance.

Final application validation: npx next build --webpack exit0,40/40 pages. Existing optional Privy @farcaster/mini-app-solana warning remains; no suppression/dependency edits. git diff --check passed. Only063 alias references and the two named documentation files are included in this task commit.

## Synthetic handle correction and substantive codec blocker (2026-10-16)

Authorized fixture edits ONLY:01_fixtures seller/buyer use s-/b- plus22 UUID hex
characters; staff uses st- plus21;50_races_setup competing buyer uses r- plus22.
All handles are24 valid characters. Full UUID primary/auth/relationship identities
unchanged; existing uniqueness constraints remain strict, so a collision raises an
error (no ON CONFLICT, ignored error or silent identity reuse). No amounts, evidence,
roles, timings, ownership, production logic or assertions changed.

Reverified preserved container exact ID71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92,
network none/no ports/exactly3 read-only audit mounts; internal TCP127.0.0.1,
flexsoar_payment_v2_test,session_user supabase_admin.03 completion schema persisted;
users/orders/attempts/checkpoints zero before retry. No migration or03 rerun.

Retried10_contracts ONLY: psql exit3 at line7, now PAYMENT_V2_LIFECYCLE_CONTEXT inside
fixture's fn_payment_v2_record_lifecycle call. Previous handle-length error cleared.
Entire10 rolled back again: users/orders/attempts/checkpoints remain zero. No20 or
later suite stage executed; no dedicated worker/race/terminal/stale lease/expiry/
signed-storage test and no90 gate. No checkpoint manually inserted.75 migration
files remain committed,03 committed; database acceptance NOT ACHIEVED.

Read-only diagnostics found a production codec defect: all10 SHA256-derived32-byte
samples fail unb58(b58(raw))=raw. Both applied060 helpers use trunc(n/divisor), and
Postgres numeric division rounds before truncation for sufficiently large operands.
For n=48635463943209834798109823479812349789123984798123984798123984798123984798,
trunc(n/58)-div(n,58)=1 and trunc(n/256)-div(n,256)=1. This corrupts identity
bindings and explains why fixture lifecycle context cannot safely progress.
Additional actual le64 calls show shared defect:5000000 encodes404b4c0000000000
correctly, but18446744073709551615 and-1 encodeff00000000000000 instead of
ffffffffffffffff. This affects canonical permit integers, not synthetic display data.

STOP: production encoding changes are outside fixture/syntax/alias authorization.
Concrete next repair proposal: NEW forward migration064 replacing ONLY integer
quotient steps in b58/unb58/le64 with exact pg_catalog.div(n,divisor), preserving
signatures, owners, ACLs, search paths, leading-zero handling, range checks and all
other behavior. Do NOT rewrite applied060 or reapply059–063. Add independent known
Rust/TypeScript Base58/u64 vectors, leading-zero/all-zero/max-key cases and full-range
u64/i64 cases before replaying10. Review any persisted derived values before broader
use; this synthetic DB currently has zero networks/attempts/orders/users. No codec
repair authored or executed under this task. Authorization/review is required for
that semantic forward repair and its isolated execution. Never adjust fixture keys
or expected outcomes to hide the codec defect.

Preserved evidence: /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
fixture-retry-20261016T042158Z/ contains isolation/preflight, corrected01/50 inputs,
fixture.diff/hashes,10 input/output/exit, diagnostics.txt (rollback counts and10 failed
round trips),integer-division-cause.txt (catalog helper bodies and exact quotient
errors),le64-diagnostics.txt. Prior fixture/migration failures and environment kept.
50's corrected file was NOT executed, because10 failed first.

Application checks:npx tsc --noEmit exit0;npm test JSON reporter488 passed/2 failed/
490total, ONLY unchanged FSC-copy assertions; no additional market failures. Build
completion below. Human manifest/lock hashes remain D98A62F311AF26DA6B39B095B1D19BA9D6C2CDE7843EBA6FB7A82F6A3201EC8A
and1DEC156573D13BFCA04776527634BBDDD3765B6F5AAFB443599FCE70341DA56F. Exported diff
preserved; funding const false. No production/shared DB access, public-chain activity,
external side effects, push or deployment. OpenCode not used. No TS exports added.

Final validation: npx next build --webpack exit0,40/40 pages, existing optional Privy @farcaster/mini-app-solana warning. git diff --check exit0. No checks bypassed.

## Forward codec repair executed; new trigger and fee blockers (2026-10-16)

064_payment_v2_exact_integer_encoding.sql is the next available migration and has
COMMITTED in the preserved isolated database (psql exit0). Applied060 was NOT edited.
Only3 quotient expressions changed: b58/unb58/le64 now use pg_catalog.div with numeric
operands instead of divide-then-truncate. No bigint/float casts or range/signedness
changes. Migration snapshots the entire pg_proc metadata excluding prosrc, checks it
unchanged afterward, and checks source replacement is EXACTLY those3 expressions.
This verifies existing OIDs, ownership, ACLs, signatures, search paths, volatility,
strictness, security and remaining attributes were retained. Original 060 bodies,
ACL metadata and reproduced10/10 broken roundtrips/broken max-u64 saved before repair.

Reverified exact existing container ID71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92,
network none/no published ports/exact3 read-only audit mounts; internal loopback,
named flexsoar_payment_v2_test,session_user supabase_admin. All payment_v2 tables
EXCEPT seeded policies were empty before repair, as were public users/orders and
completion records. Thus no persisted codec-derived records were rewritten. Historical
migrations,059–063 and03 were not rerun. Total manifest files committed now76.

New regression sources:
-04_sdk_encoding_vectors.sql: offline expected constants generated using installed
 bs58@4.0.1, Solana PublicKey and Node Buffer BigInt encoders, not SQL helpers.
-05_encoding.sql: PASSED exit0, transaction ROLLBACK.10 independent SDK encodings
 (32-byte zero/FF/leading-zero/ascending/public keys and3 deterministic64-byte signature
 strings),7 independent SDK decodings,10 requested LE64 vectors (including2^53±1,
 max-i64/max-u64/-1/min-i64),11 rejection/strictness assertion groups, and complete
 690-byte SQL-composed permit matching the existing Rust independent_wire_vector and
 production TypeScript encodePermit output. Decoder32-byte restriction unchanged.
-make-encoding-vectors.mjs: offline reproducible expected generation + actual SQL permit
 comparison using the real production TS encoder (transpiled with installed TypeScript).
 SDK vectors regenerated to OS TEMP and compared equal; no dependency changes.
-06_export_encoding_permit.sql: calls real prepare/initiate/authorize through fixture,
 exports immutable source fields and actual permit, then rolls back. FAILED before
 authorization on the new trigger blocker below. This actual-call SQL/TS comparison
 is NOT completed; do not conflate the successful fixed wire-vector comparison with it.
-07_encoding_acceptance.sql: NOT RUN. Reruns05, validates the actual06/TS comparison
 artifact and commits one private explicit encoding checkpoint only on success.
-90_final_acceptance.sql: preserves ALL original34 prerequisites and additionally
 requires payment_db_codec.completion's encoding record. New total35, version2.
 Missing schema/record or failed comparison is fatal. No manual marker creation.

After05 passed,06 failed; retry10_contracts as requested also FAILED exit3, same
cause: record "new" has no field "resolved_event". terms_guard() in applied063 has
TG_TABLE_NAME='operations' AND NEW.resolved_event ... as one IF expression. The shared
trigger compiles that expression for a sales row, which lacks the field, before the
false table-name guard can protect it. Failure occurs when record_lifecycle changes
sales.state opening->open. All fixture writes rolled back: users/orders/attempts and
original acceptance checkpoints remain0; no payment_db_codec schema/marker exists.
No20+, dedicated worker, concurrency, terminal, stale-lease, expiry/relink or90 run.
35-checkpoint gate NOT PASSED. No financial/authorization assertions weakened.

STOP / concrete next proposal: a NEW forward065 replacing ONLY terms_guard body with
nested table-specific IF blocks around the2 operations-only predicates (resolved_event
and signature). Preserve each predicate/error, all immutable terms checks, ownership,
ACLs and trigger attachment. Add regression exercising this existing trigger on each
of sales/attempts/operations/outbox, including rejecting actual immutable mutations.
Do not rewrite applied063, disable the trigger, add permissive fields or bypass it.
This is production control-flow logic, outside codec/syntax/alias/display scope;
no repair authored/executed. After separately reviewed/approved forward repair,
resume06 (then offline compare/07),10 and remaining suite. Do not rerun064 or03.

Other payment quotient inspection FOUND a separate demonstrated defect, NOT changed:
059's CHECK and060's initiate allocation use floor(total_units*500/10000). At total
18446744073709551615 (and...614), existing expression gives922337203685477581 vs
exact922337203685477580, an overcharge of1USDC base unit. Rust uses u128 integer
division, so SQL diverges. At historical fixture5000000 both give250000. Proposed
separate reviewed forward scope: exact numeric div for both CHECK and initiate's fee/
net allocations, retaining full-u64 bounds and all other checks; inspect existing
attempts first and add independent edge vectors. No amount/constraint change allowed
under current codec repair, so none made. MYR calculation uses bounded bigint integer
division, not the demonstrated numeric divide/truncate defect. No other quotient
changes made. This known edge-case mismatch remains an integration/release blocker.

Evidence: /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
codec-repair-20261016T043338Z/: isolation.json, preflight.log (all table counts/original
code/ACLs and reproduced failures),064-input.sql/hash/log/exit0,05 log/exit0,06 log,
10 log/exit3,after-and-other-arithmetic.log (rollback counts/postrepair metadata/fee
comparison),trigger-blocker-catalog.txt, preserved SQL/helper inputs + input-hashes,
failure-summary.txt.06's individual exit code was not captured separately by the
original set-e shell; its actual psql SQL error/transcript is preserved. No reset,
failed environment cleanup or hidden correction. Original prior errors retained.

App validation:npx tsc --noEmit exit0;npm test488 passed/2 unchanged known FSC-copy
failures/490total. No extra market failures. Build outcome recorded below. Human
package/lock pair hashes unchanged; exported diff preserved; funding const false,
no enabled network rows. No production/shared DB, public-chain calls, email, push or
deployment. OpenCode not used. No TypeScript production exports/signatures changed.

Final validation: npx next build --webpack exit0,40/40 pages; existing optional Privy @farcaster/mini-app-solana warning remains. git diff --check exit0. SQL migration064 and primitive regressions passed; actual-permit checkpoint and full35-checkpoint suite remain blocked, not accepted.

## Authorized trigger/fee forward repairs drafted; Docker unavailable (2026-10-16)

065_payment_v2_table_specific_terms.sql and066_payment_v2_exact_usdc_fee.sql are NEW,
UNAPPLIED forward migrations. No existing migration, including applied064, edited.
No SQL or database connection executed this turn. Execution blocked before identity
verification: Windows docker inspect exited1 because dockerDesktopLinuxEngine named
pipe does not exist; explicit Ubuntu invocation reports docker command unavailable.
Thus current container identity/isolation/current record counts cannot be reverified
and no claim is made that the server is presently running. No environment recreated,
container/service started, integration setting changed or unrelated Docker resource
altered. Last VERIFIED state remains b96d70d:064 committed,05 primitives passed,
06/10 rolled back on shared-trigger field access; zero checkpoints/attempts/users/orders.

Exact commands/errors:
-docker inspect flexsoar-payment-db-69c6161-20261016T022841Z (Windows): exit1,
 failed to connect to docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
 open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
-wsl.exe -d Ubuntu -- bash <outside-repo script invoking docker version>:
 The command 'docker' could not be found in this WSL 2 distro; enable Docker Desktop
 WSL integration. WSL itself executes successfully as the existing Ubuntu user.
An initial one-line evidence-copy command lost shell variable quoting and failed on
root paths with permission denied; no DB calls or file overwrite occurred. Corrected
LF script preserved actual Windows/Ubuntu error logs in the existing run directory.

065 preserves the original resolved_event/signature predicates and errors, wrapping
ONLY the2 operations-only IFs in nested IF TG_TABLE_NAME='operations'. Every shared
trigger field reviewed: attempts.permit/authorized metadata are already nested;
state exists on all4 attached tables; other terms use JSON field names, not missing
record fields. No table/column/trigger attachment added, no disabled guard. Preflight
checks normalized original-body hash and exactly4 attachments; postflight compares
all function metadata except body and complete attachment catalog tuples unchanged.

066 preserves function signature/owner/ACL/security/search path/attributes and all
unaffected MYR integer arithmetic. Only2 USDC allocation expressions in initiate
become exact numeric pg_catalog.div(total*500,10000). It transactionally locks attempts,
identifies exactly1 original fee CHECK, compares its complete definition with a temp
original-shape CHECK, refuses any affected persisted attempt, and replaces ONLY that
CHECK using the same name/comment/inheritance property. ADD CHECK fully validates
existing data; postflight requires convalidated=true and other constraints unchanged.
No financial rows rewritten; existing u64 domains/total>0/total=net+fee preserved.
Actual live attempt inspection and metadata comparisons remain PENDING until execution;
last-known zero is historical evidence, not a fresh catalog result.

New dedicated regressions (AUTHORED / NOT RUN):
-08_terms_guard.sql exercises production trigger on sales/attempts/operations/outbox:
 valid state/lease changes, immutable-term denial, permit denial, wrong-sale resolved
 event rejection, same-sale acceptance, first signature then change/clear rejection.
 Fixtures roll back with deferred checks forced, then explicit private success record.
-09_exact_fee.sql:12 independent Python integer expected splits:1/19 zero-fee,20/21,
 39/40/41 boundaries,5000000 normal,2^53±1,max-u64-1/max-u64. Calls real initiation
 for each, checks MYR snapshots unchanged, and tests copied ACTUAL production CHECKs
 (including domain bounds) reject wrong fee and zero/negative/fractional/overflow totals.
 Probe CHECK definitions must equal production CHECK definitions; this is no mirrored
 fee implementation. After rollback only successful completion records persist.
-01_fixtures.sql adds optional p_total default5000000 to the TEMP fixture ONLY, with
 matching synthetic quote/FX terms and test network caps; existing3-argument calls
 retain exactly their defaults. Production funding configuration is NOT enabled.
-90_final_acceptance retains all35 prior prerequisites and requires BOTH new explicit
 successes. New total37, suiteVersion3. No markers inserted; gate NOT RUN.

Evidence in /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
trigger-fee-20261016T071449Z/: engine/isolation attempt, Windows/Ubuntu Docker errors,
Ubuntu exit code, draft065/066/08/09 copies + hashes. Original failures/DB/environment
preserved. Draft SQL statically reviewed; no SQL compilation, grant, lock/concurrency,
actual permit comparison or database acceptance claim. Full chain-to-DB integration
also unverified. No public-chain signing/broadcast, shared/production connection,
email, operational keys, dependency edits, push or deployment. OpenCode not used.

Next concrete human action: start Docker Desktop's Linux engine and restore
Settings -> Resources -> WSL Integration -> Ubuntu. Verify Client/Server using
Windows docker version and wsl.exe -d Ubuntu -- docker version. Do not reset/recreate
anything. Then resume under existing authorization: reverify exact preserved ID,
network none/no ports/three read-only mounts/internal loopback named DB; inspect
persisted attempts, capture definitions/ACLs; apply065 ONLY then066 ONLY; on success
06 export + offline TS comparison +07 encoding acceptance,08 and09 regressions,
10 then remaining worker/concurrent/recovery suite. Do not rerun successful prior
migrations or03. Stop at first failure and preserve evidence; no manual markers.
No fresh permission is required for these already-authorized steps once tools return.

Application validation: npx tsc --noEmit exit0; npm test488 passed/2 unchanged known
FSC-copy failures/490total. No additional market failures. Webpack result below.
Human package/lock hashes unchanged (D98A62F311AF26DA6B39B095B1D19BA9D6C2CDE7843EBA6FB7A82F6A3201EC8A /
1DEC156573D13BFCA04776527634BBDDD3765B6F5AAFB443599FCE70341DA56F), exported diff kept.
Funding const remains false. No new production TypeScript exports or frozen signatures.

Final app validation: npx next build --webpack exit0,40/40 pages; existing optional Privy @farcaster/mini-app-solana warning persists. git diff --check exit0. Database execution, new regressions and37-checkpoint acceptance remain NOT RUN this turn because Docker is unavailable. No misleading migration-success claim.

## ISOLATED DATABASE ACCEPTANCE COMPLETE (2026-10-16)

Resumed after Docker recovery on branch track/payment-security from459e0ee. Exact
preserved container ID71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92
matched. It was stopped; inspected configuration BEFORE starting ONLY that container.
Network none, no ports/privileged mode, exactly3 existing read-only audit mounts,
official immutable image supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc.
An initial guard expected the friendly image tag and stopped BEFORE startup/SQL;
corrected guard checks the previously approved exact Config.Image AND image digest.
Internal TCP127.0.0.1 / flexsoar_payment_v2_test / supabase_admin confirmed. Preflight
proved064 present, original065/066 bodies still pending,03 committed, zero attempts/
users/orders/checkpoints. No prior applied migration or03 rerun. No recreation/reset.

ACTUAL MIGRATIONS:
-065 COMMIT exit0. Function metadata/4 attachment catalog tuples preserved by checks.
-066 COMMIT exit0. Original CHECK matched exactly; zero affected persisted attempts;
 ONLY fee CHECK replaced and fully validated, other12 constraints preserved; initiation
 metadata and quotient-only body replacement verified. MYR arithmetic unchanged.
-067 NEW mechanical alias forward repair, COMMIT exit0 (see failures below).
All79 explicit manifest files now committed (70 historical +059 through067).

ACTUAL REGRESSION/CORE RESULTS:
-08 shared-trigger tests PASSED exit0, earned terms_guard checkpoint after rollback.
-09 PASSED exit0:12 independent exact-fee allocations through actual initiation,
 copied actual production CHECK verification and wrong-fee/invalid-total rejection,
 unchanged MYR snapshot assertions. Earned exact_fee checkpoint after rollback.
-06 real SQL-authorized permit exported successfully, fixtures rolled back.
 Offline production TypeScript encodePermit matched all690 bytes exactly. No SQL
 expected values reused as encoder output. Public comparison artifact retained.
-07 PASSED after equivalent regex syntax correction; reran primitive SDK vectors:
 10 encodes/7 decodes/10 LE64 vectors/11 rejection-strictness groups/full fixed Rust/TS
 vector. Committed encoding checkpoint WITH actual SQL/TS comparison evidence.
-10_contracts,20_outcomes_recovery,30_permissions all PASSED (exit0, forced deferred
 checks then intentional fixture rollback + explicit successful completion).
-35 setup COMMITTED;36 issuer,37 verifier,38 settler,39 executor,40 notifier all
 PASSED using five separate real non-superuser LOGIN connections, their sole intended
 memberships, session_user assertions, positive RPCs and rejected cross-role/direct
 writes.46 exact result audit PASSED, including SELECT-only user permissions.
-45 synthetic plan exported under real executor; Node generated a NEW ephemeral
 valueless OFFLINE signed envelope, synthetic blockhash, no saved key/broadcast.
 47 signed storage PASSED exact persistence/idempotent readback/conflict rejection/
 unknown-send preservation/direct-DML denial; earned signed_storage checkpoint.

ACTUAL CONCURRENCY / RECOVERY:
-40 duplicate setup COMMITTED.41/42 executed on persistent A/B backends in BOTH modes:
 mode0 PIDs968/975; mode1 PIDs990/997. Actual pg_blocking_pids + pg_locks/activity
 proved B waiting on A BEFORE A COMMIT. One matching order/consumption asserted.
-50 race setup and70 immutable-expiry setup COMMITTED.51/52 financial cases PASSED:
 conflicting_signature,conflicting_attempt,release_refund,refund_release,funding_cancel,
 funding_revoke,revoked_funding,rollback. Each used real role-correct connections,
 retained A transaction while B blocked, and inspected actual blocking before release.
-58/59 terminal consumers ran separately for release_refund (PIDs1388/1395) and
 refund_release (1444/1451), with real settler logins + actual blocking. Matching
 canonical terminal receipts consumed once; adversarial opposite evidence rejected.
 No two purported valid chain outcomes were fabricated.53 exact financial assertions
 passed after each case, including order/owner/claim ledger/journal/outbox counts.
-rollback case PIDs1571/1578: observed B blocking after A provisional financial writes,
 then ROLLBACK A; same original A backend ran60 acknowledgement; B alone committed.
-57/51/52 queue competition passed for operations,outbox: distinct dedicated A/B
 logins simultaneously held transactions and got different SKIP LOCKED jobs. A third
 persistent backend SELECT FOR UPDATE on A's job demonstrably blocked; saved lock
 and3-backend overlap evidence before releasing A. B's nonblocking progress was
 intentional SKIP LOCKED behavior, not described as B waiting.
-operation_takeover/outbox_takeover: real separate original-A/B logins and backends,
 actual row-lock probe while A open, A commit,54 expiration of EXACT synthetic lease,
 B takeover,55 rejected stale completion under SAME original A login/backend.
 All4 queue cases and2 stale checkpoints earned; no external work executed.
-71 expiry/relink/lost-response recovery PASSED after natural wall-clock expiry
 (>45sec since70 setup, immutable times untouched). Retained original wallet/permit,
 reconciled exact evidence, repeated receipt and initiation returned original attempt.
 These SQL/mocked-chain fixtures verify DB behavior, NOT actual chain observation.

FINAL GATE EXECUTED SUCCESSFULLY:
Before90 exactly34 original prerequisites +1 encoding +2 repair checkpoints =37.
90 reran46/53 assertions, checked every required success/identity/backend, forced
constraints and COMMITTED explicit final record:
 scenario=final; login=supabase_admin; backend_pid=2138;
 completed_at=2026-10-16T07:34:00.635339+00:00;
 details={"suiteVersion":"payment-db-completeness-3","requiredCheckpoints":37}.
Output: PAYMENT_DB_FINAL_ACCEPTANCE_COMPLETE. Final record is ADDITIONAL to37,
not counted as a prerequisite. No checkpoint manually inserted or scenario skipped.

NEW FAILURES PRESERVED / MECHANICAL CORRECTIONS:
1) First07 failed regex compilation: Postgres rejects repetition count{1380}.
 Entire acceptance transaction rolled back (payment_db_codec schema absent verified).
 Changed ONLY regex to^[0-9a-f]+$ while retaining separate existing exact1380 length
 assertion and every other comparison. Same accepted set, no weakened assertion.
 Corrected diff + failed input/log + rollback evidence preserved; retried07 ONLY.
2) First10 after fixes failed ambiguous column/local variable action in record_decision.
 Complete fixture rollback verified before repair.067 qualifies ONLY the SELECT's
 decisions.action with new unambiguous decision_row alias. All other fields/predicates/
 locks/roles/errors unchanged. Original normalized body hash and complete metadata
 checked; postflight proves EXACT2 alias replacements and metadata unchanged. This
 fits standing mechanical name-collision authorization. Applied061 NOT edited.
 Retried10 ONLY, then proceeded20+. No other repair or permission/constraint weakening.

EVIDENCE retained outside repo at /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
resume-065-20261016T072710Z/: before/after catalogs, source snapshots/hashes, results.tsv,
all failure inputs/logs,07 rollback/diff,10 alias rollback, actual permit+comparison,
synthetic signed envelope (NO key), individual real session transcripts,16 actual
blocking evidence JSON records + queue overlap evidence, orchestrator source scripts,
expiry setup time, before-final-counts.json,90 execution output,after-final.json and
final-isolation.json. First failed image-name guard retained in preceding resume065
folder; all earlier failures/environments retained. Final exact container still RUNNING
and isolated; no cleanup, reset, migration replay or unrelated Docker changes.

Remaining integration/release blockers: production deployment/schema/catalog parity
unverified; no production identities, dedicated worker transports/credentials, issuer,
real chain observer/sign-execute/reconcile-notify loop or operational recovery exercised
by this database suite. Real Solana funding/release/refund and program entitlement
reconciliation were NOT executed here. Full Solana-to-Postgres recovery is NOT proven.
Existing on-chain/local-validator evidence is separate historical work, not rerun.
Funding const false; only synthetic local fixture configuration exists. Stripe dormant.
No shared/cloud/production DB, public-chain RPC/signing, operational keys, real money,
email, push or deployment. Human dependency pair/exported diff unchanged. OpenCode not used.

Application checks this turn:npx tsc --noEmit exit0; full npm test486 passed/4 failed/
490total.2 known unchanged FSC-copy assertions +2 intermittent existing market render
assertions (invariants3180/3186, expected 'Nothing listed yet'). Targeted market run
PASSED2/2 (245 skipped in that file). Multiple hoisted contract mocks (253/2941) and
module-level30s market cache exist; current evidence does NOT establish exact failure
cause. No shared assertions, market code, mocks, cache behavior or dependencies changed.
Do not report full app suite passed. Webpack completion below. SQL acceptance is
independent of these unresolved app test failures. New production TS exports:none.

Final application completion: npx next build --webpack exit0,40/40 pages; optional Privy @farcaster/mini-app-solana warning remains. git diff --check exit0. Full app test count remains486 passed/4 failed; isolated market2/2 passed. Database37-checkpoint acceptance COMMITTED independently. No claim of production payment readiness.

## Integration transport/topology work; full payment scenarios BLOCKED (2026-10-16)

Started at1c8f88ba2b7c531cc399c90a4829dd58a8571590, track/payment-security, no main
divergence. Human manifest/lock pair and untracked exported diff preserved. Read rules,
current protocol/DB/observer/signed-operation/reconciliation implementations and test
instructions. No production funding switch, frozen signature or Rust program changed.

EXECUTABLE WORK IMPLEMENTED:
-lib/db/payment-postgres.ts: native PostgreSQL/psql PaymentRpc transport with explicit
 host/port/database/dedicated LOGIN/role configuration. No inherited libpq credentials,
 Supabase/admin fallback or arbitrary SQL/RPC surface. One transaction per RPC, SET
 LOCAL ROLE to its sole worker role, server session_user match BEFORE RPC, then actual
 fn_payment_v2_worker_identity (rejects superusers/unsafe memberships). Five role-specific
 RPC whitelists preserve exact named arguments; psql quotes JSON values, no shell.
 Credential password only in child environment, never argv/SQL. Require verified TLS
 off literal loopback; do not silently round unsafe integer input/output. SQL errors
 surfaced without dumping executable argv; disconnect/timeout/invalid COMMIT response
 stays PAYMENT_DB_OUTCOME_UNKNOWN, original identity recovery only, never repay/resign.
 Exports: PaymentWorkerRole; PaymentPostgresConfig;
 createPaymentPostgresTransport(config:PaymentPostgresConfig):PaymentRpc.
-tests/payment-postgres.test.ts:11 tests of production implementation with ONLY process
 boundary mocked. Includes role/endpoint/whitelist restrictions, actual SQL transaction
 framing, credential isolation, quoted hostile values, identity mismatch, unknown
 response-loss semantics and unsafe-number rejection.11/11 PASSED. These mocks are NOT
 chain/DB integration proof. An initial test double lacked Node execFile's custom
 promisify.child contract (3 failures); fixed double to model that real API, not source
 safety assertions. Actual helper transport also independently passes.
-tests/payment-integration/: guarded additive LOGIN fixture, read-only TS test loader,
 real transport smoke, opt-in helper creation script and actual local topology probe.
 create-helper.sh passes bash -n; new helper creation itself used the equivalent
 archived exercised shell invocation. Script never starts DB bootstrap/migrations.

ACTUAL ENVIRONMENT AND TOPOLOGY:
-Preserved DB container71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92,
 name flexsoar-payment-db-69c6161-20261016T022841Z, running, network none, no published
 ports, exact3 original read-only audit mounts. Accepted final row unchanged:
2026-10-16T07:34:00.635339+00:00,37 prerequisites. No old fixtures/records repurposed.
-New helper flexsoar-payment-integration-20261016T075407Z shares EXACT DB network
 namespace (readlink IDs compared), user1000:1000, read-only root, all capabilities
 dropped,no-new-privileges,no ports/no Docker socket/no app env/root-repository mount.
 Existing immutable official supabase/postgres digest6058a675... used, entrypoint
 overridden to sleep (NO automatic database/bootstrap SQL). No image/dependency install.
 Read-only mounts: Node binary, Agave bin, Ubuntu runtime LIBRARIES, reviewed.so,
 current worktree lib/integration tests/node_modules. No node_modules copying. Only
 newly created /state evidence directory and /tmp tmpfs writable. Host glibc loader
 used explicitly for existing Linux tools in musl/Nix base; no system config altered.
 Namespace contains ONLY lo and empty routing table. Live listeners recorded at
 ports5432/18899/18900/18901/18902. Agave2.1 wildcard sockets are confined to ONLY
 loopback by network namespace; no claim they all bind literal127.0.0.1.
-Versions: Node22.14.0,Agave validator2.1.0,psql17.11; WSL Ubuntu26.04.1 x86_64.
 Existing Cargo1.85.1 found, Rust/SBF NOT rerun because program unchanged.
 Reviewed.so /home/family/.cache/flexsoar-v2-local-build/flexsoar_settlement.so
 SHA25699aa6bec4e949de3484bc7fef0b70a83b040bdf92a1060871fe4de8d4c64743c.

ACTUAL CHECKS COMPLETED:
-00_worker_logins.sql committed ADDITIVE5 separate synthetic non-superuser LOGINs:
 payment_integration_issuer/verifier/settler/executor/notifier. Each NOINHERIT and
 exactly one existing payment_v2 worker membership. No admin identity in app workers.
 Original staff, users, wallets, orders, accepted roles/checkpoints unchanged. Do NOT
 rerun00 on this instance; it refuses existing LOGIN names. No production credentials.
-transport-smoke.mjs PASSED for all5 through REAL psql connections and production
 adapters; server identity and membership checks passed. Cross-role/unexpected RPC
 arguments rejected before execution. Old accepted SQL tests were NOT rerun.
-topology-probe.mjs: actual local validator, reviewed program loaded, valueless local
 airdrop FINALIZED with err=null; actual program executable account verified; production
 LocalV2Observer read finalized genesis/account data, zero sales. Actual production
 reconcilePayments -> dedicated verifier/settler RPC connection rejected the unconfigured
 genesis/program network as PAYMENT_V2_NETWORK_UNKNOWN. This is EXPECTED FAIL CLOSED,
 NOT a successful financial reconciliation. No invented proof JSON/commit digest.
 Two corrected HTTP-only runs exited0; latest /state/probe-tL0LD2 has live-bindings and
 topology-result. First run completed assertions but web3 subscription kept reconnecting
 after its child stopped. Terminated ONLY exact probe Node PID656, preserved log and
 initial source; replaced confirmation subscription with HTTP status polling requiring
 FINALIZED (no finality relaxation). Every retry used a NEW ledger; none reset/deleted.
 Owned validator stopped after probe; helper remains idle, DB still running/isolated.

SUBSTANTIVE PRESERVATION BLOCKER / REQUIRED NEXT ENVIRONMENT APPROVAL:
060 funding_configuration requires one GLOBAL active receiver/authenticator/inventory/
reviewer/release/guardian/reconciler, exactly3 governor persons and10 distinct active
staff keys. Accepted DB already contains EXACTLY that set;01 old fixture makes its
public_key=sha256(uuid_send(user_id)), NOT a generated Ed25519 Keypair with a retained
private key. These accepted identities cannot sign actual local-chain attestations.
A new10-key set would violate global counts; deactivating/replacing existing rows
would alter the accepted run, explicitly forbidden. No such mutation attempted.
Current authorization says SQL/tests against EXISTING disposable isolated database;
no second database created silently and no global staff-scope schema change made.

Smallest concrete proposal: approve NEW flexsoar_payment_v2_integration_test in the
SAME existing isolated PostgreSQL container, same network namespace/no ports. Copy
ONLY reviewed schema (public/auth/payment_v2/extensions) from LOCAL synthetic DB,
NOT accepted data, NOT production snapshot; exclude all payment_db_* test schemas.
Seed ONLY reviewed static reference configuration from checked-in sources (policies,
tier/condition bands/platform config as required), then NEW uniquely identified
users/Items/Cards/listings and separately generated ephemeral role/governance keys.
Do not clone staff/orders/wallets/checkpoints or modify originals. Keep old target
strict guard unchanged; add separate integration-only named-target/namespace guards.
This avoids changing authoritative production staff semantics just for testing.
No additional npm dependency required; psql executable is required in worker runtime.

ADDITIONAL IMPLEMENTATION STILL REQUIRED, NOT CLAIMED DONE:
-Trusted attestation/lifecycle verification against durable immutable bindings, including
 opening/revocation/ack context and authorized staff keys. Verifier currently has no
 bounded RPC to read pending decision/issuer/lifecycle contexts; executor context RPC
 cannot be borrowed by the verifier. Propose narrow role-specific immutable-context
 RPC contracts for issuer/verifier rather than broad private-table grants.
-Existing exit_plan/signed storage and inspectSignedOperation are explicitly limited
 to execute_outcome/one fee signature/8 nonsigning instruction accounts. Opening,
 receipt/authentication/release authorization, governed refund, acknowledgement need
 reviewed bounded plans and exact multi-signer persistence/verification contracts.
 No arbitrary signing, broad withdrawal or unsupported success substituted here.
-Sale-mode funding,real95/5 reconciliation,release/refund exclusivity,real competing
 buyers,all requested crash/lease/response-loss recovery injections and real recovery
 API/UI are NOT RUN as coupled scenarios. Browser/session wallet relinking not tested
 against real chain here. Existing37-checkpoint synthetic DB acceptance remains a
 separate earlier result; no new integrated success marker was inserted.

SCENARIO CLASSIFICATION:
Real dedicated worker transport5/5: ACTUAL COMPONENT PASS.
Namespace/RPC/faucet/DB connectivity/finalized program observer: ACTUAL LOCAL PASS.
Unconfigured chain network -> DB authority refusal: ACTUAL FAIL-CLOSED PASS.
Transport loss/unsafe data controls11 tests: MOCKED PROCESS BOUNDARY PASS.
Direct sale/escrow+receipt/auth/release/governed refund: BLOCKED/UNIMPLEMENTED integration.
All9 failure boundaries/actual competing buyers/recovery API+UI: BLOCKED/NOT RUN.
Expired/finalized-failed operation handling: existing offline checks only; no actual
 coupled-operation expiry/replacement experiment or relaxation this turn.

Evidence NEW directory /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
integration-discovery-20261016T074634Z/: baseline/after DB proof, helper inspections,
shared-namespace IDs, actual transport logs, original cleanup failure, corrected probe
logs/exit codes, unique helper-state ledgers/configs/public results/live-bindings,
source snapshots/hashes. Previous resume065 evidence and final record untouched.

Validation: normal npx tsc --noEmit exit0; npm test499 passed/2 known unchanged FSC-copy
failures/501total (11 new tests). No intermittent market failures THIS full run; prior
2 targeted tests passing did not establish full-suite pass. Read-only market handoff:
shared invariants has duplicate hoisted contract mock factories253/2941, assertions
3180/3186 expect empty state; market/cached.ts has module30s listing cache and exported
clearMarketCaches. Cause remains unproven. Market/shared-test owners should instrument
mock resolution, loadError and cache lifetime in a dedicated authorized test change;
do not weaken assertions or infer this SQL/transport code fixes the intermittent issue.
Webpack result recorded below. Funding constant false, Stripe dormant. Redemption E2E,
operational staff/key provider/Squads authority arrangements,production cutover/catalog
parity and full chain-to-database recovery remain launch blockers. No production keys,
shared/cloud DB, public-chain calls, real funds, emails, push or deployment. OpenCode
not used. Human dependency hashes unchanged; exported diff preserved.

Final review tightened the NEW LOGIN fixture's target guard with explicit inet_server_addr() IS NULL rejection (three-valued SQL safety). Actual earlier execution used verified TCP127.0.0.1, so its result is unaffected. Original executed fixture input/hash retained separately from future strengthened source; fixture NOT rerun (LOGINs already exist). No applied migration/function/grant changed by this source guard edit.

Final validation: npx next build --webpack exit0,40/40 pages, existing optional Privy @farcaster/mini-app-solana warning; git diff --check exit0. Financial integration remains blocked, not completed or launch-ready.

Ephemeral-key metadata clarification: Node bootstrap keys were not saved. Agave automatically created12 private test key files across the3 NEW probe ledgers, all mode0600. Only filenames/stat metadata were inspected, never contents; no operational wallet files mounted/read, no key material copied into reports/repository. Metadata recorded separately. Helper credential-related environment variable-name inspection found none; no values were printed.

## 2026-10-16 — Actual local chain/database integration after22f5ab1

Latest work is on track/payment-security, approved isolated worktree. HEAD at start
22f5ab1f9d76016c23844d0260e8821d160438b9; no main divergence. Human memo manifest/lockfile
and payment-security-5c3db0e.diff remain excluded. Funding constant remains false.
This supersedes earlier statements that ALL coupled financial scenarios were unrun;
it does NOT supersede remaining production signer/context/recovery blockers.

ISOLATION / SCHEMA:
Exact preserved DB container71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92,
name flexsoar-payment-db-69c6161-20261016T022841Z, image digest
sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc.
Reverified network none, no published ports, original3 RO mounts. Existing helper
flexsoar-payment-integration-20261016T075407Z shares that exact network namespace;
only lo/no routes, read-only root, UID1000, dropped capabilities, no-new-privileges,
no Docker socket/env/root-repo mounts. RPC/faucet/database remain inside namespace.
attest-helper.sh validates actual Docker config + namespace before its local marker;
runner independently checks interfaces/routes/ns/image-program hash. DB name alone
is insufficient. No container/network/port reconfiguration or reset.

Created NEW flexsoar_payment_v2_integration_test from template0, NOT a data clone.
Reviewed pg_dump17.11 --schema-only --exclude-schema='payment_db_*', restored in one
transaction with ON_ERROR_STOP. Includes official extension/Auth/helper/RLS/owner/ACL,
trigger/event-trigger/publication definitions. Normalized source and restored dump
identical; only pg_dump's random restrict tokens removed for comparison. Every
public/auth/payment_v2 table asserted empty BEFORE seeds/fixtures. Source dump hash:
e6160c8f50ba06ecf33ff4babc94283b45783ee7b7b0d1038d8a4d70f174a4c9.
Static reference rows came from checked-in059 policy,001 tier bands,018 condition
bands and048 color update. No accepted business/staff/wallet/acceptance rows copied.
Original payment-db guard unchanged; original37 acceptance retained separately.

New cluster LOGINs customer(authenticated only) and executor_b(executor only) added;
existing role definitions/memberships/credentials untouched. Existing5 dedicated
integration worker LOGINs retained. Production workers use actual non-superuser
issuer/verifier/settler/executor transports; administrator is test fixture/audit only.
No worker receives supabase_admin/service_role or borrowed executor/verifier role.
Ordinary-request session is a separate synthetic LOGIN with local JWT subject;
this is NOT a live Supabase Auth HTTP/session integration test.

IMPLEMENTED EXECUTABLE WORK:
- lib/solana/v2-authority-observer.ts: trusted-expected instruction vs finalized
  transaction bytes/program/accounts/required signers; genesis/chain timestamp check.
  Supports legitimate sponsorship/extra instructions; ambiguous same-program calls
  fail. Does not manufacture context or authorize supplied client digests.
- lib/solana/v2-operation-observer.ts: finalized same-bank Sale/Config account reads,
  exact owner/layout/domain, original signature/history, slot-order check, blockheight
  and blockhash validity for existing signedOperationRecovery policy. Read-only,
  explicit loopback only. No replacement/signing/send API or env discovery.
- tests/payment-integration/integrated.mjs: actual canonical SQL permit issuance,
  production buy builder, finalized financial verification and dedicated settlement,
  ordinary-user durable status, bounded execute_outcome plan/envelope validation and
  persistence, original-byte execution, real failure injection and owned-ledger resume.
-01/02/04 SQL fixtures: fresh signable synthetic staff/users/Item/Card/listings; added
  independent buyers after relinking.03 read-only audit checks exact corresponding
  orders, ledger/cache, journal counts/balance, MYR vs USDC snapshots, atomic outbox
  and no Stripe transfer/paid_out. New target only; no original suite guard changes.
-11 focused offline tests of actual authority inspector/observer (not SQL or chain
  acceptance). No Rust, frozen signature, dependency or applied migration modified.

ACTUAL INTEGRATED CORE RESULTS:
- Case0 vaulted: one winner/two real transactions, rejected buyer principal debit0;
 950000 seller/50000 treasury, one USDC receipt/order/claim/accounting transfer.
 Claim remained unreconciled before acknowledgement, available only after finalized
 acknowledge_claim and DB lifecycle consumption.
- Case1 seller-held:1M escrow/no seller payout; receiver receipt did NOT authenticate
 or release; authentication pass did NOT release. Distinct release approver authorized,
 exact95/5 execution finalized, authoritative release reconciled, claim acknowledged.
- Case2 governed refund: distinct2-of-3 test governor signatures + independent DB
 approvals; full1M original principal returned; zero seller/platform allocation paid;
 conditional ownership reversed, Card locked/quarantined, acknowledgement retained.
- All cases: actual competing buyers; only one principal debit and one DB claim;
 repeated terminal execution rejected on-chain; recovery repeat creates no new order.
- Signed persistence response loss injected AFTER actual DB commit; envelope reloaded
 from dedicated executor RPC. Same raw transaction used for outcome broadcast, whose
 returned response was discarded. DB still funded until actual finalized observation
 reconciled release/refund. No fabricated financial proof or simulated commit digest.
- Case4 separate direct sale: real process stop after funding FINALIZED and quote
 expiry; restart, actual first settlement COMMIT response dropped, idempotent recovery;
 second process stop after finalized acknowledgement plus synthetic wallet relink;
 restart recovered original receipt/claim. No second buyer signature/payment.
 A later NEW initiation using old wallet correctly failed BUYER_WALLET_REQUIRED;
 fresh buyers were added, not a wallet-validation bypass or relink reversal.
- Restart read-only observation of terminal envelopes used production observer/policy;
 original release blockhash expired, policy returned reconcile, never retransmit.
 Stale completion of observed operations rejected by dedicated executor connection.
- Case5 reruns governed refund with live production signed-operation observer before
 identical-byte submission, then finalized verification/reconciliation/acknowledgement.
- Case6 deliberately holds1M synthetic escrow to test real5-minute lease takeover and
 expiry. Its unbroadcast outcome must remain review-blocked; see final result below.

FAILURE EVIDENCE / LIMITS:
First signable setup exited after Card fixture failed missing condition-band reference
rows (inventory transaction rolled back). Exact historical reference seeds supplied.
That process had not retained ephemeral keys; no sale/Card/order/attempt/operation
existed, so ONLY the NEW DB's synthetic staff/network configuration was superseded:
old staff inactive/old network disabled, old rows/configuration history retained.
Accepted database/staff untouched. Later runs retain labelled ephemeral keys0600
outside repo, never operational keys or a production persistence substitute.

Case3 registration timed out before ANY buyer payment/attempt. Original signature
43H4M6Gxk7iEes5dHqYA6ACpD3p3sBNvTjA5aV6Csbgkfk5omqjHEQoZUMUqpghTz1xuDzt2yK2ohzFq98UG4mSa
preserved; read-only restart found signature statusnull and no Card account. Original
bytes were not retained by that older harness path. No replacement was signed and no
success marker inserted; its opening sale remains unresolved. Case4 is a distinct
Card/sale, NOT replacement/replay of case3. Harness now requires getHealth readiness
and journals ALL test sends before broadcast. Underlying timeout cause remains
unproven; WSL also intermittently returned Wsl/Service/0x8007274c for a read-only tail
command (next identical access worked). No global WSL/Docker changes made.

Acknowledgement digest is SHA256 of ACTUAL consumption returned by dedicated settler
and checked for matching attempt/sale/event. Program reconciler remains trusted;
Postgres/Solana do not become atomic or independently validate each other's state.
No fabricated database-commit digest from old standalone harness reused here.

REMAINING INTEGRATION / LAUNCH BLOCKERS:
- Bounded issuer/verifier immutable context read RPCs and restart discovery for ALL
  opening/revocation/decision/ack commands. This harness knows its own prepared input,
  recorded decision and actual commit result; no untrusted client expected context.
- Production durable signed plans/store support ONLY execute_outcome. Multi-authority
  opening/receipt/auth/release/refund-authorization/ack commands here use explicit test
  orchestration. Test files are NOT a production durable server store. Their fully
  unattended persistence/lease/recovery signer integration remains unimplemented.
- No replacement-operation protocol for expired/finalized-failed/uncertain operations.
  Never clear their signature, infer non-execution from absence, or repay to fix DB.
- Full Supabase Auth HTTP/browser/API/session-relink/market UI E2E not run. Actual
  ownPaymentAttempts adapter + DB states tested; existing HTTP handler tests mock auth.
- Before-persistence and some open/control-command crash boundaries not yet proven by
  process kills. Concurrent release-vs-refund chain authorization race not exercised
  as an integrated concurrent test (terminal replay/opposition checks differ).
- Production authorities, issuer provider, credentials/TLS/psql runtime, monitoring,
  actual independent personnel and Squads CPI not supplied/tested. Test keys do not
  establish operational independence. Production catalog/cutover/grants need review.
- Redemption E2E, policy items already unresolved (holiday calendar/loss liability/
  rejected-pair disposition etc), legacy signed-transaction cutover and launch review.
  Panda remains legacy direct, never escrow; Stripe dormant. Funding remains FALSE.

VALIDATION / EVIDENCE:
Normal npx --no-install tsc --noEmit exit0. npm test512total:510pass,2 unchanged FSC-copy
assertion failures (shared invariants1940/1960);19files18pass/1failed. No intermittent
market render failures this full run; earlier cause remains unproven and market-lane
handoff from22f5ab1 still applies. Focused authority+Postgres suites22/22passed.
npx --no-install next build --webpack exit0,40/40pages, existing optional Privy
@farcaster/mini-app-solana warning. No ignoreBuildErrors/casts/test weakening. No Rust
source changes or new compilation; actual validator loaded reviewed.so hash
99aa6bec4e949de3484bc7fef0b70a83b040bdf92a1060871fe4de8d4c64743c (existing Agave2.1.0).
No SQL migration reapplied/rewritten. New fixture/audit SQL execution ONLY isolated
integration DB. OpenCode not used. No production/shared connection, push or deployment.

Run evidence: Ubuntu /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/
integration-db-20261016T082030Z/ (schema/diff/hash/create/restore/empty proof, seeds,
inspections, input snapshots, each exit/log). Helper /state/integrated-JXopR6/ retains
public fixture metadata, actual signed envelopes/transactions, per-case checkpoints,
results and dated failures; private ephemeral key files must not be printed/exported.
Original resume065/discovery evidence and accepted final37 record remain separate.
See tests/payment-integration/README.md for attested observe/resume commands.

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

## 2026-10-16 � retained evidence and acknowledgement recovery milestone

This milestone adds a restart-safe acknowledgement recovery path and fixes the
PostgreSQL evidence transport discovered during actual isolated integration.

- `lib/db/payment-v2-workers.ts` exports
  `recoverCommittedClaimAcknowledgement(settler, verifier, eventId)`. It requires
  distinct dedicated settler/verifier identities. For a committed corresponding
  receipt it returns the existing result without requesting historical RPC data.
  For an unconsumed acknowledgement, it reads retained verifier evidence, checks
  the finalized transaction and exact acknowledgement instruction against the
  immutable consumption context, then commits lifecycle state through the
  verifier. Missing or never-verified history remains review-blocked; the path
  does not sign, broadcast, or query an archive.
- `lib/solana/v2-evidence.ts` now accepts the PostgreSQL `bytea` base64 wire form
  (76-column line wrapping), normalizes it, and checks stored slot/block-time
  values against the retained transaction metadata. This preserves exact bytes
  and rejects malformed wrapping or metadata conflicts.
- `lib/api/contract.ts` additively exports the recovery adapter; frozen contracts
  are unchanged.
- New forward migration `073_payment_v2_evidence_decision_column.sql` fixes a
  confirmed PL/pgSQL name collision by qualifying decision-table columns. It was
  applied transactionally only to `flexsoar_payment_v2_integration_test`.
  Post-apply verification retained owner `payment_v2_owner`, verifier-only
  execute grant plus owner/postgres grants, `search_path=pg_catalog`, and
  SECURITY DEFINER. Migration SHA256:
  `1103FB7B004AC6B2C15824CE591BD647B32BD0A86A6F92660A826DA3448677C8`.

Actual integrated checks completed in the isolated helper used for the existing
integration database: a held direct-sale acknowledgement was recovered from
retained verified evidence and lifecycle state was consumed exactly once; a
committed acknowledgement receipt was returned again without fresh chain history;
a fresh seller-held escrow reached finalized release, acknowledgement and
available customer claim; and dedicated settler/verifier sessions exercised the
recovery contracts and cross-role denial. Database state showed one ACK evidence
record and one lifecycle consumption for each completed sale. The customer
status adapter returned the available state only after reconciliation. Restart
recovery did not request a second payment or acknowledgement signature.

Historical recovery distinctions remain strict:

1. A corresponding committed receipt is returned after authorization and
   correspondence checks without requiring historical RPC availability.
2. Retained evidence that passed finalized-chain verification can be consumed
   after a process restart; the verifier checks the original transaction bytes,
   network and exact instruction.
3. A signature or transaction for which verification never completed cannot be
   promoted from a signature string, current ownership, or harness log.

The archive adapter was exercised against a separately retained local snapshot
while primary observation was simulated unavailable. The local ledger was not
pruned. This proves adapter-path behavior only, not a production archive
provider's retention or availability. The previously pruned acknowledgement has
an authorized committed receipt path, but independent historical re-verification
remains unavailable; no missing execution metadata was fabricated. The expired
escrow and unresolved registration remain blocked, with no replacement operation.

Verification: focused production tests `npx --no-install vitest run
 tests/payment-context-evidence.test.ts tests/payment-v2.test.ts` � 2 files,
58/58 passed. `npx tsc --noEmit` � exit 0. `npx next build --webpack` � exit 0,
40 pages generated; the existing optional Privy
`@farcaster/mini-app-solana` warning remains. `npm test` � 512 total, 507 passed,
5 failed: two FSC copy assertions at `tests/invariants.test.ts:1901,1960`;
one admin intake assertion encounters a mock lacking `.maybeSingle()`; two
market empty-state assertions encounter a mock lacking `.in()`. No shared tests
were changed. The focused market failure is consistent with the mock error, but
its test-owner repair remains separate. These are not reported as a clean full
suite. No Rust source changed, so Rust verification was not rerun.

The isolated database's previous accepted `flexsoar_payment_v2_test` record
remains unchanged at 37 checkpoints. The integration database's completed direct
and escrow sales have one corresponding order/claim/accounting result; all
operations remain synthetic and local. Database acceptance does not prove
Postgres/Solana atomicity, production archive retention, browser recovery,
redemption, production authority readiness, or launch safety. Public funding
remains disabled. No OpenCode use.

### Latest validation rerun (supersedes earlier flaky full-suite counts)

On the final source state for this milestone: `npx tsc --noEmit` exited 0;
`npm test` ran 520 tests with 518 passing and 2 failing, both the stale FSC
copy expectations at `tests/invariants.test.ts:1901,1960`; and
`npx next build --webpack` exited 0 with 40 pages generated. The build reports
the unresolved optional `@farcaster/mini-app-solana` import from Privy and the
existing missing-Stripe-secret diagnostic during static collection. Earlier
full-suite runs intermittently showed three additional shared-test mock failures
(admin `.maybeSingle()` and market `.in()`); they did not recur in this latest
full run. The focused market control did reproduce `.in()` absence. Keep those
mock issues with their owning test lane; no shared assertions or mock files were
changed here.

## 2026-10-16 - evidence fallback classification and wire-message binding

Confirmed and corrected two verifier defects in `lib/solana/v2-evidence.ts`.

Source acquisition now has explicit `EvidenceSourceUnavailableError` and
`EvidenceValidationError` categories. Only typed transport/service unavailability
or an absent transaction allows trying the next source. Validation and instruction
inspection errors stop acquisition; wrong genesis, malformed data, mismatched
signatures/metadata, parsed-message mismatch, lookup failure and conflicting
observations cannot be hidden by a later archive result. A verified primary
transaction remains usable when the optional archive is unavailable. Local RPC
unavailability is recognized from fetch transport failure, HTTP 429/5xx, and an
explicit Solana service/history error-code allowlist; malformed JSON, HTTP client
errors and unknown RPC errors are invalid evidence. Arbitrary source exceptions
are not reclassified.

Both live acquisition and retained-evidence recovery use the same binding path.
It deserializes and canonically reserializes the signed transaction; supports
legacy and v0 messages and rejects other versions; binds every signature from
both RPC representations; compares the raw compiled JSON message (header,
blockhash, static account keys, lookup references, ordered compiled program
indices/account indices/data) to the serialized bytes; and checks jsonParsed
account addresses plus signer/writable flags derived from message header and
validated lookup state. Parsed instruction order/program IDs and exposed account
addresses/data must match the derived compiled message. Parsed inner token
transfers are checked against their compiled instruction index, accounts and
amount. The existing financial execution metadata and instruction-scoped
payment verification remain in force.

For v0 lookup tables, local RPC acquisition reads the actual table account at a
finalized context no earlier than the transaction slot. Validation checks the
Address Lookup Table Program owner, serialized table data digest, active state,
lookup indices, extension slot and exact loaded addresses reported by the
transaction metadata. Missing or historically inconsistent table state fails
closed. The trust boundary remains the configured RPC/archive verifier: hashes
and signatures bind content but do not independently prove execution or
finality.

No SQL/schema change was needed: the existing evidence RPC stores and digests
`parsedRpcResult` as JSONB and accepts additive fields. New evidence retains the
compiled RPC result and lookup account proofs within that existing JSON object.
Old pending evidence without those fields cannot pass the stronger validator and
must remain review-blocked; an already committed, correspondence-checked receipt
still returns without requesting history. This task did not alter that receipt
path or resolve the pruned acknowledgement's independent re-verification gap.

Offline focused regressions: `npx --no-install vitest run
 tests/payment-context-evidence.test.ts tests/payment-v2.test.ts` - 2 files,
63/63 passed. Cases cover absent/typed-unavailable sources; invalid primary with
valid archive; invalid archive after valid primary; optional archive outage;
conflicting valid-shaped observations; arbitrary exceptions; legacy, v0 and
lookup-table messages; missing/tampered lookup proof; and parsed program ID,
data, account, account order, signer/writable and full-signature-list tampering
on both acquisition and retained recovery.

Normal validation: `npx tsc --noEmit` exit 0; `npm test` 523/525, with only the
two existing stale FSC-copy assertions failing at `tests/invariants.test.ts:1901`
and `:1960`; `npx next build --webpack` exit 0, 40 pages generated. Build still
reports Privy's optional `@farcaster/mini-app-solana` resolution warning and the
existing missing-Stripe-secret message during static collection. No shared tests
were modified. These are offline tests; no chain or database was accessed for
this correction, so production RPC compatibility and database integration of the
additional JSON evidence fields remain unverified here.

## 2026-10-16 - RPC-shaped wire binding and isolated adapter/readback follow-up

The follow-up review found one more source-comparison edge: base64 `meta.loadedAddresses`
is optional, while `jsonParsed` omits it in actual RPC responses and compiled `json`
provides the lookup result. Source equality now compares serialized bytes, execution
slot/time and execution results separately from a semantic parsed representation.
The semantic comparison includes the validated resolved address list, ordered wire
instructions and lookup references, plus normalized inner instructions and return
data. Lookup proof `contextSlot` can differ between primary and archive when each
individually satisfies its transaction-slot and table-state validation. A base64
response omitting optional loaded addresses no longer conflicts with one that includes
them; v0 validation still requires compiled-json loaded addresses and checks them
against table bytes and jsonParsed account addresses/privileges.

Compiled instruction matching uses only serialized fields (`programIdIndex`, ordered
account indices and base58 data). It accepts RPC `stackHeight` omitted, null, or a
positive safe integer, validates its shape, then excludes it from the wire comparison.
The same normalization is used for inner instructions, while existing inner token
transfer and execution metadata checks remain. Legacy and v0 formats are supported;
unsupported message formats and unresolvable lookup tables remain fail-closed. No
schema or SQL change was made, and no public or production RPC was accessed.

Focused tests after the final changes: `npx --no-install vitest run
tests/payment-context-evidence.test.ts tests/payment-v2.test.ts` — 2 files, 66/66
passed. Coverage includes stackHeight omitted/null/positive, malformed height,
program/account-index/order/data alterations, signer/writable/signature-list tampering
in acquisition and retained recovery, primary/archive context-slot differences,
omitted optional base64 loaded addresses, changed lookup resolutions, conflicting
execution metadata, jsonParsed without loadedAddresses, and actual adapter method
shapes for base64/json/jsonParsed plus table-account lookup. These focused tests use
local fixtures and are not chain/database proof.

An actual loopback-only local validator run is preserved at
`/state/evidence-adapter-PXfMA7/verification.json` in the isolated helper state. It
used fresh ephemeral identities and a fresh ledger, then acquired and retained-validated
a legacy transaction and a v0 address-lookup transaction through production
`LocalFinalizedRpcSource`. In the v0 RPC result, `jsonParsed` omitted
`meta.loadedAddresses`; compiled `json` supplied the resolved writable address, the
validated lookup proof was retained, and retained evidence passed. The same captured
local transaction was compared against a later primary observation with lookup context
slots 136 and 137; semantic agreement passed. The archive was a snapshot of that same
local validator, not an independent archival service, and `ledgerPruned=false`. This
does not prove production archive retention or actual pruning recovery. Several later
fresh-ledger retries failed before lookup-table creation because the local ALT program
rejected the candidate recent slot; their failure logs remain in separate
`/state/evidence-adapter-*/failure.txt` directories. The earlier successful run and
its ledger/evidence were preserved; failed fresh ledgers were not represented as passes.

The preserved container was rechecked before the database readback: container ID
`71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92`, network `none`,
no published ports, exactly the approved read-only mounts, and internal loopback to
`flexsoar_payment_v2_integration_test` using the dedicated verifier login. The accepted
`flexsoar_payment_v2_test` was not connected to or changed. In the integration DB, the
committed-receipt fast path returned the same receipt twice without chain retrieval.
Pending evidence readback did not pass: `fn_payment_v2_verifier_context(text,uuid)`
raised `column reference "s.id" is ambiguous` in its attempt branch because PL/pgSQL
row variable `s` conflicts with SQL alias `s` in `JOIN payment_v2.sales s ON s.id=a.sale_id`.
The verifier evidence reads returned NULL; no evidence was overwritten and the script
stopped before any persist or lifecycle consume. No SQL repair is authorized here.
Required follow-up is a reviewed forward migration that fixes the alias/local-variable
collision without changing the function contract or grants, applied only after review;
then rerun dedicated verifier-context and evidence-envelope readback tests. Receipt-only
recovery is independently proven, but pending-acknowledgement recovery from persisted
evidence is not proven by this run.

Final application validation for this source state: focused payment/evidence tests
passed 66/66 across 2 files; `npx tsc --noEmit` exited 0; full `npm test` ran 528
tests with 526 passing and only the two existing FSC-copy assertions failing at
`tests/invariants.test.ts:1901,1960`; the intermittent admin/market mock failures did
not occur in this run. `npx next build --webpack` exited 0 and generated 40/40 static
pages. The build still warns that Privy cannot resolve optional
`@farcaster/mini-app-solana` and prints the existing missing Stripe secret diagnostic
during static collection. `git diff --check` passed. Manifest and lock hashes match
main's human-prepared pair exactly; neither file is part of this task commit. Funding
remains disabled. The old pending evidence, pruned acknowledgement, expired escrow
and unresolved registration remain blocked; no replacement payment, signature, or
historical execution context was invented.

## 2026-10-20 — verifier-context attempt-branch alias collision: proposed forward repair (not applied)

Per AGENT_RULES.md ("Never create, edit, delete, or execute a `.sql` file. Schema is
human-only."), this section is prose + proposed SQL text only. No `.sql` file was
created, edited, or executed. No database connection was made this session (source
reading only). Uncommitted `package.json`/`package-lock.json` changes and the debris
files (`0`, `3`, the two SHA256-named files, `payment-security-5c3db0e.diff`) are
founder-owned and were left untouched.

### a) Root cause

`supabase/migrations/068_payment_v2_contexts_evidence.sql:89` declares, among others,
a PL/pgSQL row variable:

```
DECLARE d payment_v2.decisions%rowtype;x payment_v2.escrows%rowtype;s payment_v2.sales%rowtype;st payment_v2.staff%rowtype;keys jsonb;action_code integer;ix_name text;
```

`s` is bound to `payment_v2.sales%rowtype` for the lifetime of the function. In the
`p_kind='attempt'` branch, `068:108-109`, the same name is reused as a SQL alias in a
joined subquery:

```
RETURN (SELECT jsonb_build_object(...,'saleId',s.id,...)
 FROM payment_v2.attempts a JOIN payment_v2.sales s ON s.id=a.sale_id WHERE a.id=p_subject_id AND a.permit IS NOT NULL);
```

Every bare `s.col` inside that subquery is syntactically ambiguous: Postgres's
plpgsql parser must decide whether `s` refers to the outer composite variable or the
inner query's table alias, and both bind a column of the same name. This resolves to
SQLSTATE `42702` (ambiguous_column), text normally of the form `column reference "s.id"
is ambiguous` — matching what's recorded at `docs/handoff/payment-security.md:3222-3223`
("raised `column reference "s.id" is ambiguous` in its attempt branch"). No literal
psql log with the SQLSTATE code or a `CONTEXT:` line is present anywhere in this repo's
tracked files (checked `tests/payment-db/README.md`, `tests/payment-integration/README.md`,
`docs/handoff/payment-security.md` for `SQLSTATE`/`CONTEXT:`/`is ambiguous` — only the
narrative line above matched); `42702` is cited here as the standard Postgres code for
this class of error, not as something read from a captured log.

**Why this only surfaces at execution time, not at `CREATE FUNCTION` time:** plpgsql
compiles each SQL statement lazily, the first time it is actually executed, and only
for the branch that runs. `p_kind='decision'` and `p_kind='lifecycle'` both reference
`s.col` too, but only against the bare variable (no competing alias in scope in those
statements), so they compile and run fine. The `attempt` branch's statement is the only
one where an alias named `s` is introduced inside the same statement as the variable
`s`, so it is the only one where the ambiguity exists — and it is only discovered when
that specific statement is parsed/planned on first call, i.e. at runtime, not at
`CREATE FUNCTION`/migration-apply time.

### b) Redefinition check, migrations 059-073

Migrations referencing `fn_payment_v2_verifier_context` by name:

| Migration | Touches the function? | Redefines body after 068? |
|---|---|---|
| 068_payment_v2_contexts_evidence.sql | Defines it (`CREATE FUNCTION`) | — (original) |
| 070_payment_v2_context_governance_order.sql | Yes | Yes — `CREATE OR REPLACE` via `pg_get_functiondef` + text replace of `ORDER BY g.staff_id` → `ORDER BY a.staff_id` in the **decision** branch only. Does not touch the attempt branch. |

No other file in `supabase/migrations/059*.sql` through `073*.sql` references this
function name (`grep -rl fn_payment_v2_verifier_context supabase/migrations/` returns
only 068 and 070). So the latest **repo-defined** body is: 068's body with that one
substring replaced, per 070.

**Applied-state records in `docs/handoff/payment-security.md`:**
- **068** — explicitly named as applied ("the verifier context RPC in **applied
  migration 068** fails in its attempt branch...", line ~3222).
- **073** — explicitly named as applied, with a cited migration SHA256
  (`1103FB7B...677C8`) and stated post-apply verification (owner, grants, search_path,
  SECURITY DEFINER), applied "only to `flexsoar_payment_v2_integration_test`".
- **069, 070, 071, 072** — **unknown**: no entry in `docs/handoff/payment-security.md`
  (or any other track's handoff file) names any of these four files or states they were
  applied. Given 073's own preflight structurally assumes a prior schema state and the
  repo's own convention is to apply migrations in order, it is likely they ran before
  073, but this is not something I found recorded, so I am not asserting it as fact.

### c) Collision sweep — PL/pgSQL variable vs SQL alias, migrations 059-073

Method: every `DECLARE` block in `059`-`073` was cross-referenced against every
`FROM`/`JOIN ... <alias>` in the same function body, for aliases matching a declared
variable name. Only read/greped — nothing executed.

| Function (migration) | Declared names at risk | Alias collision? | Verdict |
|---|---|---|---|
| `fn_payment_v2_verifier_context`, attempt branch (068, carried into 070) | `s` | `JOIN payment_v2.sales s` inside the same statement as variable `s` | **CONFIRMED** |
| `fn_payment_v2_verifier_context`, decision/lifecycle branches (068/070) | `d,x,s,st` | queries use bare table names or distinct aliases (`g`, `a` for `governance_approvals`), never re-alias `s`/`d`/`x`/`st` | CLEAR |
| `payment_v2.attempt_status` (060) | — | `LANGUAGE sql`, not plpgsql — no PL/pgSQL variables exist to collide | CLEAR |
| `fn_payment_v2_recovery_binding` (060) | `a` | query aliases attempts as `a0` (not `a`) specifically to avoid this; sales alias `s` has no declared `s` var here | CLEAR |
| `fn_payment_v2_record_verified_event` (060) | `a,s,e` | all three branches use unaliased `FROM payment_v2.<table>`, no alias reused | CLEAR |
| `fn_payment_v2_prepare_sale` (060) | `l,c,i,v,n,w,s` (s is `uuid`, not a rowtype) | no matching alias reuse found | CLEAR |
| `payment_v2.exit_plan` (062) | `op,s,a,n` | query aliases attempts as `a0`, escrows as `x` (no declared `x`) — collision avoided | CLEAR |
| `fn_payment_v2_signed_operation` / `fn_payment_v2_stage_signed_operation` (062) | `o` | queries alias `x`,`op` (not `o`) | CLEAR |
| `payment_v2.correspondence()` trigger (063) | `ok` only | aliases `c,i,a,b,e,s,o` used freely — no declared var shares those names | CLEAR |
| `fn_payment_v2_approve_refund` / refund-adjacent functions (061, 067) | `e,a,s,c,x,st,d,n` | subqueries alias as `d0,t,ad,at,rd,rt,st` (in a function that doesn't declare `st`), etc. — checked each, no same-function collision found | CLEAR |
| `fn_payment_v2_store_chain_evidence` / `fn_payment_v2_attempt_context` (068/069) | `n,a,s,d,x,o` | all lookups use unaliased `FROM payment_v2.<table>`; the one aliased join (`events e JOIN consumptions c`) doesn't collide with any declared name in that function | CLEAR |
| Remaining ~45 functions across 059-073 (`payment_v2.b58/le64/unb58/require_role/...`, admin/outbox/dispute/recovery/encoding functions) | various | no `DECLARE`'d name reused as a `FROM`/`JOIN` alias in the same body | CLEAR |

Net: **one CONFIRMED defect** (the task's known bug), **zero POSSIBLE**, everything
else **CLEAR**. Not exhaustively re-verified by execution — this is a static read, and
I am stating that plainly rather than implying it was tested.

### d) Proposed next migration

Per the `0NN_payment_v2_<description>.sql` convention (`supabase/migrations/`, highest
existing is `073_payment_v2_evidence_decision_column.sql`), the next file would be:

```
supabase/migrations/074_payment_v2_verifier_context_attempt_alias.sql
```

This is a proposed filename only — the founder creates the file.

### e) Proposed SQL text (for the founder to create as 074, not executed by me)

**md5(prosrc) precomputation.** I cannot query the live catalog, so I computed
`md5(prosrc)` offline from the 068 source for both line-ending conventions, so the
guard can accept either without me asserting which one the live row actually has.
Method: `prosrc` is the verbatim text between the function's `$$` delimiters — i.e.
`068_payment_v2_contexts_evidence.sql` lines 89 (`DECLARE ...`) through the `END` token
on line 117 (the file's own `END $$;` — the `prosrc` text itself is `...END`, without
the delimiter `$$;`). Concrete reproduction:

```bash
# from the repo root, LF form:
sed -n '89,116p' supabase/migrations/068_payment_v2_contexts_evidence.sql > body.txt
printf 'END' >> body.txt
md5sum body.txt   # => 209bda0e6b3b6251270d21f7bbb02e6e

# CRLF form: convert embedded LF to CRLF, same content otherwise
perl -pe 's/\n/\r\n/' body.txt > body_crlf.txt
md5sum body_crlf.txt   # => 29178c1a83f3282c65c66a0dfa19bcde
```

LF md5: `209bda0e6b3b6251270d21f7bbb02e6e`
CRLF md5: `29178c1a83f3282c65c66a0dfa19bcde`

**This is an assumption, not a verified fact** — I have not queried `pg_proc.prosrc`
for the applied function, so I cannot confirm Postgres's stored `prosrc` matches this
reconstruction byte-for-byte (e.g. if it trims a leading/trailing newline differently
than assumed here). The PRE-GUARD below is written to refuse to proceed if neither
hash matches, which converts that uncertainty into a safe failure rather than a silent
wrong assumption — the founder should treat a PRE-GUARD failure as "re-derive the hash
from the live catalog," not as proof the repair is wrong.

```sql
BEGIN;

-- PRE-GUARD: refuse unless exactly one overload exists and its body is byte-identical
-- (modulo LF/CRLF) to the 068-defined body, carried through 070's governance-order fix.
DO $preguard$
DECLARE overloads int;body_md5 text;
BEGIN
 SELECT count(*) INTO overloads FROM pg_proc
  WHERE proname='fn_payment_v2_verifier_context' AND pronamespace='public'::regnamespace;
 IF overloads<>1 THEN
  RAISE EXCEPTION 'expected exactly one overload of fn_payment_v2_verifier_context, found %',overloads;
 END IF;
 SELECT md5(prosrc) INTO body_md5 FROM pg_proc
  WHERE oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;
 IF body_md5 NOT IN ('209bda0e6b3b6251270d21f7bbb02e6e','29178c1a83f3282c65c66a0dfa19bcde') THEN
  RAISE EXCEPTION 'applied body md5 % matches neither expected LF/CRLF hash; do not proceed, re-derive from live catalog',body_md5;
 END IF;
END $preguard$;

-- SNAPSHOT: capture full identity/attribute state before changing anything.
CREATE TEMP TABLE payment_v2_verifier_context_snapshot ON COMMIT DROP AS
 SELECT oid,proowner,proacl,prosecdef,proconfig,provolatile,proisstrict,proparallel,
        proleakproof,pg_get_function_identity_arguments(oid) AS identity_args,
        pg_get_function_result(oid) AS result_type
 FROM pg_proc WHERE oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;

-- REPAIR: rename only the colliding SQL alias (s -> sl) in the attempt branch.
-- Signature, return type, language, SECURITY DEFINER and search_path are unchanged
-- because they are not mentioned in the replace target below.
DO $repair$
DECLARE definition text;
 old_text text:='RETURN (SELECT jsonb_build_object(''formatVersion'',1,''kind'',''attempt'',''attemptId'',a.id,''saleId'',s.id,''listingId'',s.listing_id,''cardId'',s.card_id,''itemId'',s.item_id,''buyerId'',a.buyer_id,''sellerId'',s.seller_id,''networkId'',s.network_id,''genesis'',payment_v2.b58((s.network_snapshot).genesis),''program'',payment_v2.b58((s.network_snapshot).program),''config'',payment_v2.b58((s.network_snapshot).config),''sale'',payment_v2.b58(s.sale_address),''attemptCommitment'',payment_v2.b58(a.attempt_commitment),''permitHex'',encode(a.permit,''hex''),''mode'',s.mode,''generation'',s.generation::text,''revision'',s.revision::text,''custodyVersion'',s.custody_version::text,''buyerWallet'',payment_v2.b58(a.buyer_wallet),''sellerWallet'',payment_v2.b58(a.seller_wallet),''buyerToken'',payment_v2.b58(a.buyer_token),''sellerToken'',payment_v2.b58(a.seller_token),''treasuryToken'',payment_v2.b58(a.treasury_token),''refundToken'',payment_v2.b58(a.refund_token),''totalUnits'',a.total_units::text,''netUnits'',a.net_units::text,''feeUnits'',a.fee_units::text,''validFrom'',a.valid_from::text,''expiresAt'',a.expires_at::text)
   FROM payment_v2.attempts a JOIN payment_v2.sales s ON s.id=a.sale_id WHERE a.id=p_subject_id AND a.permit IS NOT NULL);';
 new_text text:='RETURN (SELECT jsonb_build_object(''formatVersion'',1,''kind'',''attempt'',''attemptId'',a.id,''saleId'',sl.id,''listingId'',sl.listing_id,''cardId'',sl.card_id,''itemId'',sl.item_id,''buyerId'',a.buyer_id,''sellerId'',sl.seller_id,''networkId'',sl.network_id,''genesis'',payment_v2.b58((sl.network_snapshot).genesis),''program'',payment_v2.b58((sl.network_snapshot).program),''config'',payment_v2.b58((sl.network_snapshot).config),''sale'',payment_v2.b58(sl.sale_address),''attemptCommitment'',payment_v2.b58(a.attempt_commitment),''permitHex'',encode(a.permit,''hex''),''mode'',sl.mode,''generation'',sl.generation::text,''revision'',sl.revision::text,''custodyVersion'',sl.custody_version::text,''buyerWallet'',payment_v2.b58(a.buyer_wallet),''sellerWallet'',payment_v2.b58(a.seller_wallet),''buyerToken'',payment_v2.b58(a.buyer_token),''sellerToken'',payment_v2.b58(a.seller_token),''treasuryToken'',payment_v2.b58(a.treasury_token),''refundToken'',payment_v2.b58(a.refund_token),''totalUnits'',a.total_units::text,''netUnits'',a.net_units::text,''feeUnits'',a.fee_units::text,''validFrom'',a.valid_from::text,''expiresAt'',a.expires_at::text)
   FROM payment_v2.attempts a JOIN payment_v2.sales sl ON sl.id=a.sale_id WHERE a.id=p_subject_id AND a.permit IS NOT NULL);';
BEGIN
 SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc
  WHERE oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;
 IF position(old_text IN definition)=0 THEN
  RAISE EXCEPTION 'repair target text not found verbatim in live function definition — do not blind-replace, re-derive from live catalog';
 END IF;
 EXECUTE replace(definition,old_text,new_text);
END $repair$;

-- POST-GUARD: every captured attribute must be byte-identical to the snapshot, the
-- function must still be SECURITY DEFINER, exactly one overload must exist, and the
-- new body must contain no remaining alias/variable collision for this function's
-- declared names (d,x,s,st).
DO $postguard$
DECLARE r record;new_src text;
BEGIN
 SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proisstrict,
        p.proparallel,p.proleakproof,pg_get_function_identity_arguments(p.oid) AS identity_args,
        pg_get_function_result(p.oid) AS result_type,p.prosrc
  INTO r FROM pg_proc p WHERE p.oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;
 new_src:=r.prosrc;
 IF (SELECT count(*) FROM pg_proc WHERE proname='fn_payment_v2_verifier_context' AND pronamespace='public'::regnamespace)<>1
  OR r.prosecdef IS DISTINCT FROM true
  OR NOT EXISTS(SELECT 1 FROM payment_v2_verifier_context_snapshot s
     WHERE s.proowner=r.proowner AND s.proacl=r.proacl AND s.prosecdef=r.prosecdef
       AND s.proconfig=r.proconfig AND s.provolatile=r.provolatile AND s.proisstrict=r.proisstrict
       AND s.proparallel=r.proparallel AND s.proleakproof=r.proleakproof
       AND s.identity_args=r.identity_args AND s.result_type=r.result_type)
  OR new_src ~ '(^|[^A-Za-z0-9_])sales s($|[^A-Za-z0-9_])'
 THEN
  RAISE EXCEPTION 'post-repair catalog state diverges from snapshot, or a sales-alias collision remains — rolling back';
 END IF;
END $postguard$;

COMMIT;
```

No `GRANT`, `REVOKE`, `ALTER ... OWNER TO`, or any statement touching an object other
than `fn_payment_v2_verifier_context` appears above.

**Alias vs. variable — why the alias was renamed, not the variable.** The variable `s`
is read in all three branches (`decision`, `attempt`, `lifecycle`) across roughly 20
lines total. The colliding alias exists in exactly one place — the two-line `attempt`
subquery. Renaming the alias touches 2 lines inside 1 branch; renaming the variable
would touch every reference to `s` across all 3 branches, for no additional safety
(the variable's name has no significance outside the function). Fewer lines, strictly
less surface area for a typo, no behavioral difference either way.

### f) Full body diff, 068 body vs. proposed body

Only the `attempt` branch's SQL alias changes; the `decision` and `lifecycle` branches,
the function signature, `LANGUAGE`, `SECURITY DEFINER`, and `SET search_path` are
byte-identical. (This is the same two-line span shown in (e) above — `s` → `sl` as a
table alias, and `s.<col>` → `sl.<col>` for every column reference bound to that
alias, inside the `attempt` branch's `SELECT ... FROM payment_v2.attempts a JOIN
payment_v2.sales s/sl ON s/sl.id=a.sale_id ...` statement only.) Nothing in the
`decision` branch (lines ~92-106) or `lifecycle` branch (lines ~111-115) changes, and
the variable `s` in those two branches still refers to the function's own
`payment_v2.sales%rowtype` variable exactly as before.

### g) Post-approval test plan (NOT executed)

Per `AGENT_RULES.md` §8 and the task's own scope, this is a plan for the founder (or a
future authorized session) to run, via the WSL Ubuntu path this repo documents at
`/c/Users/Family/flexsoar-payment-db-preparation-69c6161.md` ("Use Ubuntu (`wsl.exe -d
Ubuntu`) consistently for Docker and database commands") and
`tests/payment-integration/evidence-db-readback.mjs` (the existing dedicated-login
readback harness, run with its required `--read-existing-evidence-isolated-only` flag).

1. **Container verification, before anything else** (matches the method already used
   in `docs/handoff/payment-security.md`'s prior entries): confirm container ID,
   `network=none`, zero published ports, exactly the approved read-only mounts, and
   loopback-only namespace topology (`/proc/self/ns/net`, `/proc/net/dev` showing only
   `lo`, `/proc/net/route` with one line) — the same checks
   `evidence-db-readback.mjs` performs against `/state/integration-host-attestation.json`
   before it opens any connection.
2. Apply `074_payment_v2_verifier_context_attempt_alias.sql` to
   `flexsoar_payment_v2_integration_test` only, inside a transaction, and confirm the
   PRE-GUARD/POST-GUARD both pass (a POST-GUARD failure must roll back the whole
   migration — do not retry with `--no-verify` or a hand edit).
3. **Positive path, using the real dedicated worker login `payment_integration_verifier`**
   (created by `tests/payment-integration/00_worker_logins.sql`, granted role
   `payment_v2_verifier`): call `fn_payment_v2_verifier_context('attempt', <attemptId>)`
   for the attempt tied to the existing pending-acknowledgement fixture referenced in
   `docs/handoff/payment-security.md` (`verifierContextError` capture point in
   `evidence-db-readback.mjs`), confirm it now returns the expected JSON (not an
   ambiguous-column error), and that `readVerifiedPaymentEvidence` /
   `recoverCommittedClaimAcknowledgement` can proceed past the point they previously
   stopped at.
4. **Idempotency**: call the same `fn_payment_v2_verifier_context('attempt', ...)` a
   second and third time; all three results must be identical, and no row in
   `payment_v2.verified_chain_evidence` or any lifecycle/consumption table may be
   written as a side effect of a read-only context call.
5. **Negative checks**:
   - Connect as `payment_integration_verifier` and confirm it cannot reach any
     `fn_payment_v2_admin_*` function or any table outside its granted role (expect
     permission-denied, not a silent empty result).
   - Confirm there is no superuser/admin fallback path — i.e. the call fails closed
     (raises) rather than substituting a privileged identity when the dedicated login
     lacks a permission.
   - Attempt the same call as a different dedicated login (e.g.
     `payment_integration_settler` or `payment_integration_issuer`) for a subject it
     does not own/is not authorized for, and confirm cross-user access is refused by
     `payment_v2.require_role`, not merely filtered.
   - Deliberately fail a readback (e.g. an unknown `p_subject_id`) and confirm zero
     writes/lifecycle consumption resulted — re-run step 3's positive case afterward and
     confirm it is unaffected (no partial state from the failed attempt).
6. Record results the way prior entries in this file do: exact commands run, container
   ID, before/after catalog snapshots, and pass/fail per check — including the negative
   cases, explicitly, not just "all passed."

### h) Open questions / what I could not determine

- **`prosrc` exact bytes are an offline reconstruction, not a verified fact.** I have no
  DB connection this session; the PRE-GUARD's two hashes are my best-effort
  reconstruction of "what `pg_proc.prosrc` should contain," not a value read from the
  live catalog. If the PRE-GUARD fails on both hashes when the founder runs this, that
  means my reconstruction is wrong in some whitespace/trimming detail, not necessarily
  that the function was further modified — the fix at that point is to re-derive
  `md5(prosrc)` from the live row and update the PRE-GUARD, not to relax or remove it.
- **Whether migrations 069, 070, 071, 072 were actually applied, and in what order** —
  not recorded by filename anywhere in `docs/handoff/`. I'm treating 070's text-replace
  as logically "in effect" because it's the only other migration touching this function
  and the task's own context says the live function currently fails exactly as 068+070
  predicts, but I have not independently confirmed 070 (or 069/071/072) ran.
  No exact SQLSTATE/`CONTEXT:` block for the `42702` error exists in any tracked file —
  only the narrative sentence at `docs/handoff/payment-security.md:3222-3223`. If an
  exact captured error log exists outside this repo (e.g. in the Windows TEMP
  directories the handoff doc mentions, `flexsoar-final-{tsc,tests,build}` or similar),
  I did not have access to it and did not search outside this worktree.
- `proacl`'s exact text representation (grantor, timestamp-independent encoding) is
  compared by catalog equality in the SNAPSHOT/POST-GUARD rather than asserted as a
  literal string, specifically because I cannot verify its exact printed form without a
  live connection — flagging this so it isn't mistaken for an oversight.
- I did not re-run `npx tsc --noEmit` or `npm test` this session, per instruction 2 —
  so I have nothing to report there this round.

### 2026-10-20 rev 2

**Rev 2 supersedes rev 1's SQL.** Discard everything in rev 1 §(e): the md5
PRE-GUARD, the multi-line `old_text`/`new_text` pair and the POST-GUARD. Do not
create 074 from it. The only SQL proposed for 074 is the block in §(d) below.
Rev 1's prose root cause (§a), redefinition check (§b) and test plan (§g) still
stand, with the corrections noted here. Rev 1's text above is unchanged.

Constraints this session, same as rev 1: no `.sql` file created, edited, deleted or
executed (the proposed SQL lives only in this document); no database connection; no
`npm`/`tsc`/test run. The founder-owned `package.json`/`package-lock.json` changes and
the debris files (`0`, `3`, the five SHA256-named files, `payment-security-5c3db0e.diff`)
were not touched. The commit stages only this file.

**Pre-flight deviation (AGENT_RULES.md §0), recorded rather than hidden.**
`git log HEAD..main --oneline` printed one commit:
`afae327 deps: add @solana-program/memo for Privy Solana wallet (founder npm install 2026-09-26)`.
`git show --stat afae327` shows it touches only `package.json` (+1) and
`package-lock.json`, with no migration, handoff or `lib/` change. Following the
data.md:304 precedent, I stopped and asked the founder. The founder gave an explicit
go-ahead to continue without a reset, because this pass only appends docs. No
reset, merge or rebase was performed.

#### a) Rev 1 errors found while revising (verified offline)

1. **Rev 1's md5 values could never match, with or without 070.**
   070's own preflight (`070_payment_v2_context_governance_order.sql:9`) pins the
   pre-070 body by
   `encode(sha256(convert_to(prosrc,'UTF8')),'hex')='e1334b1600032f250e8cde4a70c618b73a0a3cb2662bbfa7b394f77cfd9b0114'`.
   I took the text between `AS $$` and `$$;` of 068's `CREATE FUNCTION` (068:88 to
   068:117, LF) as the body. Its sha256 is exactly `e1334b16…d9b0114`. That reconstruction
   starts with `\n` (the newline after `AS $$`) and ends with `END ` (trailing space
   before `$$`). Rev 1 hashed `sed -n '89,116p'` + `END`, which drops both. I reproduced
   rev 1's `209bda0e…` value from that command, so the method is the error. Rev 1's
   PRE-GUARD would therefore have refused on every database.
2. **Rev 1's PRE-GUARD also ignored 070** (the architect's finding 1). Removed entirely.
3. **Rev 1 §h claimed nothing about the stored form.** The 070 constant now gives
   a checked prediction of every hash and length. See §(f). They are predictions, not catalog reads.

#### b) Schema: read from source, not assumed

- `068_payment_v2_contexts_evidence.sql:87`:
  `CREATE FUNCTION public.fn_payment_v2_verifier_context(p_kind text,p_subject_id uuid) RETURNS jsonb`
- `068_payment_v2_contexts_evidence.sql:88`:
  `LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$`
- `068_payment_v2_contexts_evidence.sql:224` (owner/revoke loop):
  `FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN('fn_payment_v2_issuer_context','fn_payment_v2_verifier_context',…`
  followed at 068:225 by `EXECUTE format('ALTER FUNCTION %s OWNER TO payment_v2_owner',f.sig);`
- `068_payment_v2_contexts_evidence.sql:234`:
  `GRANT EXECUTE ON FUNCTION public.fn_payment_v2_verifier_context(text,uuid),… TO payment_v2_verifier;`
- `070_payment_v2_context_governance_order.sql:6` and `:19`:
  `WHERE oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;`

Schema is `public`. Every regprocedure cast and `pronamespace` filter in §(d) uses
`'public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure` /
`'public'::regnamespace`.

#### c) The two fragments: exact before/after

Each fragment lies wholly inside **one** source line of 068 and contains no `\n` or
`\r`, so the applied body's line-ending convention cannot affect matching. The
PRE-GUARD also asserts this at run time.

- **Fragment 1**, inside 068:108 (the attempt branch's `jsonb_build_object` span).
  It starts at `jsonb_build_object(` and ends at the line's last character `)`, with
  1052 characters old and 1066 new. It holds 14 `s.` alias references, all
  renamed to `sl.`.
- **Fragment 2**, inside 068:109 (the FROM/JOIN span), 68/70 characters.

```diff
-jsonb_build_object('formatVersion',1,'kind','attempt','attemptId',a.id,'saleId',s.id,'listingId',s.listing_id,'cardId',s.card_id,'itemId',s.item_id,'buyerId',a.buyer_id,'sellerId',s.seller_id,'networkId',s.network_id,'genesis',payment_v2.b58((s.network_snapshot).genesis),'program',payment_v2.b58((s.network_snapshot).program),'config',payment_v2.b58((s.network_snapshot).config),'sale',payment_v2.b58(s.sale_address),'attemptCommitment',payment_v2.b58(a.attempt_commitment),'permitHex',encode(a.permit,'hex'),'mode',s.mode,'generation',s.generation::text,'revision',s.revision::text,'custodyVersion',s.custody_version::text,'buyerWallet',payment_v2.b58(a.buyer_wallet),'sellerWallet',payment_v2.b58(a.seller_wallet),'buyerToken',payment_v2.b58(a.buyer_token),'sellerToken',payment_v2.b58(a.seller_token),'treasuryToken',payment_v2.b58(a.treasury_token),'refundToken',payment_v2.b58(a.refund_token),'totalUnits',a.total_units::text,'netUnits',a.net_units::text,'feeUnits',a.fee_units::text,'validFrom',a.valid_from::text,'expiresAt',a.expires_at::text)
+jsonb_build_object('formatVersion',1,'kind','attempt','attemptId',a.id,'saleId',sl.id,'listingId',sl.listing_id,'cardId',sl.card_id,'itemId',sl.item_id,'buyerId',a.buyer_id,'sellerId',sl.seller_id,'networkId',sl.network_id,'genesis',payment_v2.b58((sl.network_snapshot).genesis),'program',payment_v2.b58((sl.network_snapshot).program),'config',payment_v2.b58((sl.network_snapshot).config),'sale',payment_v2.b58(sl.sale_address),'attemptCommitment',payment_v2.b58(a.attempt_commitment),'permitHex',encode(a.permit,'hex'),'mode',sl.mode,'generation',sl.generation::text,'revision',sl.revision::text,'custodyVersion',sl.custody_version::text,'buyerWallet',payment_v2.b58(a.buyer_wallet),'sellerWallet',payment_v2.b58(a.seller_wallet),'buyerToken',payment_v2.b58(a.buyer_token),'sellerToken',payment_v2.b58(a.seller_token),'treasuryToken',payment_v2.b58(a.treasury_token),'refundToken',payment_v2.b58(a.refund_token),'totalUnits',a.total_units::text,'netUnits',a.net_units::text,'feeUnits',a.fee_units::text,'validFrom',a.valid_from::text,'expiresAt',a.expires_at::text)
-FROM payment_v2.attempts a JOIN payment_v2.sales s ON s.id=a.sale_id
+FROM payment_v2.attempts a JOIN payment_v2.sales sl ON sl.id=a.sale_id
```

Offline verification against three reconstructions of the stored body (068-only LF,
068+070 LF, 068+070 CRLF):

- Each fragment occurs exactly once.
- Fragment 2 still occurs exactly once after fragment 1 is substituted.
- `\bsl\b` occurs zero times before the change.
- No bare `s.` remains in the attempt branch after the change.
- A line diff of 068+070 against the result changes exactly two lines (body lines 20–21 = 068:108–109).
- The decision and lifecycle branches are byte-identical.

**`sl` is new.** The function declares `d, x, s, st, keys, action_code, ix_name`
(068:89) and has parameters `p_kind, p_subject_id` (068:87). There are no OUT
parameters and no RETURNS TABLE (`RETURNS jsonb`). `sl` appears nowhere in the 068
or 068+070 body as a whole word. The PRE-GUARD re-checks this against the live
`prosrc` (`v_src ~ E'\\msl\\M'`).

#### d) Full proposed SQL for `074_payment_v2_verifier_context_attempt_alias.sql` (founder creates; NOT executed)

```sql
-- Rename the attempt-branch sales alias (s -> sl) so it no longer collides with the
-- function's PL/pgSQL row variable s (42702). Self-relative guards: the only permitted
-- change is the two single-line fragment substitutions below; metadata, owner, ACL,
-- SECURITY DEFINER and search_path must be identical before and after.
BEGIN;
CREATE TEMP TABLE payment_v2_verifier_alias_before ON COMMIT DROP AS
 SELECT fn.oid,fn.proowner,fn.proacl,fn.prosecdef,fn.proconfig,fn.provolatile,fn.proisstrict,
  fn.proparallel,fn.proleakproof,pg_get_function_identity_arguments(fn.oid) AS identity_args,
  pg_get_function_result(fn.oid) AS result_type,to_jsonb(fn)-'prosrc' AS metadata,fn.prosrc,
  'jsonb_build_object(''formatVersion'',1,''kind'',''attempt'',''attemptId'',a.id,''saleId'',s.id,''listingId'',s.listing_id,''cardId'',s.card_id,''itemId'',s.item_id,''buyerId'',a.buyer_id,''sellerId'',s.seller_id,''networkId'',s.network_id,''genesis'',payment_v2.b58((s.network_snapshot).genesis),''program'',payment_v2.b58((s.network_snapshot).program),''config'',payment_v2.b58((s.network_snapshot).config),''sale'',payment_v2.b58(s.sale_address),''attemptCommitment'',payment_v2.b58(a.attempt_commitment),''permitHex'',encode(a.permit,''hex''),''mode'',s.mode,''generation'',s.generation::text,''revision'',s.revision::text,''custodyVersion'',s.custody_version::text,''buyerWallet'',payment_v2.b58(a.buyer_wallet),''sellerWallet'',payment_v2.b58(a.seller_wallet),''buyerToken'',payment_v2.b58(a.buyer_token),''sellerToken'',payment_v2.b58(a.seller_token),''treasuryToken'',payment_v2.b58(a.treasury_token),''refundToken'',payment_v2.b58(a.refund_token),''totalUnits'',a.total_units::text,''netUnits'',a.net_units::text,''feeUnits'',a.fee_units::text,''validFrom'',a.valid_from::text,''expiresAt'',a.expires_at::text)'::text AS frag1_old,
  'jsonb_build_object(''formatVersion'',1,''kind'',''attempt'',''attemptId'',a.id,''saleId'',sl.id,''listingId'',sl.listing_id,''cardId'',sl.card_id,''itemId'',sl.item_id,''buyerId'',a.buyer_id,''sellerId'',sl.seller_id,''networkId'',sl.network_id,''genesis'',payment_v2.b58((sl.network_snapshot).genesis),''program'',payment_v2.b58((sl.network_snapshot).program),''config'',payment_v2.b58((sl.network_snapshot).config),''sale'',payment_v2.b58(sl.sale_address),''attemptCommitment'',payment_v2.b58(a.attempt_commitment),''permitHex'',encode(a.permit,''hex''),''mode'',sl.mode,''generation'',sl.generation::text,''revision'',sl.revision::text,''custodyVersion'',sl.custody_version::text,''buyerWallet'',payment_v2.b58(a.buyer_wallet),''sellerWallet'',payment_v2.b58(a.seller_wallet),''buyerToken'',payment_v2.b58(a.buyer_token),''sellerToken'',payment_v2.b58(a.seller_token),''treasuryToken'',payment_v2.b58(a.treasury_token),''refundToken'',payment_v2.b58(a.refund_token),''totalUnits'',a.total_units::text,''netUnits'',a.net_units::text,''feeUnits'',a.fee_units::text,''validFrom'',a.valid_from::text,''expiresAt'',a.expires_at::text)'::text AS frag1_new,
  'FROM payment_v2.attempts a JOIN payment_v2.sales s ON s.id=a.sale_id'::text AS frag2_old,
  'FROM payment_v2.attempts a JOIN payment_v2.sales sl ON sl.id=a.sale_id'::text AS frag2_new
 FROM pg_proc fn WHERE fn.oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;

DO $preguard$
DECLARE v_overloads bigint;v_rows bigint;v_src text;v_f1 text;v_f2 text;v_n1 text;v_n2 text;v_secdef boolean;v_config text[];
BEGIN
 SELECT count(*) INTO v_overloads FROM pg_proc
  WHERE proname='fn_payment_v2_verifier_context' AND pronamespace='public'::regnamespace;
 IF v_overloads<>1 THEN
  RAISE EXCEPTION '074: expected exactly one public.fn_payment_v2_verifier_context overload, found %',v_overloads;
 END IF;
 SELECT count(*) INTO v_rows FROM payment_v2_verifier_alias_before;
 IF v_rows<>1 THEN RAISE EXCEPTION '074: snapshot captured % rows, expected 1',v_rows;END IF;
 SELECT snap.prosrc,snap.frag1_old,snap.frag2_old,snap.frag1_new,snap.frag2_new,snap.prosecdef,snap.proconfig
  INTO v_src,v_f1,v_f2,v_n1,v_n2,v_secdef,v_config FROM payment_v2_verifier_alias_before snap;
 IF v_src IS NULL THEN RAISE EXCEPTION '074: snapshot prosrc is NULL';END IF;
 IF position('ORDER BY a.staff_id' IN v_src)=0 OR position('ORDER BY g.staff_id' IN v_src)>0 THEN
  RAISE EXCEPTION '074: 070 governance-order fix not present as expected; inspect catalog before repair';
 END IF;
 IF (length(v_src)-length(replace(v_src,v_f1,'')))/length(v_f1)<>1
  OR (length(v_src)-length(replace(v_src,v_f2,'')))/length(v_f2)<>1 THEN
  RAISE EXCEPTION '074: each repair fragment must occur exactly once in prosrc (frag1 %, frag2 %)',
   (length(v_src)-length(replace(v_src,v_f1,'')))/length(v_f1),(length(v_src)-length(replace(v_src,v_f2,'')))/length(v_f2);
 END IF;
 IF (length(replace(v_src,v_f1,v_n1))-length(replace(replace(v_src,v_f1,v_n1),v_f2,'')))/length(v_f2)<>1 THEN
  RAISE EXCEPTION '074: frag2 occurrence count changed after frag1 substitution';
 END IF;
 IF position(E'\n' IN v_f1||v_f2||v_n1||v_n2)>0 OR position(E'\r' IN v_f1||v_f2||v_n1||v_n2)>0 THEN
  RAISE EXCEPTION '074: repair fragments must not contain a line terminator';
 END IF;
 IF v_src ~ E'\\msl\\M' THEN RAISE EXCEPTION '074: identifier sl already present in prosrc';END IF;
 IF v_secdef IS DISTINCT FROM true OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
  RAISE EXCEPTION '074: verifier context is not SECURITY DEFINER with search_path=pg_catalog';
 END IF;
END $preguard$;

DO $repair$
DECLARE v_definition text;v_f1 text;v_f2 text;v_n1 text;v_n2 text;
BEGIN
 SELECT snap.frag1_old,snap.frag2_old,snap.frag1_new,snap.frag2_new INTO v_f1,v_f2,v_n1,v_n2
  FROM payment_v2_verifier_alias_before snap;
 SELECT pg_get_functiondef(oid) INTO v_definition FROM pg_proc
  WHERE oid='public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure;
 IF (length(v_definition)-length(replace(v_definition,v_f1,'')))/length(v_f1)<>1
  OR (length(v_definition)-length(replace(v_definition,v_f2,'')))/length(v_f2)<>1 THEN
  RAISE EXCEPTION '074: repair fragments not found exactly once in pg_get_functiondef output';
 END IF;
 EXECUTE replace(replace(v_definition,v_f1,v_n1),v_f2,v_n2);
END $repair$;

DO $postguard$
BEGIN
 IF (SELECT count(*) FROM pg_proc
     WHERE proname='fn_payment_v2_verifier_context' AND pronamespace='public'::regnamespace)<>1 THEN
  RAISE EXCEPTION '074: overload count changed during repair';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_v2_verifier_alias_before snap JOIN pg_proc live ON live.oid IS NOT DISTINCT FROM snap.oid
  WHERE live.oid IS NOT DISTINCT FROM 'public.fn_payment_v2_verifier_context(text,uuid)'::regprocedure
   AND live.proowner IS NOT DISTINCT FROM snap.proowner
   AND live.proacl IS NOT DISTINCT FROM snap.proacl
   AND live.prosecdef IS NOT DISTINCT FROM snap.prosecdef
   AND live.proconfig IS NOT DISTINCT FROM snap.proconfig
   AND live.provolatile IS NOT DISTINCT FROM snap.provolatile
   AND live.proisstrict IS NOT DISTINCT FROM snap.proisstrict
   AND live.proparallel IS NOT DISTINCT FROM snap.proparallel
   AND live.proleakproof IS NOT DISTINCT FROM snap.proleakproof
   AND pg_get_function_identity_arguments(live.oid) IS NOT DISTINCT FROM snap.identity_args
   AND pg_get_function_result(live.oid) IS NOT DISTINCT FROM snap.result_type
   AND (to_jsonb(live)-'prosrc') IS NOT DISTINCT FROM snap.metadata
   AND live.prosrc IS NOT DISTINCT FROM replace(replace(snap.prosrc,snap.frag1_old,snap.frag1_new),snap.frag2_old,snap.frag2_new)
   AND position('JOIN payment_v2.sales s ON s.id=a.sale_id' IN live.prosrc)=0
   AND live.prosecdef IS NOT DISTINCT FROM true) THEN
  RAISE EXCEPTION '074: verifier context changed beyond the attempt-branch sales alias rename; rolling back';
 END IF;
END $postguard$;
COMMIT;
```

How it answers each review finding:

- **1.** There is no hardcoded hash. The snapshot table stores the old `prosrc`. The
  PRE-GUARD refuses unless:
  - exactly one `public` overload exists;
  - `ORDER BY a.staff_id` is present and `ORDER BY g.staff_id` is absent;
  - each fragment occurs **exactly** once, counted with the
    `(length-length(replace))/length` idiom from 070/071/073;
  - fragment 2's count is unchanged after fragment 1 is substituted;
  - neither fragment contains a line terminator;
  - `sl` is absent;
  - the function is still SECURITY DEFINER with `search_path=pg_catalog`.

  The POST-GUARD requires
  `live.prosrc IS NOT DISTINCT FROM replace(replace(snap.prosrc,frag1_old,frag1_new),frag2_old,frag2_new)`.
  That makes the two substitutions the only change to the body. The fragments are
  stored once, in the snapshot table, so the three blocks cannot drift apart.
- **2.** Two single-line fragments, as shown in §(c).
- **3.** Every snapshot vs post-state comparison uses `IS NOT DISTINCT FROM`,
  including the oid join. The comparisons cover owner, ACL, secdef, config,
  volatility, strictness, parallel, leakproof, identity args, result type and the
  full `to_jsonb(pg_proc)-'prosrc'` metadata, which 070/072/073 used as their
  postflight.
- **4.** Schema `public` comes from the source, as shown in §(b).
- **6.** The snapshot alias is `snap` and the catalog alias is `live`. The CREATE TEMP
  TABLE uses `fn`. None of these is a variable anywhere in this migration. The DO
  blocks declare only `v_`-prefixed variables (`v_overloads, v_rows, v_src, v_f1, v_f2,
  v_n1, v_n2, v_secdef, v_config, v_definition`), and the POST-GUARD declares none.
  No DO-block statement references a bare column whose name equals one of those
  variables.

No GRANT, REVOKE, OWNER, DROP, arity change (AGENT_RULES §7) or other object is touched.

#### e) Why the alias, not the variable

This is unchanged from rev 1. Renaming the alias changes two lines in one branch.
Renaming the variable `s` would touch every `s.` reference in the decision and
lifecycle branches for no gain.

#### f) Hashes: informational only, used by NO guard

| What | md5(prosrc) | length | Source |
|---|---|---|---|
| Rev 1 values (computed from 068 **without** 070; and, per §a, a wrong reconstruction missing the leading `\n` and trailing space) | LF `209bda0e6b3b6251270d21f7bbb02e6e`, CRLF `29178c1a83f3282c65c66a0dfa19bcde` | — | rev 1 §e; informational, never valid |
| 068 only (pre-070), LF | `37b628ba0ede96918692b992c306e1b5` | 7283 | sha256 `e1334b16…d9b0114` = 070:9's pinned constant |
| 068 only, CRLF | `a776f9825bb485c527afed61aa6ff7b7` | 7312 | offline |
| **068 + 070, LF (expected live)** | `647ef1758fb6468cfbda1dc72a557cd0` | 7283 | offline |
| 068 + 070, CRLF | `28d99ad4ae7edb02ad5d5963778fa154` | 7312 | offline |
| After 074 on 068+070 LF | `3e39cf76a408b38d7b665116ded63101` | 7299 | offline |
| After 074 on 068+070 CRLF | `c19e803cec154ecbbb7c197e419efc8f` | 7328 | offline |

#### g) Re-sweep, migrations 059–073: variable/parameter vs UNQUALIFIED column (42702)

**Method.** This was a static read. Nothing was executed.

- A scratch Python parser extracted every `CREATE [OR REPLACE] FUNCTION` in 059–073:
  70 definitions. 063:137 is an `EXECUTE format(...)`, not a definition.
- For each definition it took the name, IN parameters, OUT/INOUT parameters,
  RETURNS TABLE columns, DECLARE names and `FOR <v> IN` loop variables.
- It collected the tables named after `FROM/JOIN/UPDATE/INSERT INTO/DELETE FROM`.
- Column sets for those tables came from every `CREATE TABLE`/`ALTER TABLE … ADD|RENAME
  COLUMN` in migrations 001–073.
- A hit is a declared or parameter name that equals a column of a table in scope
  in the same statement, used bare. Bare excludes `INTO` targets, INSERT column
  lists and `SET` left-hand sides.

**Validation.** The parser re-finds both known historical defects of this class: 061's
`action` (fixed by 067) and 069's `action` (fixed by 073). Every overlap it reported
was then read by hand.

**Findings.**

- **No function in 059–073 has OUT parameters or RETURNS TABLE/SETOF**:
  `grep 'RETURNS TABLE\|SETOF'` over 059–073 returns zero.
- Only four definitions have any declared name that equals a column of a table they touch.

| Verdict | Count |
|---|---|
| CONFIRMED live | **0** |
| CONFIRMED historical (already repaired by 067/069→073) | 3 definitions |
| POSSIBLE | **0** |
| CLEAR | rest |

Nothing was fixed. This is a report only.

| # | Function | Defined at | Status | Lang | Params (IN) | OUT / RETURNS TABLE | DECLARE / loop vars | Tables touched (`payment_v2.` unless prefixed) | Declared name = column of touched table | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `payment_v2.immutable` | 059:207 | effective | plpgsql | — | — | — | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 2 | `payment_v2.journal_balanced` | 059:220 | effective | plpgsql | — | — | — | usdc_journal | — | CLEAR: no declared/param name equals a column of any touched table |
| 3 | `payment_v2.require_role` | 060:3 | effective | plpgsql | `p_role` | — | — | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 4 | `payment_v2.proof_shape` | 060:14 | effective | plpgsql | `p` | — | — | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 5 | `payment_v2.funding_configuration` | 060:19 | effective | sql | `p_network` | — | — | networks, staff | — | CLEAR (N/A): `LANGUAGE sql`, which has no PL/pgSQL variables. In SQL functions a name clash resolves to the column and never raises 42702; all params are `p_`-prefixed and no touched table has such a column |
| 6 | `payment_v2.actor` | 060:28 | effective | plpgsql | — | — | `v` | public.users | — | CLEAR: no declared/param name equals a column of any touched table |
| 7 | `payment_v2.b58` | 060:33 | superseded by 064 | plpgsql | `p` | — | `n`, `r`, `i`, `z`, `a` / loop: `i` | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 8 | `payment_v2.unb58` | 060:41 | superseded by 064 | plpgsql | `p` | — | `n`, `r`, `i`, `j`, `z`, `a` / loop: `i` | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 9 | `payment_v2.le64` | 060:51 | superseded by 064 | plpgsql | `p` | — | `v`, `r`, `i` / loop: `i` | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 10 | `payment_v2.enqueue` | 060:58 | effective | plpgsql | `p_sale`, `p_action`, `p_payload`, `p_revision`, `p_command`, `p_decision`, `p_ready` | — | `v` | operations | — | CLEAR: no declared/param name equals a column of any touched table |
| 11 | `payment_v2.lock_card` | 060:67 | effective | plpgsql | `p_card` | — | `v_item` | public.cards, public.items | — | CLEAR: no declared/param name equals a column of any touched table |
| 12 | `payment_v2.lock_sale` | 060:75 | effective | plpgsql | `p_sale` | — | `v_card`, `v_listing` | sales, public.listings | — | CLEAR: no declared/param name equals a column of any touched table |
| 13 | `payment_v2.owns_claim` | 060:83 | effective | sql | `p_card`, `p_owner` | — | — | public.ledger_entries | — | CLEAR (N/A): `LANGUAGE sql`, which has no PL/pgSQL variables. In SQL functions a name clash resolves to the column and never raises 42702; all params are `p_`-prefixed and no touched table has such a column |
| 14 | `payment_v2.attempt_status` | 060:87 | effective | sql | `p_id` | — | — | attempts, escrows, events, operations, sales | — | CLEAR (N/A): `LANGUAGE sql`, which has no PL/pgSQL variables. In SQL functions a name clash resolves to the column and never raises 42702; all params are `p_`-prefixed and no touched table has such a column |
| 15 | `public.fn_payment_v2_prepare_sale` | 060:96 | effective | plpgsql | `p_listing_id`, `p_network_id`, `p_terms` | — | `l`, `c`, `i`, `v`, `n`, `w`, `s`, `raw`, `gen`, `prior_listing`, `prior_network`, `prior_terms` | inventory, networks, quote_books, sales, wallet_accounts, public.cards, public.items, public.listings, public.users | — | CLEAR: no declared/param name equals a column of any touched table |
| 16 | `public.fn_payment_v2_initiate` | 060:125 | superseded by 066 | plpgsql | `p_listing_id`, `p_idempotency_key`, `p_policy_version`, `p_policy_digest` | — | `u`, `a`, `s`, `n`, `q`, `w`, `v_id`, `v_card`, `v_now` | attempts, networks, policies, quote_books, sales, wallet_accounts, public.cards, public.listings, public.users | — | CLEAR: no declared/param name equals a column of any touched table |
| 17 | `public.fn_payment_v2_authorize_attempt` | 060:155 | effective | plpgsql | `p_attempt_id` | — | `a`, `s`, `n`, `v`, `p`, `policy` | attempts, inventory, networks, policies, sales | — | CLEAR: no declared/param name equals a column of any touched table |
| 18 | `public.fn_payment_v2_own_attempts` | 060:171 | effective | sql | `p_listing_id` | — | — | attempts | — | CLEAR (N/A): `LANGUAGE sql`, which has no PL/pgSQL variables. In SQL functions a name clash resolves to the column and never raises 42702; all params are `p_`-prefixed and no touched table has such a column |
| 19 | `public.fn_payment_v2_attach_candidate` | 060:174 | effective | plpgsql | `p_attempt_id`, `p_signature` | — | — | attempts, candidates | — | CLEAR: no declared/param name equals a column of any touched table |
| 20 | `public.fn_payment_v2_recovery_binding` | 060:179 | effective | plpgsql | `p_attempt`, `p_genesis`, `p_program` | — | `a` | attempts, consumptions, events, sales | — | CLEAR: no declared/param name equals a column of any touched table |
| 21 | `public.fn_payment_v2_record_verified_event` | 060:189 | effective | plpgsql | `p_event` | — | `a`, `s`, `e`, `v_kind`, `v_id` | attempts, events, sales | — | CLEAR: no declared/param name equals a column of any touched table |
| 22 | `payment_v2.move_claim` | 061:9 | effective | plpgsql | `p_event`, `p_card`, `p_from`, `p_to`, `p_conditional` | — | — | claim_history, public.ledger_entries | — | CLEAR: no declared/param name equals a column of any touched table |
| 23 | `public.fn_payment_v2_reconcile_event` | 061:18 | effective | plpgsql | `p_event_id` | — | `e`, `a`, `s`, `c`, `o`, `x`, `d`, `v_result`, `ref`, `n` | attempts, attestations, consumptions, decisions, escrows, events, inventory, operations, outbox, sales, staff, usdc_journal, public.cards, public.items, public.listings, public.orders | — | CLEAR: no declared/param name equals a column of any touched table |
| 24 | `public.fn_payment_v2_record_decision` | 061:99 | superseded by 067 | plpgsql | `p_decision` | — | `u`, `x`, `s`, `st`, `d`, `action`, `cmd`, `required_role`, `v_op`, `v_person` | attempts, attestations, decisions, escrows, governance_approvals, inventory, operations, sales, staff, public.cards | `action` = column of decisions/operations | **CONFIRMED (historical)**: variable `action` vs bare `action` in `SELECT id,escrow_id,action,... FROM payment_v2.decisions WHERE id=cmd`. Already repaired by 067 (`decision_row.action`); not live if 067 applied |
| 25 | `public.fn_payment_v2_approve_refund` | 061:138 | effective | plpgsql | `p_command_id` | — | `st`, `d`, `x`, `v` | decisions, escrows, governance_approvals, operations, staff | — | CLEAR: no declared/param name equals a column of any touched table |
| 26 | `public.fn_payment_v2_record_attestation` | 061:153 | effective | plpgsql | `p_proof` | — | `d`, `x`, `s`, `old`, `r` | attestations, decisions, escrows, governance_approvals, operations, sales, staff, public.items | — | CLEAR: no declared/param name equals a column of any touched table |
| 27 | `public.fn_payment_v2_record_lifecycle` | 061:181 | effective | plpgsql | `p_proof` | — | `s`, `old`, `k` | consumptions, events, inventory, lifecycle_evidence, operations, sales, public.listings | — | CLEAR: no declared/param name equals a column of any touched table |
| 28 | `public.fn_payment_v2_admin_queue` | 061:207 | effective | plpgsql | — | — | — | escrows, staff | — | CLEAR: no declared/param name equals a column of any touched table |
| 29 | `public.fn_payment_v2_admin_obligations` | 061:212 | effective | plpgsql | — | — | — | operations, staff, unresolved | — | CLEAR: no declared/param name equals a column of any touched table |
| 30 | `public.fn_payment_v2_begin_scan` | 062:3 | effective | plpgsql | `p_genesis`, `p_program`, `p_limit` | — | `n`, `c`, `v` | cursors, networks | — | CLEAR: no declared/param name equals a column of any touched table |
| 31 | `public.fn_payment_v2_finish_scan` | 062:17 | effective | plpgsql | `p_lease_id`, `p_last_address`, `p_failures` | — | `c`, `f` / loop: `f` | cursors, unresolved | — | CLEAR: no declared/param name equals a column of any touched table |
| 32 | `public.fn_payment_v2_claim_operations` | 062:32 | effective | plpgsql | `p_worker_id`, `p_limit` | — | `o`, `v`, `r` / loop: `o` | operations | — | CLEAR: no declared/param name equals a column of any touched table |
| 33 | `public.fn_payment_v2_finish_operation` | 062:46 | effective | plpgsql | `p_operation_id`, `p_lease_id`, `p_outcome`, `p_signature`, `p_error` | — | `o` | operations, signed_operations | — | CLEAR: no declared/param name equals a column of any touched table |
| 34 | `public.fn_payment_v2_operation_context` | 062:63 | effective | plpgsql | `p_operation_id`, `p_lease_id` | — | `o`, `s` | attempts, decisions, escrows, inventory, operations, sales | — | CLEAR: no declared/param name equals a column of any touched table |
| 35 | `public.fn_payment_v2_claim_outbox` | 062:76 | effective | plpgsql | `p_limit` | — | `o`, `v`, `r` / loop: `o` | outbox | — | CLEAR: no declared/param name equals a column of any touched table |
| 36 | `public.fn_payment_v2_finish_outbox` | 062:87 | effective | plpgsql | `p_id`, `p_lease_id`, `p_delivered`, `p_error` | — | `o` | outbox | — | CLEAR: no declared/param name equals a column of any touched table |
| 37 | `public.fn_payment_v2_record_operation_failure` | 062:100 | effective | plpgsql | `p_operation_id`, `p_proof` | — | `o`, `s`, `old` | operation_failures, operations, sales | — | CLEAR: no declared/param name equals a column of any touched table |
| 38 | `public.fn_payment_v2_list_card` | 062:117 | effective | plpgsql | `p_card_id`, `p_seller_id`, `p_price_cents`, `p_payout_method`, `p_fair_price_cents` | — | `c`, `v`, `r` | inventory, sales, public.cards, public.listings | — | CLEAR: no declared/param name equals a column of any touched table |
| 39 | `public.fn_payment_v2_request_cancel` | 062:127 | effective | plpgsql | `p_listing_id`, `p_actor` | — | `l`, `s` | sales, public.listings | — | CLEAR: no declared/param name equals a column of any touched table |
| 40 | `public.fn_payment_v2_redeem_card` | 062:145 | effective | plpgsql | `p_card_id`, `p_user_id`, `p_address`, `p_fee_cents` | — | — | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 41 | `public.fn_payment_v2_review_dispatch` | 062:158 | effective | plpgsql | `p_id`, `p_escrow_id`, `p_kind`, `p_digest`, `p_route`, `p_accepted_at` | — | `x`, `st`, `old` | dispatch_reviews, escrows, staff | — | CLEAR: no declared/param name equals a column of any touched table |
| 42 | `public.fn_payment_v2_worker_identity` | 062:172 | effective | plpgsql | `p_required_role` | — | — | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 43 | `payment_v2.exit_plan` | 062:179 | effective | plpgsql | `p_operation` | — | `op`, `s`, `a`, `n`, `accounts` | attempts, escrows, operations, sales | — | CLEAR: no declared/param name equals a column of any touched table |
| 44 | `public.fn_payment_v2_signed_operation` | 062:195 | effective | plpgsql | `p_operation_id`, `p_lease_id` | — | `o`, `stored` | operations, signed_operations | — | CLEAR: no declared/param name equals a column of any touched table |
| 45 | `public.fn_payment_v2_stage_signed_operation` | 062:205 | effective | plpgsql | `p_operation_id`, `p_lease_id`, `p_envelope` | — | `o`, `plan`, `old`, `raw`, `message` | escrows, operations, signed_operations | — | CLEAR: no declared/param name equals a column of any touched table |
| 46 | `payment_v2.terms_guard` | 063:9 | superseded by 065 | plpgsql | — | — | `excluded` | events | — | CLEAR: no declared/param name equals a column of any touched table |
| 47 | `payment_v2.audit_configuration` | 063:30 | effective | plpgsql | — | — | — | configuration_history | — | CLEAR: no declared/param name equals a column of any touched table |
| 48 | `payment_v2.staff_identity` | 063:34 | effective | plpgsql | — | — | — | staff | — | CLEAR: no declared/param name equals a column of any touched table |
| 49 | `payment_v2.correspondence` | 063:41 | effective | plpgsql | — | — | `ok` | attempts, events, sales, staff, public.cards, public.items, public.orders | — | CLEAR: no declared/param name equals a column of any touched table |
| 50 | `payment_v2.attempt_correspondence` | 063:60 | effective | plpgsql | — | — | `s`, `q` | quote_books, sales, wallet_accounts | — | CLEAR: no declared/param name equals a column of any touched table |
| 51 | `payment_v2.consumption_correspondence` | 063:78 | effective | plpgsql | — | — | `e`, `a`, `s`, `bad` | attempts, events, sales, usdc_journal, public.cards, public.ledger_entries, public.orders | — | CLEAR: no declared/param name equals a column of any touched table |
| 52 | `public.fn_payment_v2_managed` | 063:103 | effective | sql | `p_table`, `p_row` | — | — | inventory, sales | — | CLEAR (N/A): `LANGUAGE sql`, which has no PL/pgSQL variables. In SQL functions a name clash resolves to the column and never raises 42702; all params are `p_`-prefixed and no touched table has such a column |
| 53 | `public.fn_payment_v2_legacy_guard` | 063:111 | effective | plpgsql | — | — | — | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 54 | `payment_v2.b58` | 064:13 | effective | plpgsql | `p` | — | `n`, `r`, `i`, `z`, `a` / loop: `i` | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 55 | `payment_v2.unb58` | 064:21 | effective | plpgsql | `p` | — | `n`, `r`, `i`, `j`, `z`, `a` / loop: `i` | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 56 | `payment_v2.le64` | 064:31 | effective | plpgsql | `p` | — | `v`, `r`, `i` / loop: `i` | — | — | CLEAR: no table referenced in static SQL (EXECUTE text, if any, does not see PL/pgSQL variables) |
| 57 | `payment_v2.terms_guard` | 065:12 | effective | plpgsql | — | — | `excluded` | events | — | CLEAR: no declared/param name equals a column of any touched table |
| 58 | `public.fn_payment_v2_initiate` | 066:25 | effective | plpgsql | `p_listing_id`, `p_idempotency_key`, `p_policy_version`, `p_policy_digest` | — | `u`, `a`, `s`, `n`, `q`, `w`, `v_id`, `v_card`, `v_now` | attempts, networks, policies, quote_books, sales, wallet_accounts, public.cards, public.listings, public.users | — | CLEAR: no declared/param name equals a column of any touched table |
| 59 | `public.fn_payment_v2_record_decision` | 067:7 | effective | plpgsql | `p_decision` | — | `u`, `x`, `s`, `st`, `d`, `action`, `cmd`, `required_role`, `v_op`, `v_person` | attempts, attestations, decisions, escrows, governance_approvals, inventory, operations, sales, staff, public.cards | `action` = column of decisions/operations | CLEAR: `action` = `decisions.action`/`operations.action` by name, but every bare `action` is in an outer IF expression, `CASE action`, `INSERT ... VALUES(...)` or the `enqueue(...)` call, none of which has those tables in scope; all subquery uses are qualified (`pending.`, `resolution.`, `fd.`, `rd.`, `prev.`, `ad.`) |
| 60 | `payment_v2.consumption_digest` | 068:48 | effective | plpgsql | `p_event` | — | `e`, `c` | consumptions, events | — | CLEAR: no declared/param name equals a column of any touched table |
| 61 | `public.fn_payment_v2_issuer_context` | 068:59 | effective | plpgsql | `p_sale_id`, `p_action` | — | `s`, `v`, `n`, `q`, `actor`, `template`, `fee`, `net` | events, inventory, policies, quote_books, sales | — | CLEAR: no declared/param name equals a column of any touched table |
| 62 | `public.fn_payment_v2_verifier_context` | 068:87 | effective, text-edited by 070 | plpgsql | `p_kind`, `p_subject_id` | — | `d`, `x`, `s`, `st`, `keys`, `action_code`, `ix_name` | attempts, decisions, escrows, governance_approvals, sales, staff | — | CLEAR for this class: no declared name equals a column of a touched table. (The separate alias-vs-variable `s` defect is the one 074 repairs) |
| 63 | `public.fn_payment_v2_ack_context` | 068:119 | effective, text-edited by 072 | plpgsql | `p_event_id` | — | `e`, `c`, `s`, `v`, `actors`, `old`, `digest` | attempts, consumptions, events, inventory, lifecycle_evidence, sales, staff | — | CLEAR: no declared/param name equals a column of any touched table |
| 64 | `public.fn_payment_v2_store_chain_evidence` | 068:136 | superseded by 069 | plpgsql | `p_evidence` | — | `n`, `a`, `s`, `d`, `x`, `o`, `raw`, `existing`, `v_id`, `sid`, `kind`, `action`, `net`, `slot_value`, `time_value` | attempts, consumptions, decisions, escrows, events, networks, operations, sales, verified_chain_evidence | `action` = column of decisions/operations; `kind` = column of events | **CONFIRMED (historical)**: same `action` defect as the 069 row; this body was replaced by 069 |
| 65 | `public.fn_payment_v2_read_chain_evidence` | 068:178 | superseded by 069 | plpgsql | `p_subject_kind`, `p_subject_id`, `p_subject_action` | — | — | verified_chain_evidence | — | CLEAR: no declared/param name equals a column of any touched table |
| 66 | `payment_v2.evidence_insert_guard` | 068:185 | effective | plpgsql | — | — | `ev`, `expected_action`, `sid`, `sig`, `slot_value`, `network`, `genesis_bytes`, `program_bytes`, `evidence_id` | decisions, escrows, operations, sales, verified_chain_evidence | — | CLEAR: no declared/param name equals a column of any touched table |
| 67 | `payment_v2.consumption_evidence_guard` | 068:206 | effective | plpgsql | — | — | `e`, `ev` | events, verified_chain_evidence | — | CLEAR: no declared/param name equals a column of any touched table |
| 68 | `public.fn_payment_v2_attempt_context` | 069:19 | effective | plpgsql | `p_attempt`, `p_genesis`, `p_program` | — | `a`, `s` | attempts, sales | — | CLEAR: no declared/param name equals a column of any touched table |
| 69 | `public.fn_payment_v2_store_chain_evidence` | 069:30 | effective, text-edited by 071 and 073 | plpgsql | `p_evidence` | — | `n`, `a`, `s`, `d`, `x`, `o`, `raw`, `existing`, `v_id`, `sid`, `kind`, `action`, `net`, `slot_value`, `time_value` | attempts, consumptions, decisions, escrows, events, networks, operations, sales, verified_chain_evidence | `action` = column of decisions/operations; `kind` = column of events | **CONFIRMED, repaired by 073** (applied per this file): variable `action` vs bare `action` in `SELECT id,escrow_id,action INTO d.id,d.escrow_id,d.action FROM payment_v2.decisions WHERE id=sid`. Remaining overlaps CLEAR: `kind` (= `events.kind`) bare only in `ELSIF kind=...` and `subject_kind=kind` against `verified_chain_evidence`, which has no `kind` column; the events subquery uses `e.kind`. The operations SELECT projects only `id,sale_id,signature` |
| 70 | `public.fn_payment_v2_read_chain_evidence` | 069:71 | effective | plpgsql | `p_subject_kind`, `p_subject_id`, `p_subject_action` | — | — | verified_chain_evidence | — | CLEAR: no declared/param name equals a column of any touched table |

**Out of scope of this sweep, stated plainly:**

- Top-level `DO` blocks in 059–073 already ran at apply time, and a 42702 there
  would have aborted that migration.
- Dynamic SQL inside `EXECUTE` cannot see PL/pgSQL variables.
- Table detection is regex-based. A table reached only through a view, or a
  function call that returns rows, is not expanded. The 059–073 functions select
  from no view.

#### h) Founder runbook: read-only catalog check BEFORE 074 is approved (founder runs; I did not)

Sources:

- Container name, container ID, image digest and the three RO mounts:
  `tests/payment-integration/attest-helper.sh:5,14-17` and this file's "only executed database container" entry.
- Database name: `tests/payment-integration/README.md:4`.
- Loopback-only `docker exec` + `PGHOST/PGPORT/PGDATABASE/PGUSER` pattern:
  `tests/payment-db/README.md:500-505`.
- `supabase_admin` as the setup/audit identity for this database: the target guards
  at `tests/payment-integration/01_signable_fixtures.sql:6-7`,
  `02_inventory_fixture.sql:3` and `04_additional_buyers.sql:4`
  (`session_user<>'supabase_admin'` → refuse), plus `integrated.mjs:59`
  (`login='supabase_admin'`).
- `wsl.exe -d Ubuntu`: this file's earlier commands (e.g. line 760).

```text
REM ---- 1. Windows cmd.exe: enter the documented Ubuntu distro ----
wsl.exe -d Ubuntu

# ---- 2. Ubuntu bash: container verification. STOP at the first mismatch ----
N=flexsoar-payment-db-69c6161-20261016T022841Z
docker inspect --format '{{.Id}}' "$N"
#   expect: 71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92
docker inspect --format '{{.State.Running}} {{.HostConfig.NetworkMode}} {{.HostConfig.Privileged}}' "$N"
#   expect: true none false
docker inspect --format '{{json .HostConfig.PortBindings}}' "$N"
#   expect: {} or null  (no published ports)
docker inspect --format '{{.Config.Image}}' "$N"
#   expect: supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc
docker inspect --format '{{range .Mounts}}{{.Destination}} rw={{.RW}}{{println}}{{end}}' "$N"
#   expect exactly 3 lines, all rw=false: /audit/hba.conf, /audit/migrations, /audit/tests/payment-db
docker exec "$N" cat /proc/net/dev
#   expect: the two header lines plus lo only
docker exec "$N" cat /proc/net/route
#   expect: the header line only (no routes)

# ---- 3. psql over container loopback as the setup/audit identity ----
docker exec -it -e PGHOST=127.0.0.1 -e PGPORT=5432 -e PGDATABASE=flexsoar_payment_v2_integration_test -e PGUSER=supabase_admin "$N" psql -X -v ON_ERROR_STOP=1
#   if a password is requested: STOP. <UNKNOWN: supabase_admin loopback password, if HBA requires one>

-- ---- 4. inside psql: confirm target, then run the query verbatim ----
SELECT current_database(), inet_server_addr(), session_user;
--   expect: flexsoar_payment_v2_integration_test | 127.0.0.1 | supabase_admin   (anything else: \q and STOP)
BEGIN TRANSACTION READ ONLY;
SELECT p.oid::regprocedure AS fn, n.nspname AS schema,
       pg_get_userbyid(p.proowner) AS owner, p.proacl, p.prosecdef, p.proconfig,
       md5(p.prosrc) AS src_md5, length(p.prosrc) AS src_len,
       position(E'\r' IN p.prosrc) > 0 AS has_cr,
       left(p.prosrc, 1) = E'\n' AS leading_newline,
       position('ORDER BY a.staff_id' IN p.prosrc) > 0 AS has_070_fix,
       position('ORDER BY g.staff_id' IN p.prosrc) > 0 AS has_068_original,
       position('JOIN payment_v2.sales s ON s.id=a.sale_id' IN p.prosrc) > 0 AS has_defect
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'fn_payment_v2_verifier_context';
SELECT to_regclass('supabase_migrations.schema_migrations') AS migrations_table;
ROLLBACK;
\q

# ---- 5. back in Ubuntu bash ----
exit
```

**What to send back:** the full output of every command above. **Approve 074 only if:**

- exactly one row comes back, with `schema` = `public`;
- `prosecdef` = `t` and `proconfig` = `{search_path=pg_catalog}`;
- `has_070_fix` = `t`, `has_068_original` = `f` and `has_defect` = `t`;
- `src_md5`/`src_len` equal `647ef1758fb6468cfbda1dc72a557cd0`/`7283` with
  `has_cr` = `f`, or `28d99ad4ae7edb02ad5d5963778fa154`/`7312` with `has_cr` = `t`.
  These are predictions from §(f). 074 itself does not depend on them, but a
  mismatch means the live body differs from repo history and needs explaining first.

If `has_070_fix` = `f`, 074's PRE-GUARD will refuse by design. Report that state
instead of editing the guard. The expected `owner` is `payment_v2_owner` (068:225),
but this has not been verified for this function.

#### i) Open questions: unverifiable without a DB connection

- **Whether 070 (and 069/071/072) is applied to `flexsoar_payment_v2_integration_test`.**
  This file records no apply for 069–072 by filename. The runbook query answers 070
  directly (`has_070_fix`).
- **Exact stored `prosrc` bytes.** §(f) is an offline prediction anchored to 070's
  pinned sha256, not a catalog read. 074 does not depend on it.
- **That `pg_get_functiondef` output contains each fragment exactly once.** Inferred,
  because it embeds `prosrc` verbatim between `$function$` delimiters and the header
  contains neither fragment. The repair block re-checks this at run time and refuses
  on mismatch.
- **That `CREATE OR REPLACE` leaves `to_jsonb(pg_proc)-'prosrc'` identical.** The
  evidence is that 073 used the same postflight and is recorded applied (this file,
  the 073 entry). That is not proof for this function. If it differs, the POST-GUARD
  rolls back.
- **Postgres syntax of §(d).** No parser was available offline, so the block has
  not been compiled. The fragment literals were round-tripped through quote-doubling
  and compared byte-for-byte against the source.
- **Runbook environment.** Two things are not documented in the repo: whether
  `supabase_admin` needs a password over container loopback (`<UNKNOWN: supabase_admin
  loopback password, if HBA requires one>`), and whether this machine's Ubuntu
  `docker` CLI still talks to the daemon that holds the container. `attest-helper.sh`
  assumes it does.
- **Whether `supabase_migrations.schema_migrations` exists in the integration DB.**
  The query reports it. The README says the schema came from a pg_dump restore, not
  the Supabase CLI.
- **Exact `proacl` contents.** These are compared by catalog value and never asserted
  as a literal.

## 2026-10-20 - Milestone 3: pending retained-evidence recovery after 074 (dedicated worker logins)

**Outcome: BLOCKED (evidence absent).** 074 works: the dedicated verifier login now
gets valid JSON from `fn_payment_v2_verifier_context('attempt', ...)` (no 42702), and
the harness reports `verifierContextError:null`. Pending-acknowledgement recovery
from retained evidence is still NOT proven. The pending subject has no
`payment_v2.verified_chain_evidence` row, because it was executed before the
evidence-retention path existed (root cause below). Zero database rows changed
across the whole session. No evidence rows were created.

Scope and authorization: founder-authorized for this task only. The founder later
clarified that "no restart" meant no reset or recreate, and that starting the
existing stopped helper was permitted. Database `flexsoar_payment_v2_integration_test`
only. The accepted `flexsoar_payment_v2_test` was not connected to. No DDL, no `.sql`
file created, edited or executed (all SQL is inline in scratch shell heredocs), no
GRANT/REVOKE, no write as `supabase_admin` (every admin session was
`BEGIN TRANSACTION READ ONLY ... ROLLBACK`, and `transaction_read_only=on` is
recorded in each snapshot). No chain transaction, no validator start, no
container created, removed or reset. Pre-flight: HEAD `9627b2e`; `git log HEAD..main`
lists `f2ac97a`, `86c731d`, `afae327`, and per the founder we proceeded without a
rebase. `package.json`, `package-lock.json` and the debris files were not touched.
There is no `tests/payment-integration/evidence/` directory convention, so no
evidence files were committed. Scratch scripts and raw outputs are in the review ZIP.

### Pending fixture located

The failure is recorded at this file's 2026-10-16 section ("Pending evidence readback
did not pass ... `s.id` is ambiguous", lines ~3216-3231), at
`tests/payment-integration/README.md:406-416`, and at the harness capture point
`tests/payment-integration/evidence-db-readback.mjs:47-56`. The harness walks the
`actualConsumption` rows of `/state/integrated-JXopR6/results.json` newest-first and
selects the first one whose settler `ack_context` is `direct` with a receipt. We
confirmed this read-only as `payment_integration_settler`. Event `1392bc4e...`
(the newest candidate) is `refunded`, so it is skipped. Event
`b3949981-da83-424b-9a33-c179704817e6` is `direct` with a receipt, so it is selected:
sale `6e2a2198-a61e-4e85-983c-3cd5897cdb05`, attempt
`b9cb89ae-6e3e-4838-b247-37f4a2265972` (results.json row 23).

Preserved cases tracked:
- pruned ACK: case0 sale `bb4a634c-454b-4f0e-a918-93492838c9f8`, ACK `nYpb9Bg...`, block 156 cleaned up
- unresolved registration: case3 sale `b61b09f4-fc2e-4229-ae48-daa45060d380`
- expired escrow: operation `27bc0cae-1766-4295-b86c-6457289edd6b`, sale `878f34bc-fda7-4c11-af0b-27e82492a52b`

### Container verification (every session; first mismatch exits)

Database container, rechecked before each of the 10 database sessions:
```
Id=71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92
Running/Network/Privileged=true none false
PortBindings={}
Image=supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc
Mounts=/audit/hba.conf rw=false;/audit/migrations rw=false;/audit/tests/payment-db rw=false;
netdev=lo,   route_lines=1   netns=net:[4026532483]
IDENTITY flexsoar_payment_v2_integration_test 127.0.0.1 <expected login>
```
The database container was started at 2026-10-20T04:13:27Z, before this session.
`/audit/hba.conf` is `trust` for local and loopback, so no credential was needed or
used. Its netns changed from the attested `net:[4026532408]`.

Helper: found `Exited (255)`, `OOMKilled=false`, `FinishedAt=2026-10-17T02:06:26Z`,
`RestartPolicy=no`. Started with `docker start flexsoar-payment-integration-20261016T075407Z`
only after the database-only checks were recorded. It was verified before use, again
before each harness run, and again at the end:
```
Id=3a59f47bb849c66e81bae1ecb5112ce1131b58f07ec1de49d34f6a700b3a4998
Running/Privileged/NetworkMode/ReadonlyRootfs/User/RestartCount=true false container:71c4856a...cc92 true 1000:1000 0
StartedAt=2026-10-20T05:45:52.869308103Z  PortBindings={}  CapDrop=["ALL"]  SecurityOpt=["no-new-privileges"]
/state <- /home/family/flexsoar-payment-db-69c6161-20261016T022841Z/integration-discovery-20261016T074634Z/helper-state rw=true
/work/lib <- /mnt/c/Users/Family/flexsoar-payment-security/lib rw=false
/work/node_modules <- /mnt/c/Users/Family/flexsoar-payment-security/node_modules rw=false
/work/tests/payment-integration <- /mnt/c/Users/Family/flexsoar-payment-security/tests/payment-integration rw=false
/tools/{agave,node,program.so,runtime} rw=false (unchanged sources)
helper netdev=lo,  route_lines=1  netns db=net:[4026532483] helper=net:[4026532483]
```
`bash tests/payment-integration/attest-helper.sh flexsoar-payment-integration-20261016T075407Z`
exited 0 with: "Attested ... in net:[4026532483]. Evidence
/home/family/flexsoar-payment-db-69c6161-20261016T022841Z/integration-attestation-20261020T054620Z."
It rewrote only `/state/integration-host-attestation.json` (sha256
`48d114aea55c7b131d14e6abe63efb8cc094b95b6aeab1650ac7011d11b9c836`):
`{"containerId": "71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92", "network": "none", "database": "flexsoar_payment_v2_integration_test", "namespace": "net:[4026532483]"}`.
Both containers were left running.

Chain/state dependencies (part D): `/state/integrated-JXopR6/results.json` is present.
It is 29247 bytes, mtime 2026-10-16 21:52:15 +0800 (not modified since that run),
sha256 `dd45ee7f999d216d8d9143eb181fe0fed3a804a0cf761489f339f02e1f09e1ca`. The ledger
directory is present (496M; snapshots at slots 2626 and 2726). The helper ran only
`sleep infinity`; no validator was started. `evidence-db-readback.mjs` and its imported
`lib/solana/v2-{context,evidence,authority-observer,observer}.ts`/`protocol-v2.ts`
contain no RPC or network calls (we grepped for fetch, Connection, http, ws and RPC
constructors), so this harness reads no chain history. The known block-156 gap is
pre-existing and unchanged. Nothing was regenerated.

### Commands (executed from Windows via `wsl.exe -d Ubuntu -- bash -lc "bash <script>"`)

- Admin snapshot (read-only):
  `docker exec -i -e PGHOST=127.0.0.1 -e PGPORT=5432 -e PGDATABASE=flexsoar_payment_v2_integration_test -e PGUSER=supabase_admin -e PGPASSFILE=/dev/null <db> psql -X -q -At -F '|' -v ON_ERROR_STOP=1 -v expected_login=supabase_admin`.
  stdin is the identity guard, `BEGIN TRANSACTION READ ONLY`, a `\gexec`-generated
  per-table count with `md5(string_agg(pk))` and `md5(string_agg(row::text))` over all
  `payment_v2` and `public` tables, the per-case row md5s, and `ROLLBACK`.
- Worker checks: the same `docker exec` with `PGUSER=payment_integration_<role>`. Each check is its own
  session: `BEGIN TRANSACTION READ ONLY; SET LOCAL ROLE payment_v2_<role>; <call>; ROLLBACK;`
  (this mirrors the `lib/db/payment-postgres.ts` transport, but read-only and rolled back).
- Harness (x3):
  `docker exec flexsoar-payment-integration-20261016T075407Z /tools/runtime/ld-linux-x86-64.so.2 --library-path /tools/runtime /tools/node --loader /work/tests/payment-integration/ts-loader.mjs /work/tests/payment-integration/evidence-db-readback.mjs --read-existing-evidence-isolated-only`

### Step results

| Step | Result |
|---|---|
| 1 Preflight | PASS. HEAD 9627b2e, only founder-owned dirt, fixture located |
| 2 BEFORE snapshot | PASS. 58 tables plus 4 case blocks; sha256 of snapshot file `5cbfc0e6...6fde` |
| 3a verifier_context('attempt', b9cb89ae...) as payment_integration_verifier | PASS. exit 0 three times; identical md5 `ba7307ad36815f77669d6c905ffb4a26`; 32-key JSON (`kind`=attempt, `saleId` 6e2a2198..., `mode` 1, `revision` "1", `totalUnits` "1000000"); no 42702 |
| 3b harness run 1 | BLOCKED (expected outcome 2). exit 2, `DATABASE_EVIDENCE_READBACK_BLOCKED`, `verifierContextError:null`, receipt recovery PASS twice, lifecycle and payment_event evidence both NULL |
| 4 AFTER snapshot | PASS. byte-identical to BEFORE; zero changed rows (none expected, since the harness stopped before persist and lifecycle) |
| 5 idempotency (runs 2 and 3) | PASS. same BLOCKED output and exit 2 both times; snapshots after each are byte-identical; no new payment, transfer, ledger entry, consumption or outcome |
| 6 negatives | PASS. 11/11 permission cases fail closed with SQLSTATE-42501-class `permission denied`; unknown subject returns NULL with the snapshot unchanged (see table and note) |
| 7 preserved cases | PASS. case md5 blocks identical in BEFORE, after-run1/2/3 and final |
| 8 handoff | this section |

Changed rows, BEFORE vs after-partA, after-run1, after-run2, after-run3 and final:
**none.** All six snapshot files have sha256
`5cbfc0e6b3d4671805b8a0af0aec8bcc4c4963f7867993d37e5ce0de2f616fde`. The worker
RPCs the harness calls (`worker_identity`, `ack_context`, `verifier_context`,
`read_chain_evidence`) are SELECT-only. It never reached `store_chain_evidence` or
`record_lifecycle`.

### Negative checks (each its own session, READ ONLY, rolled back)

| # | Login / SET ROLE | Call | Result |
|---|---|---|---|
| 6.1 | verifier / payment_v2_verifier | `fn_payment_v2_ack_context` (settler-only) | `ERROR: permission denied for function fn_payment_v2_ack_context`, exit 3 |
| 6.2 | verifier / payment_v2_verifier | `fn_payment_v2_issuer_context` (issuer-only) | `permission denied for function fn_payment_v2_issuer_context` |
| 6.3 | verifier / payment_v2_verifier | `fn_payment_v2_admin_queue()` (staff/authenticated only) | `permission denied for function fn_payment_v2_admin_queue` |
| 6.4 | verifier | `SET ROLE payment_v2_settler` | `permission denied to set role "payment_v2_settler"` |
| 6.5 | verifier | `SET ROLE supabase_admin` | `permission denied to set role "supabase_admin"` |
| 6.6 | settler / payment_v2_settler | `fn_payment_v2_verifier_context` | `permission denied for function fn_payment_v2_verifier_context` |
| 6.7 | settler | `SET ROLE payment_v2_verifier` | `permission denied to set role "payment_v2_verifier"` |
| 6.8 | issuer / payment_v2_issuer | `fn_payment_v2_read_chain_evidence` | `permission denied for function fn_payment_v2_read_chain_evidence` |
| 6.9 | executor / payment_v2_executor | `fn_payment_v2_verifier_context` | `permission denied for function fn_payment_v2_verifier_context` |
| 6.10 | customer (authenticated) | `fn_payment_v2_verifier_context` | `permission denied for function fn_payment_v2_verifier_context` |
| 6.11 | verifier / payment_v2_verifier | `SELECT count(*) FROM payment_v2.sales` | `permission denied for schema payment_v2` |
| 6.12 | verifier / payment_v2_verifier | `verifier_context('attempt', 00000000-0000-4000-8000-000000000074)` | returns SQL NULL, exit 0 (not an error) |
| 6.13 | verifier / payment_v2_verifier | `verifier_context('bogus', ...)` | `ERROR: PAYMENT_V2_CONTEXT_KIND_UNSUPPORTED` |
| 6.14 | verifier / payment_v2_verifier | `read_chain_evidence('lifecycle', unknown, 'acknowledged')` | returns NULL |

Note on 6.12: at the database level an unknown subject is a NULL result, not an
error. It fails closed one layer up: `paymentVerifierContext` passes the value to
`object()` (`lib/db/payment-v2-workers.ts:10`), which throws `invalid payment context`
on null. A caller that bypasses the adapter would see NULL. This was recorded; it
was not changed.

No admin fallback, from the code: `lib/db/payment-postgres.ts:1` ("no Supabase/admin
fallback"). Line 41 refuses `postgres`, `supabase_admin`, `service_role`, `authenticator`,
`authenticated`, `anon`, `payment_v2_owner` and any `payment_v2_*` login. Line 43 builds
a closed environment with `PGPASSFILE=/dev/null` and no inherited credentials. Line 48
refuses any RPC not routed to this transport's role. Line 59 requires
`superuser:false` and the exact login. On any failure, line 65 returns
`PAYMENT_DB_OUTCOME_UNKNOWN` with no retry and no second client. `lib/db/payment-v2.ts:15-18`
`paymentRpc` throws on `result.error`. `lib/db/payment-v2-workers.ts:1` says "No
service-role fallback", and no function in it constructs another client.
`evidence-db-readback.mjs` creates only the three `payment_integration_*` transports
(line 23). Database side: `payment_v2.require_role` (`062`) requires exactly one
worker-role membership and rejects owner, service_role, authenticator, authenticated
and anon membership with SQLSTATE 42501.

### Why the pending evidence is absent (read-only root cause; nothing created)

It was never persisted. It is not stored somewhere the reader fails to look.
- The selected sale's rows were all written 2026-10-16 08:43:55-08:47:25 UTC:
  lifecycle `opened` `5RBpCneb...`, event `direct` `3k6XMNnS...`, consumption, and
  lifecycle `acknowledged` `3UEUDGD7...`. Every one has `proof->>'evidenceId'` absent.
- Database-wide: 11/16 lifecycle rows and 9/12 event rows have no evidenceId. The
  latest of those was written at 08:51:52 UTC. The earliest row that has an
  evidenceId is from 13:20:40 UTC. All 11 `verified_chain_evidence` rows were verified
  between 13:20:40 and 13:48:59 UTC by `payment_integration_verifier`. They belong
  only to sales `201ca142...`, `096c26f6...` and `7153da6c...`.
- The persistence path is `retainAuthorityEvidence` in
  `tests/payment-integration/integrated.mjs:64-80`, which calls
  `persistVerifiedPaymentEvidence` at line 79 and then `fn_payment_v2_store_chain_evidence`.
  The ACK uses it at `integrated.mjs:348-349`. Together with migration 068 (store/read
  RPCs and the `evidence_before_*` insert triggers, `068:178-205`), it was introduced
  in `dd5027c` (2026-10-16 22:03 +0800). The previous harness revision `599bf0e` has 0
  references to `persistVerifiedPaymentEvidence`. The triggers apply only to new
  inserts, so the earlier rows are legitimately evidence-free.
- No `verified_chain_evidence` row shares a signature with any of the selected sale's
  events or lifecycle rows (count 0). The only other copy of the ACK transaction is
  the harness journal `/state/integrated-JXopR6/transaction-3UEUDGD7...json`, written
  at `integrated.mjs:101`. Per README:101-102 that file is NOT a production durable
  store, and the reader correctly does not consult it.
- Also: all 11 existing evidence rows have `parsed_rpc_result ? 'compiledRpcResult'`
  = false. The harness requires `compiledRpcResult` (`evidence-db-readback.mjs:61`), and
  the stronger validator was described earlier in this file ("Old pending evidence
  without those fields cannot pass the stronger validator"). So pointing the harness
  at a sale that has evidence would still not pass without new, compliant evidence.
  That needs a fresh scenario captured under the current code, which is out of scope
  and was not done.

### Preserved cases (BEFORE = every later snapshot)

`case|` rows give `count:md5` for sales, attempts, events, consumptions, escrows, operations,
signed_operations, lifecycle_evidence, verified evidence, claim_history and outbox. The
`state|` rows are human-readable. The expired escrow is still `funded`, operation
`27bc0cae` is `execute_outcome:unknown:REVIEW_REQUIRED...`, and the claim is unchanged.
The case3 sale is still `opening` with its `open_sale` operation `leased`. The pruned-ACK
sale case0 is still `direct`, its `acknowledged` lifecycle has no evidence row, and it
was not reverified. None was repaired.

Full BEFORE snapshot (identical bytes in after-partA, after-run1, after-run2, after-run3, final):
```
IDENTITY flexsoar_payment_v2_integration_test 127.0.0.1 supabase_admin
txn_read_only|on
table|payment_v2.attempts|19|f9d86519867a6ed4391af49525f33f6e|e74828d74b964b7486bac6318058b165
table|payment_v2.attestations|9|e5fa64b05a7ac3814427e5f4a32ed5c2|5eb76e3e39a8ea106297df696f6b4d06
table|payment_v2.candidates|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|payment_v2.claim_history|10|6d5c5b815ac7ecf3d80bdeed513bea2d|0dc9601c14df2abd84f11256f4489b1e
table|payment_v2.configuration_history|33|ee52592d826d829972d88216d0141e07|7fbf003c6ecbeeadee18e26792a84552
table|payment_v2.consumptions|12|e17af5ae7c25b2fcb71cc97f0fa138a8|008242ab4d80a4b1295cb511c317be1b
table|payment_v2.cursors|1|7b8fac8e1b450ba8d9667433ff29debc|777f02adfe1ef8a1b4fb8301e12a049b
table|payment_v2.decisions|9|e5fa64b05a7ac3814427e5f4a32ed5c2|7c9989216d2471eb6c5fde8a43b5c2d4
table|payment_v2.dispatch_reviews|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|payment_v2.escrows|5|96258ccef097bd7fe651746527e6a591|5de00f16bce29e6f674065da6d012aec
table|payment_v2.events|12|e17af5ae7c25b2fcb71cc97f0fa138a8|c5cca6b0e67f995aeb7e4b20ca0f41ce
table|payment_v2.governance_approvals|6|6aab9492cc7237bba7bca7661565c8f9|ac8560ac1de9907e1287f12f68d64caf
table|payment_v2.inventory|10|c14a913088c5d371e2ff4b6afe048641|e6d49d8eb6f57c352f7f5722dc544328
table|payment_v2.lifecycle_evidence|16|1b73a51126b98358e6ec81bb36a684ce|9d85e9250b049f25a5cb06006435bc73
table|payment_v2.networks|2|5eed2e79b21d76953740521ed103677d|6ba5a86b44ee257f84779335968e0524
table|payment_v2.operation_failures|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|payment_v2.operations|31|ce9c51eea3c06e19d9756dfe0aeb424c|23e5e9b9883c2223d0306cde20939050
table|payment_v2.outbox|24|736bb50aad3f07e1b8ffbf96aa054c1b|1e29cdd1dd08fdb117d6f173d32b6cd9
table|payment_v2.policies|1|3591c4b307bd9fc5a5acb0b10d3e41e2|fb040419737b1faaec6d8a8af8d3dd15
table|payment_v2.quote_books|10|b07f4698bc77f3b74e91154910d818e4|004ac7fd5af5962362433c109a80a476
table|payment_v2.sales|10|efb21475e9dbc3b474b86b8decfc7c7f|87cd16949d47c1b5341a6bee3ed579a1
table|payment_v2.signed_operations|5|0a977957b8c259ab04ec5237043ae251|95ba8bf5f046cbdab1d270e7d7e1e3e3
table|payment_v2.staff|20|f6ee76ab8e422802eb16e52afaf21468|83cb8254baeb1cc164f5244ccbbce45a
table|payment_v2.unresolved|1|c4ca4238a0b923820dcc509a6f75849b|233e2331e01075e68b9914ea7ae4f8be
table|payment_v2.usdc_journal|29|30ae902fe5f13e8775cb9d2c0b0207df|d980dcb29884753e64c80f124441d1df
table|payment_v2.verified_chain_evidence|11|62a2668ed6e03415cc1faf13ebb05649|c81866845eb784db5df8cee542c1c9c0
table|payment_v2.wallet_accounts|11|68aaf41030c6c2998b68ad830c130d6b|038c249c3ef6173bf7e5893d8d1bffc4
table|public.card_provenance|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.cards|10|c14a913088c5d371e2ff4b6afe048641|046ee9a129d72a73d3c18e6465399649
table|public.cash_payout_countries|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.condition_bands|5|c45995428cba999d4b7e97f07c507d4a|e56cf23a7cf193561b4d408b966e8c33
table|public.consignment_events|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.consignments|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.credit_holds|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.items|10|5be5992a193272a4791588643443d355|d280351c17166a09f48195e0ab518653
table|public.ledger_entries|30|f29c6023e808b041b06c5ba374f40052|502b65a1c49af14410f4db2b195282f6
table|public.level_snapshots|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.levels|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.listings|10|34dd3eeefe136689260eadaddc7a2c52|f09cac95d54aebc8933ae7dc315a37d9
table|public.market_refs|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.notifications|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.orders|8|3b267607d736f50290cde0e4f669ef2e|ccb4489fe8617bc04e53a26b9c63db31
table|public.platform_config|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.redemptions|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.referrals|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.sku_float_curve|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.sku_models|10|3957f0bbc3cdd6cc8095be9ba939e6f3|4eec71fe2906303b0565300d89103a59
table|public.sku_requests|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.skus|10|271e84ddee56ac727554623a5161233e|65357809c627c738ec13f45d401abde7
table|public.subscriptions|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.sweeps|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.tier_bands|5|afe805e5a3c3ec7fa05645a6a2a6e607|a9db442bba3fbc32889389a94f072676
table|public.trade_offers|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.users|31|2412224e1a0c72613dc547fed2c8cf73|99a68a011d7e7ad71a9cdc62090dccd5
table|public.vault_intakes|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.watchlists|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
table|public.xp_events|0|d41d8cd98f00b204e9800998ecf8427e|d41d8cd98f00b204e9800998ecf8427e
case|expired_escrow_op27bc0cae|sale_id=878f34bc-fda7-4c11-af0b-27e82492a52b|1:05c14f04992c94a64fc90973f2676333|2:3f07dfe0372b2538c3f290084211014a|1:74000fd718fb484e678e4bf3b4b26075|1:1f1079283c022a80bcda412d6b466e29|1:661ec2cc3f990e49f44f23c1a17cbf7d|3:f2a26c366543804e26a283d557a873ec|1:f1774b09f9ddd8e55df50aece78cb401|1:dcea93c2fa9f348e0c093645165324bc|0:d41d8cd98f00b204e9800998ecf8427e|1:1aaa5d0fe50821507e441b4d26bcb097|2:55c8753e2f257704cff974bcfd9b8794
case|pending_harness|sale_id=6e2a2198-a61e-4e85-983c-3cd5897cdb05|1:8855eae12721320073fbdb79971aaebb|2:2248a0b4161d77a54ede6264282fecc6|1:e3d1f78bfc5f165d4ce2bc3897bb4755|1:a72e9df70a08601fe131e48a9ee2781d|0:d41d8cd98f00b204e9800998ecf8427e|2:7b70833cada2264539a5152b0a54132a|0:d41d8cd98f00b204e9800998ecf8427e|2:6c92a24a593e81662577ca96f57b269c|0:d41d8cd98f00b204e9800998ecf8427e|1:dd986821e69ffdbf4b4d57ee24e2bf79|2:c6923fd2cdf0d69b047c9a353acbdc88
case|pruned_ack_case0|sale_id=bb4a634c-454b-4f0e-a918-93492838c9f8|1:1631bb74251a1775acb70316f0de2804|2:890c0c4c515bc46e1e92035dde14289e|1:e4e1a1a8ad302a13fa89b1a5e385f74f|1:a6851af3c487614365ae7643ecb84a0a|0:d41d8cd98f00b204e9800998ecf8427e|2:1882d05d160d1234eca3976c0184ae07|0:d41d8cd98f00b204e9800998ecf8427e|2:1a0546f6d3093dbd04fbf86eb0835cd8|0:d41d8cd98f00b204e9800998ecf8427e|1:fae7f6358076335ca5ad3725e3ae7d4c|2:ad30012571c3d5239b82a70e63480197
case|unresolved_registration_case3|sale_id=b61b09f4-fc2e-4229-ae48-daa45060d380|1:c6fec2e6c8734d53f7d4ed5a0867b81f|0:d41d8cd98f00b204e9800998ecf8427e|0:d41d8cd98f00b204e9800998ecf8427e|0:d41d8cd98f00b204e9800998ecf8427e|0:d41d8cd98f00b204e9800998ecf8427e|1:839bdd83651e9ba6aeb76d345fb5ee4f|0:d41d8cd98f00b204e9800998ecf8427e|0:d41d8cd98f00b204e9800998ecf8427e|0:d41d8cd98f00b204e9800998ecf8427e|0:d41d8cd98f00b204e9800998ecf8427e|0:d41d8cd98f00b204e9800998ecf8427e
state|expired_escrow_op27bc0cae|funded|0|1|1|f|funded:2ef70930-5d07-470b-b9e1-1b58fa9fb865:att=b4d16a85-b55d-4786-ad23-a78bf878a68a|funded:rev1|adc88e0d-bda2-49f8-8902-3b7c4db0fb1d:open_sale:observed:-;cfbe0398-6d69-4c35-a533-c4f5c36959cf:refund:observed:-;27bc0cae-1766-4295-b86c-6457289edd6b:execute_outcome:unknown:REVIEW_REQUIRED: expired or invalid original transaction: no|opened:2N52tPinjycz:ev=none|b4d16a85-b55d-4786-ad23-a78bf878a68a:funded;5b1502b7-d7b8-48e5-b5c4-985790bb871e:authorized
state|pending_harness|direct|1|1|1|t|direct:b3949981-da83-424b-9a33-c179704817e6:att=b9cb89ae-6e3e-4838-b247-37f4a2265972||3f6d3dd8-5804-49bb-82a3-db6ccd32aa8b:open_sale:observed:-;c12fd363-952a-490c-a0e4-a3b53d6b91af:acknowledge_claim:observed:-|opened:5RBpCnebHLMa:ev=none;acknowledged:3UEUDGD7bxVW:ev=none|b9cb89ae-6e3e-4838-b247-37f4a2265972:direct;159febeb-1e06-4e47-8507-caff762b64df:authorized
state|pruned_ack_case0|direct|1|1|1|t|direct:124e9120-6448-4f66-b835-b2a96c5c2cf3:att=08319238-02c0-4683-a165-3a2416161270||b82b7d1c-42b8-4723-91e0-7ae000d71f25:open_sale:observed:-;32954778-1a48-42f5-8f43-287abe5eaf38:acknowledge_claim:observed:-|opened:3eB7VQvSbnYf:ev=none;acknowledged:nYpb9BgDzVxN:ev=none|08319238-02c0-4683-a165-3a2416161270:direct;36a9ceba-a548-4c7a-a9d4-b098f0806a68:authorized
state|unresolved_registration_case3|opening|1|1|1|f|||276f50d6-797f-4062-8a96-3ea85d5ade61:open_sale:leased:-||
evidence_by_kind|attestation|authentication_pass|1
evidence_by_kind|attestation|receipt|1
evidence_by_kind|attestation|release|1
evidence_by_kind|lifecycle|acknowledged|2
evidence_by_kind|lifecycle|opened|3
evidence_by_kind|payment_event|direct|1
evidence_by_kind|payment_event|funded|1
evidence_by_kind|payment_event|released|1
unresolved|1|AXxVGqvow56TSnzTi4Lb1haWtEaUoBN2ezpSfMNqQAXx|INJECTED actual database commit response lost
verifier_context_fn|3e39cf76a408b38d7b665116ded63101|7299|payment_v2_owner|{payment_v2_owner=X/payment_v2_owner,postgres=X/payment_v2_owner,payment_v2_verifier=X/payment_v2_owner}|t|{search_path=pg_catalog}
```

### Results by category

- **Real chain/DB integration:** the dedicated verifier login reads verifier context
  through the real Postgres role and grant path after 074 (x3 identical). Receipt-only
  recovery of a committed direct ACK through distinct settler and verifier logins
  (x6 across 3 runs, identical). No chain was contacted in this session; the chain
  facts relied on come from the 2026-10-16 runs.
- **Offline/mocked:** none run this session. No vitest, tsc, npm or build; under the
  task constraints, no application code changed.
- **Simulated outages:** none this session. The earlier simulated-primary-outage archive
  evidence (results.json rows 79-86) was not re-exercised.
- **Intentional fail-closed:** 11 permission-denied negatives (6.1-6.11). The
  unsupported kind (6.13). Unknown subject: NULL at the DB, which the adapter turns into
  an exception (6.12). The harness refused to proceed without retained evidence (exit 2,
  three times) and wrote nothing.
- **Blocked/unimplemented:** pending-ACK recovery from retained evidence. There is no
  compliant evidence for any committed-ACK subject, so this needs a new scenario
  captured under the current evidence code. The pruned ACK (case0) is not
  independently reverifiable. The expired escrow (op 27bc0cae, `unknown`/REVIEW_REQUIRED)
  and the unresolved registration (case3, `opening`) are unchanged. There is also no
  archival observer or production retention.

Limits and unverifiable items:
- The harness does not print the selected sale. The selection was reconstructed from
  its code plus a read-only settler `ack_context` replay.
- The run-2 and run-3 console logs were partly overwritten by interleaved stdout and
  stderr from `wsl.exe`. Their result line and `harness_exit=2` survived. The
  verification header lines of those two runs did not survive, but the script aborts
  before the harness when the DB checks fail, and the helper was re-verified clean
  afterwards (05:49:15Z).
- The time 068 was applied is inferred from row timestamps and git history. There is
  no migration ledger in this database.

## 2026-10-20 - Milestone 4 phase 1: PLAN ONLY for a fresh retained-evidence ACK recovery scenario

Status: plan only. Nothing was executed that writes to a database, touches a chain or
validator, or starts or creates a container. This session ran only file/git reads,
`docker inspect`/`docker exec cat` of `/proc` and the TCP table, and one
`BEGIN TRANSACTION READ ONLY ... ROLLBACK` session as `supabase_admin` after the
milestone-3 container checks (all passed at 05:56:41Z). HEAD at start was `33f182b`.
The tree is still behind main, as already authorized. The founder-owned package files
and debris were not touched.

**Headline: the current harness cannot produce this scenario without a founder
decision.** (a) No existing `integrated.mjs` mode creates a new sale. The normal loop
indices `[0,1,2,4,5,6]` and the context indices `[11,12]` all have `scenario-*-complete`
markers in `/state/integrated-JXopR6`, so they are skipped (`integrated.mjs:154-155`). A
fresh `--run-isolated-integration` cannot run either: it creates a new ledger and
genesis and then runs `01_signable_fixtures.sql`, which refuses whenever any sale,
attempt, order, card or operation exists (`01_signable_fixtures.sql:10-13`). (b) No
existing injection point falls between "ACK evidence persisted" and "ACK lifecycle
committed". The only ACK crash, index 4, fires before evidence retention
(`integrated.mjs:342-347`, ahead of `retainAuthorityEvidence` at `:348`). A test-only
harness change is therefore required (section 7, D1).

### 1. Environment

- The validator is the owned `solana-test-validator` (Agave 2.1.0, `/tools/agave`). It is
  spawned by `integrated.mjs` as a child process inside the existing helper
  `flexsoar-payment-integration-20261016T075407Z` (Id `3a59f47b...`, NetworkMode
  `container:71c4856a...`, so it shares the DB container's loopback-only netns). Exact
  argv, from `integrated.mjs:87`:
  `/tools/runtime/ld-linux-x86-64.so.2 --library-path /tools/runtime /tools/agave/solana-test-validator --config <run>/validator-config.json --url http://127.0.0.1:18899 --mint <bootstrap pubkey> --bind-address 127.0.0.1 --rpc-port 18899 --faucet-port 18901 --gossip-port 18902 --dynamic-port-range 19000-19020 --ledger <run>/ledger --limit-ledger-size 1000000 --upgradeable-program CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF /tools/program.so <bootstrap pubkey>`.
  Its environment sets `RAYON_NUM_THREADS=2`. Config: `integrated.mjs:82`
  (`ws://127.0.0.1:18900`, commitment finalized). RPC is `http://127.0.0.1:18899`
  (`:57`). Readiness is a `getHealth` poll (`:113`). The validator is SIGTERMed in
  `finally` (`:415`).
- Pre-flight inside the harness:
  - attestation, netns, `lo`-only and route checks (`:29-33`);
  - program sha256 `99aa6bec...743c` (`:34`);
  - at least 5 GiB free under `/state` (`:35`);
  - ports 18899-18901 free (`:36`).

  Today none of those ports is listening; the only helper listener is
  `127.0.0.1:5432`. Host free space is 949G.
- Ledger: `<run>/ledger`. To reuse the existing chain, the run is
  `/state/integrated-JXopR6`, which is
  `/home/family/flexsoar-payment-db-69c6161-20261016T022841Z/integration-discovery-20261016T074634Z/helper-state/integrated-JXopR6/ledger`
  on the host (496M, snapshots at slots 2626 and 2726). Resume asserts the same genesis
  `FAiPDLaech8zexAiuEiKUWzapfJbegZyfrkBgDLYunyF` (`:129`, "never replace an existing
  integration chain"), and that is the network `dba29220-5ac4-4d7e-ad78-00c84eaf815e`
  with `funding_enabled=t` in the DB.
- **No new container is needed.** The validator runs inside the existing helper's
  namespace. **No new ledger is needed or possible.** A new ledger implies a new genesis,
  hence a new `payment_v2.networks` row through `01`, and `01` refuses on this
  populated DB. Starting the validator on the existing JXopR6 ledger *does* write to
  that ledger: it produces new slots, and the new scenario's transactions are added to
  it. That is a separate founder authorization (D3).

### 2. Keys and funds (all synthetic, local-only)

- All keys are `Keypair.generate()` at first setup (`integrated.mjs:44-50`): bootstrap,
  mint, treasury, seller, buyer0/1, issuer, inventory, receiver, authenticator,
  reviewer, release, reconciler, guardian and governor0-2. They are stored mode 0600 in
  `<run>/EPHEMERAL-LOCAL-ONLY-keys.json` and reloaded only on resume. We did not open
  that file, per README:28-29.
- New buyers follow the existing pattern (`:156-167`): fresh
  `{id: randomUUID(), secret: Keypair.generate()}` written to a new
  `EPHEMERAL-LOCAL-ONLY-*.json` with flag `wx`, then added to the DB through
  `04_additional_buyers.sql`.
- SOL comes from the bootstrap key, the `--mint` genesis account of the owned validator,
  and from `requestAirdrop` on its own faucet (`:115`).
- "USDC" is a synthetic SPL mint created by bootstrap with 6 decimals and bootstrap as
  mint authority (`:116`, InitializeMint2 `[20,6]`). JXopR6 mint is
  `DDQuaMSaezFVerEMXRhHCq2xfWKm6URggbcEDxkS7qmF`. Buyers are minted 10,000,000 base
  units, i.e. 10 test USDC (`:118`; same amount for added buyers).
- The program is a local build pinned by hash. Genesis exists only on this ledger. None
  of these is a real or operational key, mint or wallet. The chain is
  unreachable from outside the namespace (no routes, `lo` only).

### 3. Fixtures (existing scripts only; no new `.sql` needed)

The harness runs every fixture through its isolated `sql()` helper as `supabase_admin`
over loopback (`integrated.mjs:59`). These are fixture-administrator writes, not worker
paths, and they need explicit founder authorization (D2) because milestone 3
forbade admin writes.
- `02_inventory_fixture.sql`, called at `:191`: inserts one each of
  `public.sku_models`, `skus`, `items`, `cards` (owner=seller), `ledger_entries`
  (mint), `listings` (public, 2000 sen) and `payment_v2.inventory`. Guarded to the
  integration DB, loopback and `supabase_admin`.
- `04_additional_buyers.sql`, called as at `:160`/`:173`/`:181`: inserts two each of
  `public.users` and `payment_v2.wallet_accounts`. It is additive and changes no
  existing binding.
- `01_signable_fixtures.sql`: not used. It refuses on this DB, and it would
  deactivate staff and networks.
- `03_outcome_assertions.sql`: a read-only audit (`BEGIN READ ONLY ... ROLLBACK`) run at
  the end of the mode (`:383`). It checks the exact order, MYR and USDC snapshots,
  journal, consumption, outbox and ownership. It writes nothing.

Every other row is created by worker RPCs under dedicated logins (section 4). **No new
`.sql` fixture is proposed.**

### 4. Scenario script

There are two new mode-1 (direct, vaulted) scenarios in the same run directory, indices
13 (normal) and 14 (crash). Mode 1 is deliberate: it never calls
`claimPaymentOperations` (that happens only for escrow outcomes, `:274`), so the
preserved leased and unknown operations `27bc0cae...` and `276f50d6...` are never
leased or touched. Logins and signers per step:

a. Normal direct sale (index 13). The flow is the existing loop body `:187-353`:
  1. Fixture: `02` as `supabase_admin` (`:191`); buyers via `04` as `supabase_admin`.
  2. `register_card` on chain, signed by the inventory and authenticator test keys
     (`:201`). The bootstrap key pays all fees.
  3. Address lookup table (`:203`); bootstrap only.
  4. Quote and sale: `preparePaymentSale` via **payment_integration_issuer**
     (`fn_payment_v2_prepare_sale`, `:196`; terms `totalUnits:'1000000'`, `:195`).
  5. Open: `paymentIssuerContext` (issuer), then `open_sale` signed by the issuer key,
     finalized (`:206-208`).
  6. Opening evidence: `retainAuthorityEvidence` with `LocalFinalizedRpcSource`, then
     `persistVerifiedPaymentEvidence` via **payment_integration_verifier**
     (`fn_payment_v2_store_chain_evidence`, `:66-80`). Then
     `recordPaymentLifecycle(opened)` via the verifier, with evidenceId (`:210`).
  7. Attempts: `initiatePaymentAttempt` for both buyers via
     **payment_integration_customer** (`SET LOCAL ROLE authenticated` plus
     `request.jwt.claim.sub`, `:62`). Then `authorizePaymentAttempt` via the issuer
     (`:212-213`).
  8. Chain payment: two buyers race `buy_v2`, signed by buyer and issuer, finalized
     (`:221-226`). Exactly one finalizes; the loser fails on chain and its principal
     debit is 0.
  9. Verification, evidence and settlement: `reconcilePayments(verifier, observer, 20,
     settler)` (`:228-231`). The verifier calls `begin_scan`, `attempt_context`,
     `store_chain_evidence` for subject `payment_event`/`direct`
     (`lib/db/payment-reconciliation.ts:47`) and `record_verified_event` with evidenceId
     (`:50-52`). **payment_integration_settler** calls `reconcile_event`.
  10. Assertions:
      - order count is 1 (`:235`);
      - the journal nets to 0 (`:236`);
      - the card owner is the winning buyer (`:237`);
      - a second reconcile processes 0 (`:238`);
      - **seller +950000 and treasury +50000 base units** (`:240`).
  11. ACK: the settler calls `reconcile_event` and `ack_context` (`:330-332`). The
      reconciler test key signs `acknowledge_claim`, finalized (`:339`). The chain flag
      alone does not unlock the DB (`:341`).
  12. ACK evidence: `retainAuthorityEvidence(lifecycle/acknowledged)` via the verifier
      (`:348`), then `recordPaymentLifecycle(acknowledged)` with evidenceId via the
      verifier (`:349`). The claim becomes `available` and the receipt is returned
      (`:350-352`).
  - **95/5 rule.** The fee is `pg_catalog.div(total_units*500, 10000)` and
    net = total - fee. This is enforced in the DB constraint and initiation
    (`066_payment_v2_exact_usdc_fee.sql:22`, `:52`) and the permit codec
    (`lib/solana/protocol-v2.ts:39`). It is integer division, which is floor for
    positive values. For 1,000,000 that gives fee 50,000 and net 950,000.
    `03_outcome_assertions.sql` re-checks `total/fee/net = 1000000/50000/950000` and MYR
    `2000/100/1900`. Limitation: totalUnits is hard-coded, so the remainder or rounding
    branch is not exercised by this amount.

b. Crash after evidence, before the ACK lifecycle commit (index 14). It is identical
   through step 12's `retainAuthorityEvidence`; the ACK evidence row is committed. Then
   the **proposed injection** fires (no app code is changed). In the new mode, the
   harness wraps the verifier transport, following the existing `lostSettler`
   (`:227`) and `lostResponse` (`:285`) patterns. When it sees
   `fn_payment_v2_record_lifecycle` with `p_proof.kind==='acknowledged'` for index 14,
   it writes marker `crash-after-ack-evidence-14`, **does not forward the call**, and
   throws `INJECTED process stop after retained ACK evidence, before lifecycle commit`.
   The process exits 1 and the validator is SIGTERMed by `finally`. Because nothing was
   sent, nothing is committed. Recovery is then a separate step that does not start the
   validator, so any chain lookup would fail (port 18899 closed). It calls
   `recoverCommittedClaimAcknowledgement(settler, verifier, eventId)`
   (`lib/db/payment-v2-workers.ts:40-64`):
   1. the settler's `ack_context` returns receipt NULL;
   2. the verifier's `read_chain_evidence(lifecycle, sale, acknowledged)` returns the
      row;
   3. `validateRetainedFinalizedEvidence` runs offline, including `compiledRpcResult`;
   4. the verifier's `recordPaymentLifecycle` records it with evidenceId.

   Expected result: `{kind:'reconciled', claim:'available'}`. This is the logic of the
   existing context block `integrated.mjs:132-153`, which has never actually reached
   its `reconciled` branch (results row 88 is a receipt). Rejected alternatives:
   - killing the node process: the window between two RPCs is milliseconds, so the
     timing is non-deterministic;
   - row locks or `LOCK` from an admin session: that is a write-lock as admin;
   - a dropped response after `record_lifecycle` commits: that tests the receipt path,
     not evidence recovery. It can be added as optional case 14b.

c. Idempotency. Run the same recovery twice more. Both must return
   `{kind:'receipt'}` with the identical receipt; the second and third results must be
   `deepEqual`. The snapshot after recovery 2 and after recovery 3 must be
   byte-identical to the snapshot after recovery 1. Also re-assert:
   - one order;
   - one consumption and one direct event;
   - one `lifecycle_evidence(acknowledged)`;
   - card owner unchanged;
   - `usdc_journal` sum 0 with 3 rows;
   - buyer, seller and treasury balances unchanged since step 8;
   - no new signature in `<run>/transaction-*.json`.

d. Negatives:
  - Offline, existing, not run here: `tests/payment-context-evidence.test.ts`.
    - `:104-117`: wrong `networkId` gives "integrity mismatch" (`:112`); wrong genesis
      gives "genesis mismatch" (`:113`); a corrupt or failed execution is rejected.
    - `:188-243`: parsed and wire tampering, missing or changed lookup proof, altered
      instruction fields.
    - `:289`: never-verified ACK history stays blocked.

    Run with `npx --no-install vitest run tests/payment-context-evidence.test.ts`; the
    last count was 66/66 across 2 files with `payment-v2.test.ts`. Needs authorization
    (D4).
  - DB, existing: `evidence-db-readback.mjs:73-78` covers a tampered instruction, which
    is rejected before any lifecycle RPC, and a conflicting persist, which
    `store_chain_evidence` rejects with `PAYMENT_V2_VERIFIED_EVIDENCE_CONFLICT`
    (`069:63`), leaving the row unchanged. After a new scenario this harness selects
    the newest direct receipt (index 14 or 13). **Predicted defect:** when it reads the
    lifecycle subject (`:50`), the readback comparisons at `:70` and `:77` query
    `payment_event/direct` for `ack.attemptId` instead of the lifecycle subject, so the
    "unchanged" assertion at `:71` should fail on a different evidence id. A one-line
    test fix is needed: use `subjectKind/subjectId/subjectAction`. Founder decision
    D1b. Not edited.
  - DB, proposed, read-only and rolled back, as the verifier: call
    `fn_payment_v2_store_chain_evidence` with the stored index-13 envelope modified
    three ways:
    - `networkId` set to `d6fa9d50-d2ad-4a88-b657-0713c94d333c` (the inactive
      network), expecting `PAYMENT_V2_VERIFIED_NETWORK_MISMATCH` (`069:42`);
    - `parsedRpcResult` removed, expecting `PAYMENT_V2_VERIFIED_EVIDENCE_SHAPE`
      (`069:36`);
    - one byte of `transactionBase64` flipped, expecting `..._TRANSACTION_IDENTITY` or
      `..._RESULT_MISMATCH`.

    All three raise before the INSERT. Each runs inside
    `BEGIN TRANSACTION READ ONLY ... ROLLBACK`, so even an unexpected pass cannot
    write. Snapshot unchanged.
  - The permission negatives from milestone 3 (6.1-6.14) are repeated unchanged.

### 5. Expected database changes and snapshot method

Snapshots use milestone 3's `snapshot.sh` unchanged, plus the new sale IDs for 13 and
14 added to its case list. It is read-only as `supabase_admin` with
`transaction_read_only=on`: per table, count plus `md5(pk)` plus `md5(row::text)` over
all `payment_v2` and `public` tables, and per-case row md5s. Snapshots are taken at
BEFORE, after the fixtures, after index 13, after the crash, after recovery 1, 2 and 3,
and after the negatives. Every row change must be attributable to the new sale IDs, the
new buyer IDs or the global tables listed below. Anything else is a FAIL.

Expected per sale, modelled on milestone 3's committed direct sale `6e2a2198`, whose
case footprint is sales 1, attempts 2, events 1, consumptions 1, escrows 0,
operations 2, lifecycle 2, claim_history 1, outbox 2:
- fixtures: +1 each of `sku_models`, `skus`, `items`, `cards`, `listings`,
  `ledger_entries`(mint) and `payment_v2.inventory`. Buyers: +2 `users`,
  +2 `wallet_accounts`.
- prepare/open: +1 `payment_v2.sales` (state opening, then opened);
  +1 `quote_books`; +1 `verified_chain_evidence`(lifecycle/opened);
  +1 `lifecycle_evidence`(opened, evidenceId set); +1 `operations`(open_sale, observed).
- attempts: +2 `attempts` (winner becomes `direct`, loser stays `authorized`).
- payment and settlement: +1 `verified_chain_evidence`(payment_event/direct); +1 `events`(direct,
  evidenceId set); +1 `consumptions`; +1 `public.orders`; +3 `usdc_journal` (sum 0);
  +1 `claim_history`; +2 `outbox`; card `owner_id` set to the buyer; claim ledger
  `ledger_entries`; `listings` status change; `sales.state=direct`; updated
  `payment_v2.cursors` lease and `after_address` (global scan cursor, 1 row).
- ACK: +1 `verified_chain_evidence`(lifecycle/acknowledged); +1 `operations`(acknowledge_claim);
  +1 `lifecycle_evidence`(acknowledged), with `sales.chain_acknowledged=t`. For index 14
  the `lifecycle_evidence` row appears only after recovery 1.
- Recoveries 2 and 3: zero changes.
- The exact table/row set for "card owner", the ledger and the outbox is taken from the
  DB functions during execution and reported row by row. The list above is a
  prediction, not a substitute.

### 6. Stop conditions and preserved state

Stop immediately and report, never retrying or repairing, on any of these:
- any container check mismatch;
- harness attestation, netns or program-hash failure;
- genesis differs from `FAiPDLae...`;
- port busy;
- under 5 GiB free;
- a validator that fails readiness;
- any `uncertain chain outcome` (`:96`);
- an unexpected exit from an injected stop;
- `processed` not in {0,1};
- any 95/5 balance mismatch;
- any snapshot change outside section 5;
- any change to a preserved-case md5;
- any `PAYMENT_DB_OUTCOME_UNKNOWN`;
- recovery returning anything other than `reconciled` the first time and `receipt` afterwards;
- any request for a credential.

Never use `--run-isolated-integration`, `--observe-isolated-integration` (it exits 1 at
the pruned ACK by design) or `--record-expiry-review-isolated-integration`.

Preserved untouched:
- `flexsoar_payment_v2_test`: not connected to.
- The three historical blocked cases, verified by md5 at every snapshot:
  - pruned ACK, case 0, sale `bb4a634c...`;
  - unresolved registration, case 3, sale `b61b09f4...` (`opening`, leased `open_sale`);
  - expired escrow, op `27bc0cae...`, sale `878f34bc...` (`funded`, `unknown`/REVIEW_REQUIRED).
- The milestone-3 pending sale `6e2a2198...`.
- All existing rows other than the global cursor.
- The state directory `/state/integrated-JXopR6` (existing files are only appended to:
  new `scenario-13/14*.json` and markers, plus `results.json` rows); no file is deleted.

### 7. Missing / decisions required (not worked around)

- **D1 test-harness change (lane extension for `tests/payment-integration/**`).** This is
  a new explicit mode, e.g. `--retained-ack-recovery-isolated-integration /state/integrated-JXopR6`.
  It would:
  - run indices `[[13,1],[14,1]]` with contextOnly-style gating, so the
    `[1,2]` terminal audit (`:358`) and the archival recheck loop (`:385-400`), which
    exits 1 at the pruned case 0, are skipped;
  - create two fresh buyers via `04` as at `:156-167`;
  - wrap the verifier transport with the index-14 injection described in 4b;
  - add a recovery-only entry point that does not spawn the validator. Either it is the
    same file with an early branch before `:87`, or a new
    `tests/payment-integration/retained-ack-recover.mjs` that imports only the
    transports and `recoverCommittedClaimAcknowledgement`. **Recommended: the
    separate script**, so "no chain lookup" is structural.

  No `lib/**` or app code changes.
- **D1b** fix the `evidence-db-readback.mjs:70,77` subject mismatch (predicted to
  fail), or accept that this harness's DB negative will fail for lifecycle subjects.
- **D2** authorize fixture writes as `supabase_admin` through the existing `02`/`04`
  scripts, run only by the harness `sql()` helper.
- **D3** authorize starting the owned validator on the existing JXopR6 ledger and new
  local chain transactions: register, ALT, open, two buys, ACK, for each of 2 sales. The
  ledger grows; there is no reset.
- **D4** authorize the offline `npx --no-install vitest run tests/payment-context-evidence.test.ts`.
- Not missing:
  - toolchain: node 22.14.0, agave 2.1.0, psql 17.11, pinned `program.so`; the helper
    mounts were verified in milestone 3;
  - credentials: HBA is `trust` on loopback, and no password or secret is needed;
  - funds: synthetic.
- Not established even after a pass: production archive retention, production worker
  daemons, browser/API recovery, or a rounding-remainder amount. totalUnits is fixed at
  1,000,000; a different amount needs another harness parameter, which is not proposed.

## 2026-10-20 - Milestone 4 phase 2: retained-evidence ACK recovery EXECUTED (PASS)

**Outcome: PASS.** Under current code (074 applied), new synthetic direct sales on the
owned local validator durably persisted verified evidence that includes `compiledRpcResult`.
A process stopped deliberately after the ACK evidence committed and before the ACK
lifecycle committed was recovered from retained evidence alone, with no chain reachable.
Two repeat recoveries returned the identical receipt and changed zero rows.
Every changed row across 8 snapshots is attributed to the new sales and buyers, or to the
global scan cursor's `updated_at`. The three historical blocked cases and the
milestone-3 sale have identical checksums in every snapshot.

Founder decisions D1, D1b, D2, D3 and D4 were approved together with amendments A1-A4
(see the founder message). Commits:
- `910cfc7` is the harness change, committed alone before any execution;
- this section is committed separately.

`flexsoar_payment_v2_test` was not connected to. No container was created, removed or
reset. No `.sql` file was created, edited or executed outside the unedited `02`/`04`
fixtures and the read-only `03` audit, all run by the harness `sql()` helper. No GRANT,
REVOKE or DDL. Package files and debris were untouched. The tree is still behind main,
as authorized.

### Harness change (`910cfc7`, tests/payment-integration only, no app code)

- `integrated.mjs` gains a new mode,
  `--retained-ack-recovery-isolated-integration <run> <13|14|15> [--inject-crash-after-ack-evidence]`.
  - The argument guard accepts the extra flag only when the index is `14` and there
    are exactly 4 args (`injectAckCrash`). The wrapper exists only when
    `injectAckCrash&&index===14`. Every other mode's argument check now explicitly
    excludes this one (`resume&&!retainedAck&&args.length===2`).
  - Each process runs one direct (mode 1) scenario. Fresh buyers are added through the
    unedited `04` fixture, with ATAs and test-USDC mints signed by bootstrap on the
    owned validator.
  - Index 14: after `retainAuthorityEvidence` commits the ACK evidence, the verifier
    wrapper writes `crash-after-ack-evidence-14.json` (eventId, saleId, attemptId,
    ackSignature, evidenceId). It does **not forward** `fn_payment_v2_record_lifecycle`,
    and throws `INJECTED ...`. Re-running index 14 in this mode refuses: "recover ONLY
    with retained-ack-recover.mjs, never by re-observing the chain".
  - Index 15: `totalUnits=1000019n`, `feeUnits=totalUnits*500n/10000n`,
    `netUnits=totalUnits-feeUnits`, asserted to be literally 50000/950019 with
    net+fee=total. The buyer debit, seller and treasury deltas, the persisted `attempts`
    split and the MYR snapshot of `attempts` and `orders` are all asserted in the
    harness. The 1000000 constants of indices 0-12 are unchanged in value.
  - The `03` audit takes `[13,14]` (14 only after recovery); 15 is excluded. The
    terminal-envelope audit `[1,2]`, the archival ACK recheck and its summary result
    are skipped in this mode.
- `retained-ack-recover.mjs` (new) is recovery only.
  - It asserts the attestation, netns, `lo` only and no routes, and that ports
    18899/18900/18901 refuse connections. So no validator and no chain is reachable.
  - It uses only `payment_integration_verifier` and `payment_integration_settler`
    (distinct identities). It checks the retained ACK row equals the marker's
    evidenceId and signature and carries `compiledRpcResult`.
  - It runs `recoverCommittedClaimAcknowledgement`. Attempt 1 must be exactly
    `{kind:'reconciled',signature,claim:'available'}`. Attempts 2 and 3 must be
    `receipt` with the same signature and sale, and attempt 3 must `deepEqual`
    attempt 2.
- **D1b, `evidence-db-readback.mjs:70,77`.** The assertion text and strictness are
  unchanged; the subject is now the one actually read at `:50`/`:53`.
  ```
  - const readback=await readVerifiedPaymentEvidence(verifier,'payment_event',ack.attemptId,'direct');
  + const readback=await readVerifiedPaymentEvidence(verifier,subjectKind,subjectId,subjectAction);
  - const afterConflict=await readVerifiedPaymentEvidence(verifier,'payment_event',ack.attemptId,'direct');
  + const afterConflict=await readVerifiedPaymentEvidence(verifier,subjectKind,subjectId,subjectAction);
  ```

### Commands (from Windows: `wsl.exe -d Ubuntu -- bash -lc "bash <scratch>/m4/run-m4.sh LABEL KIND ARGS"`)

`run-m4.sh` runs these steps, in order, for every process:
1. strict helper verification: Id `3a59f47b...`, Running, not privileged,
   `container:71c4856a...`, read-only root, uid 1000, ports `{}`, exact mounts, `lo`
   only, no routes, same netns;
2. DB verification, with the same checks as milestone 3;
3. `bash tests/payment-integration/attest-helper.sh flexsoar-payment-integration-20261016T075407Z`;
4. `docker exec <helper> /tools/runtime/ld-linux-x86-64.so.2 --library-path /tools/runtime /tools/node --no-warnings --loader /work/tests/payment-integration/ts-loader.mjs <script> <args>`.

Each verification printed `VERIFY_HELPER_OK` and `VERIFY_DB_OK`, and the attestation
namespace was `net:[4026532483]` every time. Processes (all exits as expected):

| Label | Script / args | Exit |
|---|---|---|
| idx13 | `integrated.mjs --retained-ack-recovery-isolated-integration /state/integrated-JXopR6 13` | 0 |
| idx14-crash | `integrated.mjs ... 14 --inject-crash-after-ack-evidence` | 1 (`INJECTED process stop after retained ACK evidence, before lifecycle database commit`) |
| recover1/2/3 | `retained-ack-recover.mjs --recover-retained-ack-isolated-only /state/integrated-JXopR6 1|2|3` | 0 / 0 / 0 |
| idx15 | `integrated.mjs ... 15` | 0 |
| readback | `evidence-db-readback.mjs --read-existing-evidence-isolated-only` | 0 |

After every process, the helper ran only `sleep infinity`; the validator was SIGTERMed by
the harness `finally`. At the end, the only TCP listener was `127.0.0.1:5432`.

A3, ledger: `/state/integrated-JXopR6/ledger` was 518,531,186 bytes (496M), at most 5 GB,
with no validator running. `cp -a` went to the new sibling
`/state/integrated-JXopR6/ledger-backup-20261020T060800Z`. File-listing sha256
(`find . -printf '%y %P %s %m\n' | sort | sha256sum`) is
`ec49ee0989c350aa39246866ec84fb211460d727f4b4d2707022711dab108fa8`, identical for the
original and the backup, and rechecked unchanged at the end. Content sha256 is
`e32bb728...ab3b`, also identical. The original was not modified by the copy. It grew to
605M only through the authorized validator runs. Genesis asserted by the harness
(`:129`): `FAiPDLaech8zexAiuEiKUWzapfJbegZyfrkBgDLYunyF`.

### Step results

| Step | Result |
|---|---|
| D4 vitest `npx --no-install vitest run tests/payment-context-evidence.test.ts` | PASS: 1 file, **16/16** tests (offline, 1.64 s) |
| Harness commit before execution | `910cfc7` (3 files, +96/-15) |
| S0 BEFORE | byte-identical to milestone 3 final (`5cbfc0e6...`); 426 row lines |
| A3 ledger backup | PASS (above) |
| 4a index 13 normal direct | PASS: buyer debit 1000000, **seller +950000, treasury +50000**, MYR 2000/100/1900, loser debit 0, ACK finalized, claim `available`, receipt, `03` audit PASS (1 sale) |
| 4b index 14 crash | PASS: exit 1 at the injected point, after `direct-funded-and-reconciled` and `direct-split-exact-base-units` (950000/50000) |
| A4 crash proof (S2) | PASS (excerpt below) |
| 4b recovery 1 (no validator) | PASS: `{"kind":"reconciled","signature":"5yUaqamLh7jGvudV...","claim":"available"}`, `chainContacted:false` |
| 4c recovery 2 and 3 | PASS: identical `receipt` (signature `5yUaqam...`, evidenceId `e98d70c4-edef-4c2f-8343-91e9016fbad2`, slot 3107); S4 and S5 byte-identical to S3 |
| A2 index 15 remainder | PASS: total 1000019, **buyer debit 1000019, seller +950019, treasury +50000**; persisted attempt `total/fee/net=1000019/50000/950019`; MYR attempt and order `2000/100/1900`; ACK and receipt; `03` audit over 13 and 14 = 2 sales PASS (15 excluded) |
| A1 store-evidence negatives | PASS 5/5 plus control (table below) |
| Permission negatives (milestone-3 set) | PASS: identical to milestone 3 (11 permission denials, unknown-subject NULLs, `PAYMENT_V2_CONTEXT_KIND_UNSUPPORTED`; context md5 `ba7307ad...` x3) |
| D1b DB readback | PASS: `ISOLATED_DATABASE_EVIDENCE_READBACK_PASS`, sale `f86ba6b4...` (index 15), subject lifecycle/acknowledged, evidence `f9741867...`, `compiledResponsePersisted:true`, `idempotentPersistedSameId:true`, `tamperRejectedBeforeLifecycle:true`, `conflictingPersistRejected:true` |
| S7 after negatives and readback | byte-identical to S6 |
| Preserved cases | identical md5 `261874eb8ca6fdc44c8221531fb41f90` (all four `case|` rows) in S0-S7 |
| Containers | both running; validator stopped; final verification OK 06:17:24Z |

### Changed rows per snapshot (row-level dump `table|pk|md5(row)`, read-only admin)

| Interval | Rows | Attribution |
|---|---|---|
| S0 -> S1 (index 13) | 34 | 29 sale-13 rows, 4 new-buyer rows (`users` x2, `wallet_accounts` x2, fixture 04), 1 `payment_v2.cursors` (`updated_at` only) |
| S1 -> S2 (index 14 crash) | 29 | 28 sale-14 rows (the 29-row footprint minus the acknowledged `lifecycle_evidence`), 1 cursor |
| S2 -> S3 (recovery 1) | 4 | sale 14: +1 `lifecycle_evidence`(acknowledged, evidenceId `e98d70c4`); `sales.chain_acknowledged` f->t; `inventory` custody_version -> 2; `operations` acknowledge_claim -> observed. The end state equals uninterrupted sale 13 (state direct, ack t, custody_version 2, both operations observed). |
| S3 -> S4 (recovery 2) | 0 | none |
| S4 -> S5 (recovery 3) | 0 | none |
| S5 -> S6 (index 15) | 30 | 29 sale-15 rows, 1 cursor |
| S6 -> S7 (negatives and readback) | 0 | none |
| S0 -> S7 total | 92 | 87 = 3 x 29 sale rows, plus 4 buyer rows and 1 cursor. 0 pre-existing rows changed except the cursor; 0 removed |

The 29-row direct-sale footprint, per sale:
- fixture `02`: `sku_models`, `skus`, `items`, `cards` (owner later set to the buyer),
  `listings`, `payment_v2.inventory`, and a `ledger_entries` mint;
- `prepare_sale` (issuer): `quote_books`, `sales`;
- open (issuer, plus verifier evidence): `verified_chain_evidence`(lifecycle/opened),
  `lifecycle_evidence`(opened, evidenceId), `operations`(open_sale);
- initiate (customer) x2: `attempts` (winner `direct`, loser `authorized`);
- reconcile (verifier evidence, then settler): `verified_chain_evidence`(payment_event/direct),
  `events`(direct, evidenceId), `consumptions`, `orders`, `usdc_journal` x3 (sum 0),
  `claim_history`, `outbox` x2, and 2 claim-transfer `ledger_entries`;
- ACK (reconciler on chain, then verifier): `verified_chain_evidence`(lifecycle/acknowledged),
  `operations`(acknowledge_claim), `lifecycle_evidence`(acknowledged).

Automatic attribution (`attribute.py`) passed for every interval: each added or changed
row's text contains a public ID of that scenario.

### A4 crash-proof excerpt (S2, read-only)

```
sale|db6f6c10-3328-471e-82de-402ddf6c2a37|direct|f          (state, chain_acknowledged=false)
evidence|lifecycle|opened|d194235c-...|3fGhE3RBamjtBmoG|primary|t
evidence|payment_event|direct|028a4d77-...|48VkRqjRhxvG7yaZ|primary|t
evidence|lifecycle|acknowledged|e98d70c4-edef-4c2f-8343-91e9016fbad2|5yUaqamLh7jGvudV|primary|t   <- ACK evidence present, has compiledRpcResult
lifecycle_rows|opened|d194235c-...                          (no acknowledged lifecycle row)
acknowledged_lifecycle_count|0
settler_ack_context_receipt|null                            (payment_integration_settler)
customer_claim|unreconciled|direct                          (payment_integration_customer; claim NOT available)
```

### A1 store-evidence negatives (verifier login, `BEGIN TRANSACTION READ ONLY; SET LOCAL ROLE payment_v2_verifier`, `VERBOSITY verbose`, ROLLBACK)

The base envelope is the index-13 retained ACK evidence read through
`fn_payment_v2_read_chain_evidence`, with `id`/digest fields removed and base64 newlines
stripped.

| Case | Mutation | Expected | Actual SQLSTATE: message | Result |
|---|---|---|---|---|
| C0 control | none | returns the existing id, no INSERT | exit 0, `6008354b-bb28-4cb2-96dd-2c07e516db90` | PASS (payload valid) |
| N1 | `networkId` changed to the inactive `d6fa9d50-...` | NETWORK_MISMATCH | `P0001: PAYMENT_V2_VERIFIED_NETWORK_MISMATCH` (line 12) | PASS |
| N2 | `parsedRpcResult` removed | EVIDENCE_SHAPE | `P0001: PAYMENT_V2_VERIFIED_EVIDENCE_SHAPE` (line 6) | PASS |
| N3 | base64 char 10 flipped (signature bytes) | TRANSACTION_IDENTITY | `P0001: PAYMENT_V2_VERIFIED_TRANSACTION_IDENTITY` (line 8) | PASS |
| N4 | base64 char len-10 flipped (message bytes) | RESULT_MISMATCH | `P0001: PAYMENT_V2_VERIFIED_RESULT_MISMATCH` (line 9) | PASS |
| N5 | `genesis` changed to the other network's genesis | NETWORK_MISMATCH | `P0001: PAYMENT_V2_VERIFIED_NETWORK_MISMATCH` (line 12) | PASS |

No case returned 25006: validation refused before the INSERT in every negative case.

### Results by category

- **Real chain/DB integration:**
  - three direct sales on the owned local validator, coupled to PostgreSQL through
    dedicated worker logins;
  - exact USDC base-unit splits, including the remainder amount;
  - durable verified-evidence persistence with `compiledRpcResult`;
  - ACK lifecycle recovery from retained evidence after an injected stop;
  - idempotent repeats;
  - the DB readback, tamper and conflict harness.
- **Offline/mocked:** vitest `payment-context-evidence.test.ts`, 16/16.
- **Simulated outages:** the injected process stop between ACK evidence and lifecycle
  commit (index 14). Recovery ran with every validator port closed. There was no
  archive-adapter outage run this time.
- **Intentional fail-closed:**
  - A1 N1-N5;
  - 11 permission denials, the unsupported kind and unknown-subject NULLs;
  - the losing buyer of each race failed on chain with 0 debit;
  - re-running index 14 in the mode refuses by design (not executed).
- **Blocked/unimplemented, unchanged:**
  - the pruned ACK, case 0, is not reverifiable;
  - the expired escrow op `27bc0cae...` stays `unknown`/REVIEW_REQUIRED;
  - the unresolved registration, case 3, stays `opening`;
  - the milestone-3 sale `6e2a2198...` keeps no evidence;
  - there is no production archival retention or worker daemon;
  - there is no browser or API recovery.

### Limits and notes

- The rounding remainder was exercised in USDC only. The MYR snapshot is fixed by the
  listing price (2000 sen, giving 100/1900) and is independent of `totalUnits`
  (`066:52`).
- `evidence-db-readback.mjs` still prints the hard-coded literal
  `pendingAcknowledgementFixtureAvailable:false`. That is now stale, because index 14 is
  such a fixture. It was not changed beyond D1b.
- To build the attribution ID list, the scratch `ids.sh` parsed
  `EPHEMERAL-LOCAL-ONLY-m4-buyers.json` and extracted only the `id` fields. No secret was
  printed or copied.
- The harness reads verification rows as `supabase_admin` through `sql()` (existing
  behaviour: order count, owner, journal, and the new attempt/order split reads).
  The only admin writes were the unedited `02` (x3) and `04` (x1) fixtures.
- Local chain transactions, all on the owned validator only:
  - 2 ATA creations and 2 mints for the new buyers;
  - per index: `register_card`, ALT create and extend, `open_sale`, 2 racing `buy_v2`
    (1 failed on chain) and `acknowledge_claim`.

## 2026-10-20 - Pre-merge review: track/payment-security -> main, deploy with funding DISABLED (read-only)

Reviewed HEAD: `f98e32f` (the merge of main `f2ac97a` into `e1fab59`); `git log HEAD..main` is empty.
This was a read-only review: no edits, no DB, chain or container access, no
install/ci/audit fix. The only commit is this section. The tree was clean before and
after `tsc`/`npm test`/`npm audit`.
Reference: Codex's map of main, `C:\Users\Family\flexsoar-reviews\money-routes-20261020-0916.md`
(afae327). Wherever a route or action is **unchanged** by this branch
(`git diff --stat main..HEAD`), Codex's main findings still apply and are summarised,
not repeated. **Static source review only.** The deployed DB grants, migration state,
config rows and env values are **UNKNOWN**.

### 5. Validation on this HEAD

- `npx --no-install tsc --noEmit`: exit 0.
- `npm test` (vitest run): **20 files, 528/528 passed**, exit 0.
- `npm audit --json`: 40 findings: 1 critical, 11 high, 28 moderate (section 4).

### 1. Route by route (merged code)

Verdicts: **REMOVED** / **HARD-DISABLED** (unconditional refusal) /
**FAILS-CLOSED-UNLESS-CONFIGURED** / **LIVE**.

| Route / action | Auth (file:line) | Effect after merge | Gate, env missing vs present | Verdict |
|---|---|---|---|---|
| GET /api/solana/build-tx | session `route.ts:6-8` -> 401 | none | unconditional 503 `FUNDING_DISABLED` (`:9`); no env read | **HARD-DISABLED** |
| GET /api/solana/quote | session `route.ts:6-8` -> 401 | none | unconditional 503 (`:9`) | **HARD-DISABLED** |
| POST /api/solana/settle (legacy body) | session `:15-18`; quote identity `:39-43`; HMAC `:50` | receipt lookup of an existing `orders.settlement_ref` only | `verify` and `settle` both `blocked` (`:63-68`), so with no prior order it is 409. Missing `SOLANA_QUOTE_SECRET` makes `verifyQuoteSignature` throw, which is caught as 409 (`:70-76`) | **HARD-DISABLED for settlement** (receipt-only lookup LIVE) |
| POST /api/solana/settle (`version:2`) | session `:15-18` | `attachPaymentCandidate` session RPC records a candidate only; 202 pending (`:25-31`) | needs migrations 060+ and an own attempt; none can exist (no initiate caller, see 1d); otherwise 503 | **FAILS-CLOSED** |
| GET /api/solana/attempts (new) | session `:6-7` | session RPC `fn_payment_v2_own_attempts`, read-only; `fundingAvailable:false` | RPC absent -> 503 (`:11`) | LIVE read-only |
| GET /api/solana/receipts (new) | session `:6-7`; buyer-bound `.eq('buyer_id',user.id)` `:11`, re-checked `:17` | read own orders | session client (RLS) | LIVE read-only |
| POST /api/internal/solana/reconcile (new) | `Bearer PAYMENT_RECONCILE_SECRET` `:4-5`, missing secret -> 401 | none | flag `PAYMENT_V2_ENABLE_LOCAL_RECONCILIATION!=='true'` -> 503 (`:6`); even with both set it is an unconditional 503 (`:8`); the file imports no Supabase client | **HARD-DISABLED** |
| GET /api/solana/balances | session (unchanged; Codex) | RPC balance read | `HELIUS_API_KEY` missing -> 501 | LIVE read-only |
| GET/POST /api/solana/link-wallet | session `route.ts:28-33,42-47` | service write `users.solana_address` (`:72-76`) | Ed25519 proof required (1g) | LIVE (proof-gated) |
| GET /api/cron/process-payouts | `Bearer CRON_SECRET`, missing -> 401 (`route.ts:23-33`) | `processAllDuePayouts`; nothing executes (1a) | none needed | **HARD-DISABLED (no money path)** |
| GET /api/cron/sync-comps | CRON_SECRET (unchanged) | market_refs/sku_models display data | `EBAY_APP_ID` missing -> skipped | LIVE (no money) |
| POST /api/webhooks/stripe | `stripe-signature` + `constructEventAsync` (`route.ts:528-547`) | **none**: handled events return 503 `Stripe is dormant` (`:553-558`) | `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` missing -> 500 (`:520-526`) | **HARD-DISABLED** (verification kept) |
| POST /api/webhooks/stripe-connect | signature (unchanged) | sets `stripe_connect_payouts_enabled=true` | secret missing -> 500 | LIVE-IF-CONFIGURED (no money; readiness-revocation gap per Codex) |
| POST /api/consignor/connect | session (unchanged) | creates a Stripe Connect account and link; may set `is_consignor` before the key check | `STRIPE_SECRET_KEY` missing -> throws | LIVE-IF-CONFIGURED (no money) |
| GET /api/fx, /api/webhooks/ebay-deletion | none (unchanged) | display / ack | - | LIVE (no money) |
| createCheckoutAction | - | unconditional `throw` (`app/(market)/actions.ts:217-220`) | - | **HARD-DISABLED** |
| createRedemptionCheckoutAction | - | unconditional `throw` (`:274-276`), zero-total branch included | - | **HARD-DISABLED** |
| completeRedemptionAction | - | unconditional `{ok:false}` (`:345-348`) | - | **HARD-DISABLED** |
| listCardAction / cancelListingAction | session `:113`, `:162-165` | `fn_payment_v2_list_card` / `fn_payment_v2_request_cancel` (`lib/api/contract.ts:1508,1529`) | **RPCs exist only after migrations 059+**; on a 058 DB they error | LIVE-IF-MIGRATED |
| submitEscrowDecision (`app/admin/payments`, new) | `requireAdminAction()` `actions.ts:9`; page `requireAdminPage` `page.tsx:24` | session RPC `fn_payment_v2_record_decision`, intent only; DB checks enrolled staff role and independence | needs migrations; no escrows exist while funding is off | FAILS-CLOSED |
| batchMintAction / approveSubmissionAction / burnCardAction | see 1f | initial ownership / burn | SQL `fn_require_admin` | LIVE (admin) |

**a. Payouts cannot move money, regardless of `STRIPE_SECRET_KEY`/`CRON_SECRET`.**
- `checkPayoutEligibility` (`lib/api/contract.ts:4407-4422`) returns `eligible:false`
  for every order, with a reason from `stripePayoutBlockReason`
  (`lib/db/purchase-payment.ts:50-54`).
- `processAllDuePayouts` filters `eligible` (`:4448-4449`), so its loop runs zero times.
- `executePayout` (`:4427-4434`) always ends in
  `throw new ContractError('WRONG_STATUS', …)`.
- `transfers.create` appears **nowhere** in app/lib (grep). The only Stripe
  constructors left are Connect onboarding and status (`contract.ts:4286,4361`) and the
  two webhooks.
- Pinned by `tests/purchase-payment.test.ts:248-259`: USDC and `pi_` orders are
  ineligible, `executePayout` rejects, and `mocks.stripe` is never called.

**b. Legacy build-tx/quote/settle cannot issue a purchase or transfer a card.**
- build-tx and quote are an unconditional 503 after the session check. Pinned by
  `tests/purchase-payment.test.ts:265-268`, which also asserts no query or RPC.
- settle's only success is returning an already-existing matching order
  (`purchase-payment.ts:27-32`). `verify` and `settle` are `blocked`
  (`settle/route.ts:63-68`).
- `purchaseCard`/`purchaseCardSplit` throw unconditionally (`contract.ts:1553-1557`,
  `1612-1618`; pinned at `tests/purchase-payment.test.ts:270-274`).
- `issueQuote`, `verifyBuyTransaction` and `treasuryAddress` have no app caller.
- **No configuration re-enables these in app code.** But see the BLOCKER BEFORE
  DEPLOY on direct SQL RPCs.

**c. Stripe checkout webhook and checkout/redemption actions cannot create a sale,
settle or mark a redemption paid.**
- The webhook returns 503 for every handled event after signature verification
  (`webhooks/stripe/route.ts:553-558`). The legacy handlers in the file are unreachable
  from `POST`.
- The three actions refuse unconditionally (`actions.ts:220,276,348`).
- Gap: no test calls the webhook `POST` or these three actions (backlog). The
  invariants tests only mirror the old pure parsing logic
  (`tests/invariants.test.ts:1242+`).

**d. Public-funding switch.** There are three independent layers, all default-off and
none env-enabled:
1. **App constant** `FUNDING_AVAILABLE = false`, with **no env override**
   (`lib/db/payment-v2.ts:62`).
   - Pinned by `tests/payment-v2.test.ts:185`, which also asserts the panel renders
     "Recover payment status" / "Do not pay again" and no "Confirm in wallet".
   - Echoed in `attempts/route.ts:10-11`.
   - The legacy issuance 503 is pinned by `tests/purchase-payment.test.ts:265-268`.
2. **DB switch** `payment_v2.networks.funding_enabled boolean NOT NULL DEFAULT false`
   (`059_payment_v2_records.sql:53`).
   - Every issuing RPC refuses unless it is true plus `funding_configuration`:
     `prepare_sale` (`060:109`) and `initiate` (`066:42`).
   - No migration inserts a networks row.
   - 063 refuses to apply if any network is enabled (`063:7`).
3. **No production caller** of `initiatePaymentAttempt` exists (only the re-export
   `contract.ts:4815`). No production code writes `payment_v2.wallet_accounts`, which
   `initiate` requires (`066:47-49`).

`NEXT_PUBLIC_ENABLE_PRIVY_CHECKOUT` (`lib/solana/privy.ts:98-99`) is **inert**:
`isPrivyCheckoutEnabled()` has no caller outside `tests/solana-settle.test.ts:586-590`.
It does **not** gate the wallet Deposit on-ramp (section 3).

**e. `/api/internal/solana/reconcile`.** The caller must present
`Bearer PAYMENT_RECONCILE_SECRET` (`route.ts:4-5`; missing secret -> 401). The flag is
required (`:6`). The route then always returns 503 (`:8`). It imports no Supabase or
service client (the whole file is 9 lines). Pinned by
`tests/payment-db-adapters.test.ts:29-35`: with the secret and the flag set it returns
503 "Dedicated verifier and settler…" and the network mock is never called. The worker
transport refuses `service_role`, `supabase_admin` and other privileged logins
(`lib/db/payment-postgres.ts:41`), and on failure returns `PAYMENT_DB_OUTCOME_UNKNOWN`
without retry (`:65`), as milestone 3 found. There is no test for the missing-secret or
missing-flag branches (backlog; the code at `:5-6` is fail-closed).

**f. Admin actions.**
- `batchMintAction`: `requireAdminAction()` at `app/admin/mint/actions.ts:47`, then
  session `fn_mint_card`, guarded by `perform fn_require_admin()`
  (`005_admin_guards.sql:51`).
- `approveSubmissionAction`: `requireAdminAction()` at
  `app/admin/submissions/actions.ts:60`; SQL `v_admin := fn_require_admin()`
  (`041_fix_post_032_function_refs.sql:44`, superseding `030:29`).
- `burnCardAction`: **no action-level guard** (`app/admin/cards/[id]/actions.ts:7-9`).
  It is backed by session `fn_burn_card` with `v_admin := fn_require_admin()`
  (`028_connect_notifications_retire.sql:141`), granted only to `authenticated`
  (`:168-169`).
- The same pattern applies to `archiveSkuModelAction` (`app/admin/skus/[id]/actions.ts:7-9`,
  SQL `028:195`).
- Every other admin action calls `requireAdminAction()`, which throws unless
  `checkAdmin` is ok (`components/admin/auth.ts:68-76`).
- `proxy.ts` gates the /admin pages only and is not the boundary (`proxy.ts:24-27`).

**g. link-wallet: a user cannot bind a wallet they do not control.**
- POST requires a session (`route.ts:42-47`).
- It then requires an Ed25519 signature that verifies against the submitted address
  over `FlexSoar wallet link\nuser:<session users.id>\nissued:<ts>`, within 10 minutes
  (`lib/solana/wallet.ts:22-24,52-79`). Only the verified address is stored
  (`route.ts:72-76`).
- Residual issue: the message has no domain or cluster binding. A user tricked into
  signing a message naming *another* user's id would make their own wallet that user's
  payout address. That benefits the victim, not the attacker (backlog).
- The v2 path additionally requires a `payment_v2.wallet_accounts` binding that no
  production code creates.

### 2. Custody rule ("vaulted" only from a custody record: physically held and authenticated)

- UI: the "Vaulted" badge is `vaulted={item.custody === "warehouse"}`
  (`app/(market)/card/[id]/page.tsx:203` -> `components/card/CardDetail.tsx:121-123`).
  BuyPanel's seller-held state also reads `items.custody`. **No app or server code
  derives vaulted from the lister's identity, role, handle or `is_admin`** (we grepped
  app/components/lib for is_admin, role, handle and platform comparisons).
- Violations of the founder rule, all from the data model rather than lister identity:
  1. **Column default** `custody custody_model not null default 'warehouse'`
     (`013_seller_custody.sql:54`). Pre-013 rows were backfilled as warehouse, and any
     future insert that omits custody (dashboard, manual SQL) is shown as Vaulted with
     no receipt record. The in-repo item creators set `'seller'` explicitly
     (`013:143-152`, `019c:423-432`).
  2. The UI badge checks custody only, not authentication (`authenticated_at`) or a
     received vault intake.
  3. v2 sets `custody='warehouse'` on the `receipt` decision **before**
     authentication (`061_payment_v2_settlement.sql:174`). The legacy
     `fn_vault_receive` sets warehouse with `authenticated_at = coalesce(..., now())`
     (`023c:263-268`). That is admin-gated, but it stamps authentication at receipt.
- "Paid cash to bank" copy. The founder's decision is 95% to the seller in USDC on
  chain. These still say cash to bank:
  - `components/market/ListForm.tsx:104`, `:109-110`, `:139-140`;
  - `components/market/intake/PricePayout.tsx:174`, `:182`, `:189-190`, `:242-243`;
  - `components/market/PayoutSetup.tsx:133`;
  - `components/auth/WelcomeForm.tsx:167`;
  - `app/(market)/settings/page.tsx:40`.

  `components/market/SellerGuideModal.tsx:31` and `app/(market)/payouts/page.tsx:183-197`
  describe payout and bank cash-out (the payouts page says it is paused). These belong
  to the market/design lanes; nothing was edited.

### 3. Environment and deploy (names only; no values were read)

Read by the merged app:
- **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (computed `requireEnv`, `lib/supabase/server.ts:41-111`).
- **Cron:** `CRON_SECRET`.
- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`.
- **Payment v2 reconcile:** `PAYMENT_RECONCILE_SECRET`, `PAYMENT_V2_ENABLE_LOCAL_RECONCILIATION`.
- **Solana:** `SOLANA_CLUSTER`, `SOLANA_USDC_MINT`, `SOLANA_TREASURY`,
  `SOLANA_MAX_TRADE_UNITS`, `SOLANA_MYR_PER_USD`, `SOLANA_QUOTE_SECRET`, `HELIUS_API_KEY`.
- **Privy:** `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_FUNDING_ENV`,
  `NEXT_PUBLIC_SOLANA_CHAIN`, `NEXT_PUBLIC_ENABLE_PRIVY_CHECKOUT`.
- **Auth:** `NEXT_PUBLIC_ENABLE_PASSWORD_AUTH`.
- **URLs and support:** `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `SUPPORT_EMAIL`,
  `SUPPORT_PHONE`.
- **eBay:** `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_DELETION_TOKEN`, `EBAY_DELETION_ENDPOINT`.
- **Email:** `RESEND_API_KEY`, `FROM_EMAIL`.
- **R2:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
  `R2_PUBLIC_URL`.
- **Runtime:** `NODE_ENV`, plus `PATH`/`SystemRoot` (passed through only by the psql
  transport).

For a deploy with funding disabled:
- **Must be set:** the three Supabase vars; `CRON_SECRET` (otherwise the crons 401,
  harmless); R2 (listing photos); Privy app id (wallets); app/site URL; email if mail
  is wanted.
- **Should be ABSENT:**
  - `PAYMENT_RECONCILE_SECRET`, `PAYMENT_V2_ENABLE_LOCAL_RECONCILIATION`: inert, but
    absent is cleaner.
  - `SOLANA_TREASURY`, `SOLANA_MAX_TRADE_UNITS`: no runtime caller.
  - `NEXT_PUBLIC_ENABLE_PRIVY_CHECKOUT`: inert.
  - `SOLANA_QUOTE_SECRET`: only enables legacy receipt lookup; absent makes that 409.
  - `STRIPE_*`, per the founder's USDC-only decision: absent keeps Connect onboarding
    failing closed and the webhook at 500.
- **Dangerous if set:**
  - `NEXT_PUBLIC_PRIVY_FUNDING_ENV=production`. The wallet Deposit tab
    (`components/market/WalletMenu.tsx:129-207` -> `FundingOptions.tsx:56-84`) opens a
    real card on-ramp to **mainnet** USDC (`privy.ts:108-112`, hard-coded
    `FUNDING_CHAIN`). Nothing can be bought, and the copy says "then spend from your
    balance". It is **not** gated by any funding flag.
  - A live `STRIPE_SECRET_KEY` creates real Connect accounts (`/api/consignor/connect`).
  - `SOLANA_CLUSTER=mainnet-beta` together with a non-matching `SOLANA_USDC_MINT`.
- **Cluster and mint defaults:**
  - `SOLANA_CLUSTER` defaults to `devnet` (`lib/solana/config.ts:15,28`).
  - `SOLANA_USDC_MINT` defaults per cluster (`:12-18`; mainnet
    `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, devnet
    `4zMMC9srt5Ri5X14GAgXhaHii3L6VUHdfBMqBGE3ter`). A set value always wins.
  - `NEXT_PUBLIC_SOLANA_CHAIN` defaults to `solana:devnet` (`privy.ts:29`).
  - **No runtime cross-check** between `SOLANA_CLUSTER`, `SOLANA_USDC_MINT`,
    `NEXT_PUBLIC_SOLANA_CHAIN` and the hard-coded mainnet funding chain. The only check
    is a test (`tests/solana-settle.test.ts:593-599`: mainnet default mint equals the
    funding mint). With defaults, a mainnet on-ramp deposit would not appear in the
    devnet `/api/solana/balances`.
  - `verifyPurchaseTransaction` rejects clusters other than devnet/mainnet-beta
    (`lib/solana/verify.ts:60-61`), but it has no production caller.

### 4. npm audit (1 critical, 11 high; no fix applied)

| Pkg (installed) | Path | Ships | Exploitability here | Minimal fix |
|---|---|---|---|---|
| **next 16.3.0** (critical) | direct | server and client runtime | Advisories: RCE on Windows hosts (n/a on Vercel Linux); RCE in image optimisation with AVIF (no `images.remotePatterns`, so only local images are optimised; R2 accepts AVIF uploads but they are not optimised by next/image, so UNKNOWN but low); RCE in `next/og` (not used); `use cache` draft-mode leak (not used); SSG/ISR cache poisoning for self-hosted (UNKNOWN on Vercel); metadata image route bypass (no metadata image routes); SSRF in the image optimiser (no remote patterns); dev MCP disclosure (dev only) | upgrade to **next >= 16.3.8** (audit suggests 16.4.2, non-major) with matching `eslint-config-next`; human-only via DEPS.md, followed by tsc, test and build |
| sharp 0.35.4 | via next | server (image optimiser) | librsvg; SVG optimisation is disabled by default (`dangerouslyAllowSVG` not set) | `sharp >= 0.35.5` (comes with the next upgrade or an override) |
| @coral-xyz/anchor 0.32.1 + toml 3.0.0 | direct dep | **not imported** by app/lib/components (grep: only package.json/DEPS.md) | not reachable at runtime; toml prototype pollution needs untrusted TOML | remove the unused dependency (human) or accept; no upstream fix |
| ws 7.5.13 / 8.18.3 | Privy -> WalletConnect/viem | browser bundle (ws is shimmed to the native WebSocket) and server if SSR imports it | memory disclosure / DoS on a ws server or client parsing hostile frames; app runs no ws server | `@privy-io/react-auth` bump (audit says 3.6.1 is a *downgrade*; prefer an override `ws >= 8.21.0`) |
| eslint-config-next / @next/eslint-plugin-next / fast-glob / micromatch / braces / brace-expansion | dev lint tooling | **dev-only** | ReDoS/DoS on attacker-controlled globs during lint | bump with next; not deploy-relevant |
| source-map-js 1.2.1 | build tooling | dev/build | DoS on hostile source maps | override `>= 1.2.2`; not deploy-relevant |

### BLOCKERS (must fix before merge to main)

- **None at code level.** tsc is clean, 528/528 tests pass, and every money route and
  action in the merged code is hard-disabled or fails closed (section 1).
- **Conditional:** if `main` auto-deploys to production (Vercel git integration;
  UNKNOWN from source), merging *is* deploying. In that case every item in the next list
  becomes a merge blocker, unless auto-deploy or production promotion is paused first.

### BLOCKERS BEFORE DEPLOY (can merge, but do not deploy)

1. **Legacy SQL settlement is callable directly by any signed-in user (static
   evidence; live grants UNKNOWN).**
   - Through 058, `fn_purchase_card(uuid,uuid,text,bigint,uuid)` is SECURITY DEFINER
     (`021_credit_holds.sql:418-445`) and granted to `authenticated`
     (`022b_permissions_lockdown.sql:171`).
   - For a cash leg its only check is a non-empty `p_settlement_ref`
     (`043_sale_notification.sql:116-119`). The caller/buyer identity check covers only
     the FSC leg (`:105`).
   - So a PostgREST `rpc('fn_purchase_card', {…, p_buyer_id:<any>, p_settlement_ref:'x', p_credit_cents:0})`
     with the public anon key and a user JWT transfers a listed card and creates an
     order without payment.
   - The merged app no longer calls it, but app code cannot revoke a DB grant. This
     applies to **main today** if its DB matches the migrations.
   - Also `fn_redeem_card` takes a client-supplied `p_fee_cents`, although it checks the
     actor (`048_pricing_fees_rarity.sql:2,17,39-44`, granted to `authenticated` `:54`).
   - **Minimal fix (human, SQL):** apply 063's retirement, or at least
     `REVOKE EXECUTE ON FUNCTION fn_purchase_card(uuid,uuid,text,bigint,uuid), fn_redeem_card(uuid,uuid,jsonb,integer) FROM authenticated;`.
     Then verify read-only with `has_function_privilege('authenticated', …)` on the
     production DB.
2. **The merged app requires v2 schema RPCs.** List and cancel listing
   (`contract.ts:1508,1529`), redemption (`:2001-2011`), attempts, settle v2 and the
   admin queue call `fn_payment_v2_*`, which exist only after migrations 059-074. On a
   058 DB those features error out (fail closed, but broken). Decide before deploy:
   apply 059-074 to production with no networks row (`funding_enabled` stays false;
   063 itself refuses otherwise), or do not deploy. Which migrations production has
   applied is UNKNOWN.
3. **Upgrade `next` (and `sharp`) before exposure:** next >= 16.3.8 (section 4). This is
   a human DEPS.md request.
4. **Env:** `NEXT_PUBLIC_PRIVY_FUNDING_ENV` must be absent or `sandbox`, or the Deposit
   tab must be hidden. Otherwise users can buy real mainnet USDC with nothing to spend
   it on (`FundingOptions.tsx:56-84`). Set the vars in section 3; keep `STRIPE_*` absent
   per the founder's decision.
5. **Seller payout copy** promises cash to bank (section 2 list). Replace it with "95%
   in USDC to your linked wallet" (market/design lanes).
6. **Vaulted badge:** require authentication and a custody record, not just
   `custody === 'warehouse'` (`app/(market)/card/[id]/page.tsx:203`). Audit production
   rows whose custody came from the 013 default (`013_seller_custody.sql:54`). The
   minimal UI fix is `custody === 'warehouse' && authenticated_at != null`. The
   SQL-level fix is a human migration.

### ACCEPTABLE / backlog

- Add an action-level `requireAdminAction()` to `burnCardAction`
  (`app/admin/cards/[id]/actions.ts:7`) and `archiveSkuModelAction`
  (`app/admin/skus/[id]/actions.ts:7`). SQL `fn_require_admin` already blocks them
  (`028:141,195`).
- Add tests for `webhooks/stripe` `POST` -> 503 on handled events; for
  `createCheckoutAction` / `createRedemptionCheckoutAction` / `completeRedemptionAction`
  refusals; and for the missing-secret and missing-flag branches of reconcile.
- v2 `receipt` sets warehouse before authentication (`061:174`). Fix before enabling
  funding. Not reachable while there are no escrows.
- Connect readiness is never revoked (`webhooks/stripe-connect`, Codex). `consignor/connect`
  mutates `is_consignor` before the key check. Both are moot while Stripe is dormant.
- The link-wallet message lacks a domain or cluster binding (1g). Low risk.
- No runtime cross-check of cluster, mint and Privy chain (section 3). Remove the
  unused `@coral-xyz/anchor`. Dev-tool audit highs.
- Dead code: legacy Stripe handlers in `webhooks/stripe/route.ts`, `issueQuote`,
  `verifyBuyTransaction`, `treasuryAddress`, `maxTradeUnits`,
  `isPrivyCheckoutEnabled`. These can be removed in a cleanup pass.

UNKNOWN (not determinable read-only from source):
- production DB grants, applied migrations and `platform_config` rows;
- the deployed env values, and whether main auto-deploys;
- whether Vercel's image optimiser is affected by the next/sharp advisories;
- the compiled Server Action manifest.

## 2026-10-21 - Cloud schema drift audit (read-only vs cloud; replay in a new isolated container)

Scope: how the CLOUD schema (founder export `cloud-schema-20261020.csv`, 699 objects, sha256
`f0e77e0d...c02c831`) differs from what `supabase/migrations` 001-075 produce, and which objects
created by 059-075 anon/authenticated could use under the cloud's default privileges.
No cloud access. No migration or repo `.sql` file was edited or created. HEAD at start `641a4ca`, clean.

### Method and environment

- New disposable container `flexsoar-schema-replay-20261021-0031`,
  Id `6ef7375a8c4e4516b2edf3a5828c20269962905eac73ca70c1dd9c982f4fff21`, image
  `supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc`
  (same digest as the existing DB container). Verified before every connection: Running, NetworkMode none,
  PortBindings {}, Privileged false, no docker.sock, `/proc/net/dev` = lo only, `/proc/net/route` header only,
  3 mounts all rw=false (worktree `supabase/migrations`, `replay-auth-prereq-20261020.sql`, `inventory-query.sql`).
  No `payment_v2_*` / `payment_integration_*` roles existed before the replay.
  **The container is now STOPPED (not removed).**
- Prereq file sha256 `4295d81f...a748652a` verified (matches). Inventory query sha256 `f4e13174...42adee8`, run unmodified.
- Founder rulings this session:
  1. The new database is named `flexsoar_schema_replay_20261020` (not `_b`), because the hash-verified prereq
     hard-guards on that name.
  2. Part A (001-058 drift) uses an inventory taken in the new container immediately after 058, instead of
     restarting the existing container (found Exited 255).

  The existing container and its databases were not touched. The payment test DBs were not accessed.
- Replay (`psql -X -v ON_ERROR_STOP=1`, stdin, as `supabase_admin`): pre001, 001-022, pre022b, 022b-051, pre052,
  052-058, **inventory@058**, 059-075, **inventory@075**. **All 87 migrations returned rc=0, with no stop.
  `replay-prereq-b-20261021.sql` was not needed and was not created.** The 059 preflight passed (no pre-existing roles).
- Inventories: cloud 699; replay@058 730; replay@075 1330.

### 1. 001-058 drift (cloud vs replay@058)

Raw differences: only in the cloud 5, only in the replay 36, differing 144 (128 functions, 16 policies).

- Owner differences (cloud `postgres` vs replay `supabase_admin`, 83 functions) were normalised out and not counted.
- ACLs were compared on PUBLIC/anon/authenticated/service_role, after dropping the owner/postgres/supabase_admin entries.
- Tables, columns, constraints, triggers and enums: no other differences.

Classified:

| Category | Count | Real drift? | Evidence |
|---|---|---|---|
| Policies: qual md5 differs | 16 | **No** (deparse artifact) | The replay session's search_path for `supabase_admin` includes `auth`, so `pg_get_expr` prints `uid()`/`jwt()`. Re-qualifying them to `auth.uid()`/`auth.jwt()` makes all 16 md5s equal the cloud. |
| citext functions: `proconfig search_path=public` only in the replay | 45 | **No** (artifact of the executing role) | 034's first loop alters every public function whose proconfig is NULL. In the cloud it ran as `postgres`, which doesn't own the citext functions, so they were skipped. In the replay it ran as superuser and succeeded. |
| pgcrypto functions only in the replay | 36 | **No** (environment) | In the replay, `create extension pgcrypto` lands in public. The cloud has none in public, presumably because they're in Supabase's `extensions` schema (inferred: the inventory covers only public/payment_v2). |
| App function bodies: md5 differs, identical after LF->CRLF | 78 | **No** (cosmetic) | Every one of the 83 app functions in the cloud stores a **CRLF** body. 78 equal the repo body byte-for-byte once `\n` becomes `\r\n`. The main checkout and this worktree have 001-058 as LF, so the CR came from the paste path into the SQL editor. |
| ACL: `fn_purchase_card`, `fn_redeem_card` revoked from authenticated | 2 | **No** (expected) | The cloud has 075 applied and replay@058 does not. `fn_purchase_card_core` already matched. |
| `fn_mark_shipped(uuid,text,text)` body | 1 | **YES** | The cloud body is the **009_rls_sweep.sql** version (CRLF); 014_fixes.sql's redefinition is not in the cloud. It lacks the seller-held guard (`if v_red.fulfiller_id is not null then raise 'use fn_confirm_shipment'`). The function is admin-only (`fn_require_admin`), so the impact is seller-held parcels being marked shipped on the wrong path, losing fulfilment credit. |
| `fn_confirm_shipment(uuid,text,text)`, `fn_mark_default(uuid,text)`, `fn_record_proof(uuid,jsonb)` bodies | 3 | **YES** (unknown body) | They match no committed version of any migration: 122 historical blobs across 96 commits (`--all`), tried with LF/CRLF/rstrip/strip/tab variants. 013 and 014 each have a single commit, so what ran was an uncommitted draft or a direct SQL-editor edit. |
| `fn_purchase_credit(uuid,bigint,text)` body | 1 | **YES** (unknown body) | Matches neither 011 commit. Moot after 063, which retires it. |
| `sku_models.external_id`, `.gender`, `.source` (text not null default 'manual'), `.style_code`: only in the cloud | 4 | **YES** (the cloud is ahead of the repo) | No migration in any commit creates them. `scripts/seed-sneakerdb.mjs` calls this "the style_code migration", and `app/(market)/list/actions.ts` reads `style_code`. Indexes aren't in the inventory, so they're unknown. |
| `skus.skus_art_url_check`: only in the cloud | 1 | Yes, harmless | Same md5 as `skus_art_url_https` (`CHECK (art_url IS NULL OR art_url ~ '^https://')`). It's a duplicate left by the hand-added column that 012 documents. |

**Real 001-058 drift: 10 items** (5 function bodies, 4 columns, 1 duplicate constraint).
None of them changes privileges. `fn_mark_shipped` is a logic regression on an admin-only path.

The suspected edited-after-apply files, and what the catalog can and can't show (it compares only final bodies,
grants and policies):

- 013, 014 (not on the suspect list): **confirmed**. Their cloud bodies match no committed version (above).
- 011: **confirmed** for `fn_purchase_credit` (2 commits, neither matches).
- 035 (proven earlier), 034, 036, 038: the final effect matches HEAD. ACLs and policies are identical after
  normalisation, and 034's config effect is consistent once the role that ran it is accounted for.
- 001, 007, 030, 032, 037, 048, 051, 057: every surviving function body equals the HEAD body (CRLF only).
  Edits to objects that a later migration replaced can't be detected from the catalog.

### 2. Privilege drift: SECURITY DEFINER functions, effective EXECUTE for anon/authenticated

Effective privilege is derived from proacl: PUBLIC, or the role itself (anon and authenticated have no role memberships).
I checked this derivation against `has_function_privilege` on all 226 replay functions: 0 mismatches.

- **cloud vs replay@058:** only `fn_purchase_card` and `fn_redeem_card` differ (cloud anon -/auth -, replay auth Y).
  075 explains both.
- **cloud vs replay@075** (what applying 059-075 changes): 9 SECURITY DEFINER functions lose EXECUTE.
  063 does this on purpose: it retires the legacy paths and replaces each body with a `PAYMENT_V2_LEGACY_PATH_RETIRED` raise.
  - auth Y -> -: `fn_accept_trade_offer`, `fn_cancel_listing`, `fn_confirm_sale_cancellation`, `fn_create_trade_offer`,
    `fn_reserve_credit`, `fn_vault_mark_defaulted`, `fn_vault_mark_shipped`, `fn_vault_receive`.
  - anon Y, auth Y -> -: `fn_list_card` (5-arg).

  No function gains anon/authenticated EXECUTE.
- For context (not drift; the repo and the cloud agree): the cloud has 66 SECURITY DEFINER functions.
  46 are executable by authenticated and 8 by anon:
  - `fn_approve_submission` (PUBLIC; guarded by `fn_require_admin()`)
  - `fn_current_user_id`, `fn_is_admin`
  - `fn_list_card` (PUBLIC; retired by 063)
  - `fn_sale_history_public` (no guard; public by design)
  - `fn_set_card_visibility` (PUBLIC; checks owner/admin)
  - `trg_sku_model_propagate`, `trg_vaulted_instant_release` (trigger functions, which can't be called directly)

### 3. The 059-075 exposure list (replay@075 with the cloud default ACLs)

pre001 reproduced the cloud defaults exactly (its self-check passed). For `postgres` and `supabase_admin` in public,
new tables get arwdDxtm, functions X and sequences rwU, granted to postgres/anon/authenticated/service_role.

Replay result:

- **Schema `payment_v2`:** ACL `{payment_v2_owner=UC/payment_v2_owner}`. anon/authenticated have no USAGE (059:36).
  The cloud has no default-ACL row for payment_v2, so default privileges never apply there.
- **payment_v2 tables (27) and sequences (3):** owner payment_v2_owner, RLS on, ACL owner-only.
  anon/authenticated have no SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, no column privileges
  and no sequence privileges.
- **payment_v2 functions (25):** owner-only ACL. They're unreachable anyway without schema USAGE.
- **Public functions created by 059-075** (all named `fn_payment_v2_*`, owner payment_v2_owner):
  - **Executable by authenticated: 11.** All are SECURITY DEFINER. Each grant is **explicit in 063's `$grants$` block**,
    not default-derived, and no later migration revokes any of them:
    - `fn_payment_v2_admin_obligations()`, `_admin_queue()`, `_approve_refund(uuid)`, `_attach_candidate(uuid,text)`
    - `_initiate(uuid,uuid,text,text)` [060, replaced in 066]
    - `_list_card(uuid,uuid,integer,text,integer)`, `_own_attempts(uuid)`
    - `_record_decision(jsonb)` [061, replaced in 067]
    - `_redeem_card(uuid,uuid,jsonb,bigint)`, `_request_cancel(uuid,uuid)`, `_review_dispatch(uuid,uuid,text,text,text,timestamptz)`

    Each is expected to do its own authorisation inside the SQL (not re-audited here).
  - **Executable by anon and authenticated, through an explicit PUBLIC grant in 063:**
    - `fn_payment_v2_legacy_guard()`: a trigger function, not SECURITY DEFINER, and not callable directly.
    - **`fn_payment_v2_managed(text,jsonb)`, which is SECURITY DEFINER.** It is a boolean oracle: given a card, item or
      listing UUID, it says whether that object is in v2 inventory or has a v2 sale. Low severity. PUBLIC is needed because
      the SECURITY INVOKER trigger calls it. It could be narrowed later by making the guard SECURITY DEFINER.
  - The other 26 `fn_payment_v2_*` functions are executable only by their worker role.
- **Public tables altered by 059-075:**
  - 063 revokes INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, plus column-level INSERT/UPDATE/REFERENCES, from
    PUBLIC/anon/authenticated/service_role on 9 tables: `cards, items, listings, orders, ledger_entries, redemptions,
    vault_intakes, card_provenance, trade_offers`.
  - **SELECT and MAINTAIN remain on those 9 tables** (both from the 001-era defaults).
  - 063 also grants the listed table privileges to `payment_v2_owner` and adds `payment_v2_owner_access` policies.
    Neither reaches anon/authenticated.
- **Grants on 059-075 objects that exist only because of Supabase default privileges: none for anon or authenticated.**
  - The `$seal$` blocks in 060/061/062 revoke ALL from PUBLIC/anon/authenticated/service_role on every public
    `fn_payment_v2_%` function. Each runs inside its migration's single transaction, and 063/068/069 repeat the revoke.
    So no committed boundary leaves a usable default grant. This comes from reading the transaction structure;
    intermediate states were not snapshotted.
  - The only surviving default-derived grant is **`postgres` EXECUTE** on the six SECURITY DEFINER functions created after
    063, because 068/069 revoke only from PUBLIC/anon/authenticated/service_role: `fn_payment_v2_ack_context`,
    `_attempt_context`, `_issuer_context`, `_read_chain_evidence`, `_store_chain_evidence`, `_verifier_context`.
- Line endings: 059-067 are CRLF in this worktree checkout (the index is LF), so their replay md5s include CR.
  Privileges are unaffected.

### 4. Proposed forward fixes (TEXT ONLY; no files written)

**URGENT, independent of 059-075: an existing cloud exposure found during this audit.**

`public.public_profiles` is a simple auto-updatable view over `public.users` with `security_invoker=false`, and
anon/authenticated hold `arwdDxtm` on it. That is the cloud ACL; the replay is identical.

- Read-only proof in the replay: as `anon`, `EXPLAIN UPDATE public.public_profiles SET handle=handle WHERE id=...` and
  `EXPLAIN DELETE FROM public.public_profiles ...` plan as `Update on users` / `Delete on users` with **no RLS filter**.
- Negative case: `EXPLAIN UPDATE public.users ...` as anon does get the RLS filter.
- `users` does not FORCE RLS, and its only trigger (`users_id_matches_auth`) checks only id=auth_id.

So through PostgREST, anyone holding the anon key can likely PATCH any user's `handle, level, xp_total,
portfolio_value_cents, show_collection, show_trade_history`, and DELETE any user that no FK references.
**This was not executed anywhere and not tested on the cloud.** The Supabase REST endpoint stays reachable while Vercel
is offline. The app only reads this view (`lib/api/contract.ts`, `components/auth/WelcomeForm.tsx`).

Proposed:

```sql
-- 076_public_profiles_read_only.sql
BEGIN;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.public_profiles, public.items_proof_overdue
  FROM PUBLIC, anon, authenticated;
DO $post$
DECLARE r text; v text; p text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v IN ARRAY ARRAY['public.public_profiles','public.items_proof_overdue'] LOOP
      FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF has_table_privilege(r, v, p) THEN RAISE EXCEPTION '076: % still has % on %', r, p, v; END IF;
      END LOOP;
      IF has_any_column_privilege(r, v, 'INSERT') OR has_any_column_privilege(r, v, 'UPDATE') THEN
        RAISE EXCEPTION '076: % still has column write on %', r, v; END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('anon', 'public.public_profiles', 'SELECT') THEN
    RAISE EXCEPTION '076: anon lost SELECT on public_profiles'; END IF;
END $post$;
COMMIT;
```

**(a) Bring the cloud's 001-058 drift to the intended state.**

First, a founder read-only query to resolve the four unknown bodies:

```sql
select p.oid::regprocedure, md5(p.prosrc), pg_get_functiondef(p.oid)
from pg_proc p
where p.oid in ('public.fn_confirm_shipment(uuid,text,text)'::regprocedure,
                'public.fn_mark_default(uuid,text)'::regprocedure,
                'public.fn_record_proof(uuid,jsonb)'::regprocedure,
                'public.fn_purchase_credit(uuid,bigint,text)'::regprocedure,
                'public.fn_mark_shipped(uuid,text,text)'::regprocedure);
-- plus: select indexdef from pg_indexes where schemaname='public' and tablename='sku_models';
```

Then `077_cloud_drift_catchup.sql`. CREATE OR REPLACE keeps the ACL. The definition below is the replay's
`pg_get_functiondef` of 014's body, including the SET from 034:

```sql
BEGIN;
-- repo catch-up: no-op on the cloud, makes a replay match it
ALTER TABLE public.sku_models
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS gender      text,
  ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS style_code  text;
-- duplicate of skus_art_url_https (identical definition)
ALTER TABLE public.skus DROP CONSTRAINT IF EXISTS skus_art_url_check;
-- cloud still runs the 009 body; restore 014's seller-held guard
CREATE OR REPLACE FUNCTION public.fn_mark_shipped(p_redemption_id uuid, p_carrier text, p_tracking text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_red redemptions%rowtype;
begin
  perform fn_require_admin();

  select * into v_red from redemptions where id = p_redemption_id for update;
  if not found then raise exception 'redemption % not found', p_redemption_id; end if;

  -- Seller-held parcels must go through fn_confirm_shipment, which is
  -- what credits the seller's fulfilment count.
  if v_red.fulfiller_id is not null then
    raise exception
      'redemption % is seller-held; use fn_confirm_shipment', p_redemption_id;
  end if;

  if v_red.status = 'shipped' then
    raise exception 'redemption % is already shipped', p_redemption_id;
  end if;

  update redemptions set
    status = 'shipped', carrier = p_carrier,
    tracking_number = p_tracking, shipped_at = now()
  where id = p_redemption_id;

  update items set status = 'shipped' where id = v_red.item_id;
end $function$;
COMMIT;
```

- `fn_confirm_shipment`, `fn_mark_default`, `fn_record_proof`: after the export, if their bodies differ in substance,
  re-issue the HEAD definitions (013/014 plus `SET search_path TO 'public'`) the same way.
- `fn_purchase_credit` needs no fix (063 retires it).
- The CRLF bodies need no fix.

**(b) Are 059-075 safe to apply to the cloud as written?**

**On privileges, yes.** No anon/authenticated grant on any 059-075 object comes from Supabase default privileges,
so **no 076+ migration to revoke default grants is required.**

Optional tidy-up (not security-critical):

```sql
REVOKE EXECUTE ON FUNCTION public.fn_payment_v2_ack_context(uuid), public.fn_payment_v2_attempt_context(text,text,text),
  public.fn_payment_v2_issuer_context(uuid,text), public.fn_payment_v2_read_chain_evidence(text,uuid,text),
  public.fn_payment_v2_store_chain_evidence(jsonb), public.fn_payment_v2_verifier_context(text,uuid) FROM postgres;
REVOKE MAINTAIN ON public.cards, public.items, public.listings, public.orders, public.ledger_entries, public.redemptions,
  public.vault_intakes, public.card_provenance, public.trade_offers FROM PUBLIC, anon, authenticated;
```

**Whether 059-075 will run on the cloud as written is NOT established.** Two blockers need clearing before any cloud apply:

1. **The role that runs them (UNVERIFIED).**
   - The replay ran as superuser `supabase_admin`. The cloud SQL editor runs as `postgres`, which in this image has
     `rolsuper=f`, with `createrole_self_grant` empty.
   - In PG16+, `CREATE SCHEMA payment_v2 AUTHORIZATION payment_v2_owner` (059:35) and the
     `ALTER ... OWNER TO payment_v2_owner` statements (063/068/069) require the executing role to be able to SET ROLE
     to payment_v2_owner.
   - By default, a role created by a non-superuser CREATEROLE role gives its creator ADMIN only, not SET.
     So 059 may fail atomically on the cloud.
   - Needed: a replay of 001-075 as `postgres` in a fresh isolated container (this needs a new authorization), plus a
     founder read-only `show createrole_self_grant;` on the cloud.
   - If a `GRANT payment_v2_owner TO postgres` becomes part of the procedure, note that 063's postflight does not check
     postgres's memberships.
2. **CRLF.**
   - 070:9, 071:10 and 072:9 compare `sha256(convert_to(prosrc,'UTF8'))` against fixed hashes **without** stripping
     `chr(13)`. 065/066/067 do strip it.
   - The cloud shows that SQL-editor pastes stored CRLF. If 068/069 are pasted the same way, 070-072 will refuse.
     They fail closed, but they block.
   - Apply from LF files with `psql -f`, or confirm `position(chr(13) in prosrc)=0` after 068/069.

### Not verified / limits

- Cloud privileges were derived from the exported ACL text, not from `has_*_privilege` on the cloud.
  The derivation method was checked on the replay.
- The public_profiles exposure is proven only at plan/permission level, and only in the replay. Nothing was executed.
  The cloud behaviour is inferred from the identical ACLs and view definition (042).
- Intermediate privilege states (between migrations) were not snapshotted. The argument rests on each migration being a
  single transaction with its seal inside it.
- Indexes, sequences in public, and the cloud's extension placement are outside the inventory query.

Artifacts (outside the repo): the scripts, logs, inventories (`inv-058.txt`, `inv-075.txt`), diffs and `privs-075.json`
are in the review ZIP in `C:\Users\Family\flexsoar-reviews\` (named in the report).

## 2026-10-21 - Forward migrations 077 and 078 authored and tested (isolated replay only; NOT applied to cloud)

Founder authorization (AGENT_RULES §2 exception, this task only): create `077` and `078` and execute them only in the
replay container `flexsoar-schema-replay-20261021-0031`. No cloud access, no network, no npm install.

### Files

- `supabase/migrations/077_drift_repair_and_null_identity_guards.sql`. Starts from the **cloud** state (001-058 + 075 + 076,
  with 013/009-era bodies). Apply it **before** 059-074. Its preguard pins every body it replaces to the founder export
  `cloud-unknown-bodies-20261021.csv` (sha256 `f6c95f85…c2f524e3`), using CR-stripped md5. A numeric 001→078 replay
  therefore stops at 077 by design.
- `supabase/migrations/078_vaulted_requires_authentication.sql`. Requires 059-074. Self-relative fragment repair in the
  style of 074.

### 077: what changed, and why

All five CSV bodies hash exactly to the cloud inventory md5s (as CRLF). The cloud's `fn_confirm_shipment`,
`fn_record_proof` and `fn_mark_default` are **013** bodies (014 never landed for them), and `fn_mark_shipped` is **009**'s.

Null-identity audit: every SECURITY DEFINER function in the cloud state that derives the caller from
`users.auth_id = auth.uid()`, directly or through `fn_current_user_id()`. The list was taken from the live catalog,
not grep.

| Function | Compares | Fails open? | Action |
|---|---|---|---|
| fn_confirm_shipment | fulfiller_id (nullable) IS DISTINCT FROM caller | **YES**: no-users-row session ships a warehouse parcel (proven) | null refusal |
| fn_record_proof | custody_holder_id (nullable) IS DISTINCT FROM caller | guard yes; blocked downstream by admin-only fn_set_item_photos | null refusal |
| fn_require_actor | caller IS DISTINCT FROM p_claimed (param) | **YES**: with p_actor NULL, fn_cancel_listing then tests `seller_id <> NULL` and cancels ANY listing (proven) | null refusal in the session branch |
| fn_require_self_or_admin | caller IS DISTINCT FROM p_user | guard yes; no effect (balance of NULL = 0) | null refusal (it is a guard) |
| fn_resolve_trade_offer | `recipient_id <> v_user` / `initiator_id <> v_user` | **YES**: `<>` NULL skipped both raises; any open offer resolved and its hold released (proven) | null refusal |
| fn_payout_method_for_user | caller IS DISTINCT FROM p_user | guard yes; the body then raises 'no country' | none (refused, proven) |
| fn_release_credit_hold, fn_set_card_visibility, fn_vault_mark_shipped, fn_mark_notification_read | NOT NULL columns, or a null check first | no | none |
| fn_list_card, fn_redeem_card, fn_cancel_listing (via fn_require_actor) | `<>` after the helper | fixed by the helper; retired by 063 | none |
| fn_purchase_card_core | caller IS DISTINCT FROM p_buyer_id | service_role-only after 075 | none |
| fn_submit_listing, fn_reserve_credit, fn_set_country, trade create/accept, fn_ensure_sku_variant | null check first | no | none |

New refusals all raise `sign in to …` with SQLSTATE 42501. `lib/db/errors.ts` maps 42501 to FORBIDDEN. **track/data**
may want UNAUTHENTICATED rules for: `sign in to confirm a shipment`, `sign in to record proof`, `sign in to act on this account`,
`sign in to read a balance`, `sign in to resolve a trade offer`.

Also:

- (b) `fn_mark_shipped` gets 014's seller-held guard back.
- (c) `fn_purchase_credit(uuid,bigint,text)` is dropped. The preguard proves no body references it and nothing depends on it.
  063's retirement loop is driven by name, so it is unaffected.
- (d) `sku_models.external_id/gender/style_code text` and `source text NOT NULL DEFAULT 'manual'` are added IF NOT EXISTS,
  with the existing-definition check.
- (d) `skus_art_url_check` is dropped after proving it is an exact duplicate of `skus_art_url_https`: same contype `c`,
  identical `pg_get_constraintdef` (md5 `c2915a82…`), both validated, same `connoinherit`.

Owner, ACL, SECURITY DEFINER and `search_path=public` are asserted unchanged. One overload each. EXECUTE stays
{authenticated, service_role} with no anon access. Each new body's md5 is pinned in the postguard.

### 078: decisions

- **prepare_sale (060:96)**: mode is derived as seller → 0, warehouse AND authenticated_at → 1, anything else → `SALE_FENCED`.
  The item row is already locked by `lock_card`.
- **correspondence (063:41)**: the inventory branch uses the same derivation. Quarantine stays the storage-only exception.
- **record_attestation (061:153)**: KEEP warehouse custody on receipt (it is the truthful physical location), but CLEAR
  `authenticated_at/by` in the same update.
  - Why: an escrow sale is mode 0, so the item was seller-held. Any timestamp it carries came from seller review
    (`fn_approve_submission`, 041:54).
  - The baseline proved the problem: receipt alone made the item `vaulted=true` while the card was still pending_vault,
    and it **stayed vaulted after an authentication FAIL and refund**.
  - Release re-stamps the timestamp from the attested pass.
  - No-window argument: between receipt and release the card is pending_vault, the listing is sold, the buyer holds the
    claim, the sale fence is up and inventory is mode 0. After a refund, inventory is quarantined. Prepare refuses mode 1
    without the conjunction.
- **050 trg_vaulted_instant_release**: DETACHED and dropped.
  - Proof, from the catalog and in the preguard: after 063 the only body that inserts orders is
    `fn_payment_v2_reconcile_event`, which passes `seller_payout`/`payout_release_at` NULL (the trigger returns at its first
    IF), and anon/authenticated/service_role have no INSERT on orders.
  - Its only remaining reach was a manual owner SQL insert. The baseline showed that insert's 7-day hold zeroed for a
    warehouse item.
- 078 refuses if any network has funding enabled, or if any unquarantined inventory row violates the new rule.

### Test run (container `6ef7375a…`, PG 17.11, verified Id / NetworkMode none / PortBindings {} / Privileged false / 3 ro mounts / lo only before each step)

Founder rulings this session:

1. The hash-verified prereq is streamed with only line 18's DB-name literal substituted (orig `4295d81f…`,
   stream `fffc8553…`).
2. Ownership is normalised to the cloud's owners: 125 public objects to postgres (83/83 function owners now match the
   cloud), and the test DB owner set to postgres, as the `postgres` DB is in this image.
3. 059-074, and 078 as a fallback, were run as supabase_admin when postgres failed.
4. 077 uses minimal guards on the cloud bodies.
5. The drift-audit DB `flexsoar_schema_replay_20261020` and its six payment_v2 roles were dropped (evidence is in the
   486369d ZIP; 0 shdepend).

DB: `flexsoar_mig_test_20261021`. Sequence:

1. pre001, 001-058 (+pre022b/pre052), 075, 076 as supabase_admin.
2. The 5 cloud bodies loaded verbatim from the CSV, plus the cloud-only `skus_art_url_check`.
3. Ownership normalised.
4. 077 as **postgres**.
5. 059 as **postgres**, which failed.
6. 059-074 as supabase_admin.
7. 078 as **postgres**, which failed.
8. 078 as supabase_admin.

Results:

- **077 as postgres: rc=0.** The first attempt failed with `permission denied for schema public` and rolled back atomically.
  Cause: the test DB was owned by supabase_admin, so postgres had no CREATE through pg_database_owner. That is
  replay-only; it was fixed by ruling 2. A re-apply is refused by the preguard (`fn_mark_shipped … found md5 682fc945…`).
- **059 as postgres: FAILS atomically.** It got through the preflight and six `CREATE ROLE`s, then hit
  `ERROR: must be able to SET ROLE "payment_v2_owner"` at `CREATE SCHEMA payment_v2 AUTHORIZATION payment_v2_owner`
  (059:35). No roles or schema were left behind. `createrole_self_grant` is empty and postgres is NOSUPERUSER CREATEROLE.
- **078 as postgres: FAILS atomically** with `must be owner of function fn_payment_v2_record_attestation` (owner
  payment_v2_owner).
- **Proposal (minimal; no migration edit; not tested end-to-end):** run 059 in a session with
  `createrole_self_grant = 'set, inherit'`, e.g. `PGOPTIONS="-c createrole_self_grant=set,inherit" psql -X -v ON_ERROR_STOP=1 -f 059…`
  or a first line `SET createrole_self_grant = 'set, inherit';` in the editor session.
  - Rolled-back probes with a throwaway role, as postgres:
    - default → the same 059 error;
    - `'set'` → schema and OWNER TO succeed, but a later CREATE OR REPLACE of an owner-owned function fails
      `must be owner` (this would break 064-074 and 078);
    - `'set, inherit'` → all three succeed.
  - Consequence: postgres becomes a SET+INHERIT member of all six payment_v2 roles. 063's postflight does not check
    postgres. Worker RPCs still refuse postgres because `require_role` requires exactly one worker membership for
    non-superusers. Optionally `REVOKE payment_v2_issuer, payment_v2_verifier, payment_v2_settler, payment_v2_executor,
    payment_v2_notifier FROM postgres` after 063.
  - Founder read-only prerequisites: `show server_version; show createrole_self_grant;` on the cloud.
- **077 checks: 30/30 before, 30/30 after.** Each check is one rolled-back transaction under a simulated PostgREST
  session (SET LOCAL ROLE + `request.jwt.claims`).
  - Before (cloud bodies) proves the fail-opens: a ghost session ships a warehouse redemption, cancels a listing and
    resolves trade offers; an admin can mark a seller-held parcel shipped.
  - After: each is refused with 42501 and has no side effect. Holder, admin, recipient/initiator and service_role paths
    still succeed.
  - Rerun on the final 001-078 DB: 24/30 identical. The 6 differences are 063's retirement of
    fn_cancel_listing/fn_list_card (`permission denied`).
- **078 checks: 12/12 before (074 state), 12/12 after.** Synthetic v2 fixtures were ported from
  tests/payment-db/01/02, plus retained-chain evidence for 068/069.

  | Scenario | 074 | 078 |
  |---|---|---|
  | warehouse+authenticated → prepare | mode 1 | mode 1 |
  | warehouse+NULL enrolled mode 1 → prepare | **mode 1 (direct sale)** | `PAYMENT_V2_CORRESPONDENCE: inventory` |
  | enrolled authenticated, stamp cleared, then prepare | **mode 1** | `PAYMENT_V2_SALE_FENCED` |
  | seller (with/without lister stamp) → prepare | mode 0 | mode 0 |
  | seller+stamp enrolled mode 1 / warehouse+NULL enrolled mode 0 | refused | refused |
  | quarantined warehouse+NULL → prepare | SALE_FENCED | SALE_FENCED |
  | escrow receipt (lister-stamped item) | **vaulted=true**, pending_vault | vaulted=false, pending_vault |
  | receipt + auth pass + release + ack | attested, mode 1, active | attested, mode 1, active |
  | receipt + auth fail + refund | **vaulted=true**, quarantined | vaulted=false, quarantined |
  | manual cash order, warehouse item | **hold released now** | hold kept |
- `npx tsc --noEmit` rc=0. `npm test`: 20 files, **535/535**. `npm run build` rc=0.

### Not verified / open

- The cloud's real ACL, owner and `datdba` were taken from the founder export and from this image, not from has_*_privilege
  on the cloud. Whether `postgres` can `SET createrole_self_grant` on the cloud's PG version is unverified.
- Cloud indexes on the four sku_models columns are unknown (indexes are outside the inventory). 077 creates none.
- **tests/payment-db/01_fixtures.sql** builds mode-1 fixtures as warehouse items with **NULL authenticated_at**. After 078
  they are refused by correspondence (by design). Updating them is outside this lane: the fixture's item insert needs
  `authenticated_at` for mode 1.
- Data audit still recommended before enrolling legacy warehouse items. The conjunction trusts the columns, and
  legacy timestamps include seller-review stamps (Codex analysis §3, founder query).
- The app's error mapping for the new `sign in to …` strings belongs to track/data (above). The `fn_approve_submission`
  stamping of `authenticated_at` on seller review (041:54) remains, and is now neutralised at receipt only.

## 2026-10-21 - Staging rehearsal of the production plan (059-078 on Supabase `flexsoar-staging`, as `postgres`)

Founder authorization: AGENT_RULES §2 "Staging exception" (commit `3b96192`), this task only. Target: Supabase project
`flexsoar-staging` (ref `krkydvvvtszceutprfmy`), PostgreSQL **17.11**, empty, `staging_marker` schema present. Production is
**17.6** (see "Version gap"). No production connection was made. The URI was read from the secrets file by a wrapper and never
printed. A scan of every log and artifact found no occurrence of the password or the URI.

### Method

- **Wrapper, before connecting:** the wrapper refuses unless `krkydvvvtszceutprfmy` is in the URI host or user. It matched in the
  user (`postgres.<ref>`, session pooler). Credentials go to psql through PG* environment variables, never through argv.
- **In-session guard, first in every session (ON_ERROR_STOP):** stops unless `staging_marker` exists with its comment,
  `auth.users` has 0 rows, and `current_user` and `session_user` are both `postgres`. Negative tests: a wrong ref was refused
  before connecting, and a missing marker raised before the next statement.
- **Files:** applied with `psql -X -v ON_ERROR_STOP=1 -f`, one session per file, from LF copies taken from git blobs.
  059-067 are CRLF in this worktree's checkout but LF in the index.
- **Connection failures:** the pooler dropped 4 connections during setup (`SSL error: unexpected eof` / `server closed the
  connection unexpectedly`), at 011, 026, 067 and the first step-3 query, always before any session existed. Only that case was
  retried. After the 011 drop, a read-only check confirmed 011 had left nothing behind.

### 1. Reproducing production

| Step | Result |
|---|---|
| 001-058 | rc=0 for all. Needed only the founder-ruled pre-022b `DROP FUNCTION fn_list_card(uuid,uuid,integer,payout_method)`. 052 needed nothing: `supabase_realtime` already exists. |
| 5 production bodies (from `cloud-unknown-bodies-20261021.csv`, sha `f6c95f85…`, CRLF verbatim) | md5, owner, SECURITY DEFINER flag, search_path and ACL all equal the production export for all 5. |
| 075, 076 | rc=0. |
| 077 | rc=0. **The preguard passed**, which proves 077 matches production's starting state. Its only NOTICE: `skus_art_url_check` does not exist (staging never had it). |

Residual drift, production export (taken 2026-10-20 at 001-058 + drift + 075) vs staging@075:

- **Only in production (5):** the 4 `sku_models` columns and `skus_art_url_check`. 077 adds the columns; after 077 they equal
  production's definitions exactly. 077 drops production's constraint.
- **CRLF only:** 75 bodies equal once LF→CRLF. Three more (`fn_require_actor`, `fn_require_self_or_admin`,
  `fn_resolve_trade_offer`) differ only by CRLF; 077's preguard pins their CR-stripped md5s.
- **ACL order:** `fn_is_admin` has the same grantees in a different order.
- **Nothing else differs:** no tables, columns, constraints, triggers, enums or policies.
- **Not covered by the inventory:** indexes and column order.
- **Not exercised on staging:** 077's "columns already exist" branch, which only production takes.

### 2. The rehearsal (what production runs next)

- **059** ran in one session with `SET createrole_self_grant = 'set, inherit';`. rc=0; the setting was confirmed `set, inherit`
  in-session, and a new session's default is still `''`.
  - 059:37 printed `WARNING: no privileges were granted for "auth"`. This is expected on Supabase: `postgres` holds USAGE on
    `auth` without grant option (`postgres=U/supabase_admin`).
  - Memberships created for `postgres` on all six roles: one row `[ADMIN] by supabase_admin` and one row `[INHERIT,SET] by postgres`.
- **060-067** passed without the setting. **No other file needs it:** none of 060-078 creates a role.
- **068 FAILED** atomically (rolled back, objects confirmed absent):
  `ERROR: permission denied for schema public / CONTEXT: ALTER FUNCTION fn_payment_v2_ack_context(uuid) OWNER TO payment_v2_owner`.
  - Cause: 063:177 revokes CREATE on public from `payment_v2_owner`. 068 creates new public functions and transfers them to
    `payment_v2_owner`, and the new owner needs CREATE on the schema. Superusers skip that check, which is why the container
    runs (as supabase_admin) passed. 069:80 has the same pattern.
  - **Founder decision:** bracket 068/069.
- **`payment_v2.actor()` was unusable on Supabase.** It is owned by `payment_v2_owner` and read `auth.uid()`, and 059:37 could
  not grant `payment_v2_owner` USAGE on `auth`. A rolled-back simulated signed-in call returned
  `42501 permission denied for schema auth` (context `payment_v2.actor() line 3`). Every caller-resolving v2 RPC failed closed.
  **Founder decision:** a new migration, 069c.
- **New forward migrations** (this track; none of 001-078 was edited):
  - `067b_payment_v2_owner_create_on_public.sql`: `GRANT CREATE ON SCHEMA public TO payment_v2_owner`.
    - Preguard: owner NOLOGIN/NOSUPER, 059-067 applied, 068 not applied, owner lacks CREATE, no worker is a member of owner.
    - Postguard: the grant took effect.
  - `069b_payment_v2_owner_revoke_create_on_public.sql`: revokes the grant and asserts
    `has_schema_privilege('payment_v2_owner','public','CREATE')` is false.
    - Idempotent (run twice on staging, both rc=0), standalone, and checks nothing about 068/069.
    - **If 068 or 069 fails, run 069b immediately.**
  - `069c_payment_v2_actor_current_user_id.sql`: the only change to `actor()` is replacing
    `SELECT id INTO v FROM public.users WHERE auth_id=auth.uid();` with `v:=public.fn_current_user_id();`, plus
    `GRANT EXECUTE ON FUNCTION public.fn_current_user_id() TO payment_v2_owner`. Self-relative, in the style of 074/078.
    - Preguard: one `actor()` overload with the 060 owner/definer/search_path; the fragment occurs exactly once; no other `auth.`
      reference; `fn_current_user_id()` is the 004 body (CR-stripped md5 `58bf7a57…`), definer, owned by postgres,
      `search_path=public`; the `users_id_matches_auth` trigger is enabled with the 004 body (md5 `4893a65a…`); zero users rows
      with `id <> auth_id`.
    - Postguard: all metadata identical except the body; no `auth.` reference left; one overload; owner can execute
      `fn_current_user_id()`; anon/authenticated cannot reach `actor()`.
    - Production's export has identical CR-stripped bodies for both pinned functions. Re-applying 069c refuses.
    - Why 069c and not folded into 069b: 069b must stay the minimal emergency revoke.
    - Why number 069c and not 074b: `actor()` is defined only in 060, and nothing in 061-078 replaces, re-owns or re-grants it,
      so apply order equals filename order.
- **Sequence that passed:** 067b, 068, 069, 069b, 069c, 070, 071, 072, 073, 074, 078. All rc=0, no WARNING/NOTICE. The body-hash
  guards in 070-072 passed on the LF copies. 078's guards passed: no network has funding enabled, and inventory is empty.
- **The users.id = auth_id condition (founder):**
  - **The invariant is enforced, not assumed.** 004:96-107 `trg_users_id_matches_auth` (BEFORE INSERT OR UPDATE on users)
    raises if `auth_id IS NOT NULL AND id <> auth_id`.
  - Provisioning sets both: `lib/db/provision.ts:219` inserts `{ id: authUser.id, auth_id: authUser.id }`, and 006/040's
    `users_self_insert` checks `auth_id = auth.uid() AND id = auth.uid()`.
  - Rows with a NULL `auth_id` (seeds/imports) can never match `auth.uid()`.
  - `fn_current_user_id()` (004:25) runs exactly the query the old `actor()` ran, so `actor()` still returns `users.id`, never
    the auth id. The swap changes which role reads `auth`, not the value.
  - Every place `actor()`'s result is compared or stored (final catalog, 11 functions):
    - `staff.user_id` in `admin_obligations`, `admin_queue`, `approve_refund`, `review_dispatch`, `record_decision`;
    - `attempts.buyer_id` in `attach_candidate`, `own_attempts`, and `initiate` (lookup and insert);
    - in `initiate` also: `sales.seller_id`, `users.id` (country check), `wallet_accounts.user_id`, and the `sha256(uuid_send(u))`
      attempt commitment;
    - the client-supplied parameters `p_seller_id` (`list_card`), `p_user_id` (`redeem_card`) and `p_actor` (`request_cancel`).
    - All of them are `users.id`-domain values.
  - Rolled-back probe after 069c:
    - signed-in caller with a users row: `fn_payment_v2_own_attempts` returns `[]`;
    - session whose sub has no users row: `42501 PAYMENT_V2_SIGN_IN`;
    - no claims at all: `42501 PAYMENT_V2_SIGN_IN`. Consistent with 077.
- **Worker membership (founder decision: no 079).** `postgres` keeps `[ADMIN] by supabase_admin` on every payment_v2 role, and
  only a superuser can revoke that. With ADMIN, `postgres` could grant itself SET/INHERIT again at any time, so revoking those
  rows would be cosmetic.
  - The real boundary is `require_role` (060:5-9): a non-superuser session must hold exactly one worker role and must NOT be a
    member of `payment_v2_owner`, `service_role`, `authenticator`, `authenticated` or `anon`. `postgres` is a member of the last
    four (and of `payment_v2_owner`).
  - Proven on staging: every worker-gated 078 scenario was refused for `postgres` with
    `42501 PAYMENT_V2_DEDICATED_CONNECTION_REQUIRED`, although `postgres` holds SET+INHERIT on all five worker roles.
  - `postgres` must keep SET+INHERIT on `payment_v2_owner`: 068 runs `SET LOCAL ROLE payment_v2_owner`, and CREATE OR REPLACE
    of owner-owned functions requires ownership privileges.

### 3. Verification on staging (read-only unless noted)

- **anon/authenticated (effective has_*_privilege) on everything 059-078 created** (62 functions, 27 tables, 3 sequences, schema
  `payment_v2`): exactly **13 functions**, all from 063's explicit `$grants$` block, and nothing unexpected:
  - authenticated only: `fn_payment_v2_admin_obligations`, `_admin_queue`, `_approve_refund`, `_attach_candidate`, `_initiate`,
    `_list_card`, `_own_attempts`, `_record_decision`, `_redeem_card`, `_request_cancel`, `_review_dispatch`;
  - PUBLIC (anon and authenticated): `fn_payment_v2_managed(text,jsonb)` and `fn_payment_v2_legacy_guard()`.
  - No table, sequence, column or `payment_v2` schema privilege.
- **Funding:** `payment_v2.networks` has 0 rows, 0 with `funding_enabled`, and the column default is `false`.
- **077 checks** (unmodified `checks077.py`, rolled-back simulated PostgREST sessions, no worker login): all 30 ran. Their RESULT
  and SIDE lines are **identical** to the container's final 001-078 run: 24/30 against the "after" expectations, and the 6
  differences are 063's intended retirement of `fn_cancel_listing`/`fn_list_card`.
- **078 checks** (unmodified `checks078.py`): the 4 that need no worker login passed:
  - three correspondence refusals: enrol+prepare warehouse unauthenticated mode 1, seller+stamp mode 1, warehouse NULL mode 0;
  - the manual cash order on a warehouse item keeps its hold.
  - The other 8 need a dedicated worker login (refused for `postgres`, as above) and were not run end-to-end here.
  - All harness data rolled back; afterwards users, networks, inventory, staff and orders all have 0 rows.
- **Post-migration fingerprint** (`inventory-query.sql`, unmodified): **1295 objects**, sha256
  `45f34be99f5fc6435fa6e50c3c086c379149b06b946dce9794dc38d0ec335cc4`, kept in the review ZIP.
- **The runbook's read-only `verify-post.sql`** returns V1-V9 on staging:
  - V1-V2: the 13 grants above; funding off.
  - V3: 27 tables, 3 sequences, 25 payment_v2 functions, 37 public `fn_payment_v2_*`, RLS on for all of them.
  - V4: owner has no CREATE on public, no `auth` access; it can execute `fn_current_user_id`; `actor()` has no `auth.` reference.
  - V5: memberships as above.
  - V6: CR-stripped body md5s.
  - V7: `vaulted_instant_release` gone, `fn_purchase_credit` gone, 0 legacy functions executable by authenticated.
  - V8: invariant holds.
  - V9: a session with no users row gets PAYMENT_V2_SIGN_IN.
- **Non-secret identifiers `postgres` can read:**
  - `pg_control_system().system_identifier` = **7692131729119822239** on staging. Unique per cluster; the production guard pin.
  - `cluster_name` = `main` and `current_database()` = `postgres`. Generic, not useful as pins.
  - Also readable: `data_directory`, `config_file`, `hba_file`.

### Version gap: staging 17.11 vs production 17.6 (same major)

What this plan relies on, and whether a minor release could change it:

- `createrole_self_grant` and the `inherit`/`set` options in `pg_auth_members`: PG16+ features, unchanged across 17.x.
- The new-owner CREATE check in ALTER ... OWNER: long-standing behaviour.
- `has_*_privilege` semantics and `pg_get_functiondef` output, which 069c uses for fragment replacement: stable within a major.
- None of these is plausibly different in 17.6, but none was tested on 17.6.
- **The larger risk is platform configuration, not the version.** The runbook's preflight therefore compares production's
  `public`/`auth` ACLs, the `pg_default_acl` fingerprint (24 rows, md5 `79ee8190…`), the `postgres` role attributes and
  memberships, and the pinned function bodies against staging before anything is applied.

### Production runbook

`C:\Users\Family\flexsoar-reviews\prod-runbook-059-078.md`, with supporting files in
`C:\Users\Family\flexsoar-reviews\prod-runbook-059-078\`:

- `prod.py`: wrapper. `<PROD-REF>` placeholder; refuses the staging ref and the staging URI.
- `prod-guard-readonly.sql`: read-only session guard for steps 0 and 7.
- `prod-guard.sql`: write session guard. `<PROD-SYSID>` placeholder; refuses the staging cluster.
- `preflight-prod.sql`, `verify-post.sql`, `prod-common.sh`, `export-lf.sh`.
- `manifest-lf.sha256`: the 20 file hashes that passed on staging.

Negative tests against staging: the production wrapper refused the placeholder, the staging ref and the staging URI before
connecting. The production guards raised inside a real staging session for: `staging_marker` exists, placeholder pin,
pin = staging cluster, pin ≠ actual cluster.

### Not verified / open

- **End-to-end worker RPCs on Supabase:** 8 of the 12 078 scenarios and every worker role path need a dedicated worker login,
  which this task did not create. Their privileges are as designed (V1/V5 and the 078 postguard grants), but no call was made.
- **Production values** (`system_identifier`, ACLs, users invariant): the runbook makes the founder read and compare them first.
- **077's "columns already exist" branch** was not exercised on staging; production takes it. The container test covered it.
- **Supabase dashboard role:** whether the SQL editor's session is the same `postgres` setup as the pooler was not re-checked.
  The runbook uses psql, not the editor (070-072 also require LF).
- **Indexes** are outside the inventory, so production's indexes on the four `sku_models` columns are still unknown.
- **`graphify update .`** was not run. It would rewrite tracked graph files outside this task's allowed commit set.
- **Staging state at hand-off:** 001-078 plus 067b/069b/069c applied, no data, `staging_marker` intact.

## 2026-10-21 - Production apply of 059-078 (+067b/069b/069c), founder-run

Recorded from the founder's report. **No agent had database access for this section**, and nothing below was re-checked by an agent.

### What was run

- **Who, when:** the founder, against production, 2026-10-21 06:38-06:42 UTC, using `C:\Users\Family\flexsoar-reviews\prod-runbook-059-078.md`
  (sha256 `1bd198e2…05d4b22`). Migration files were exported as LF from commit `ff3e422` and verified against `manifest-lf.sha256`.
- **Backup first:** the public schema was dumped before any write (511,926 bytes). The founder keeps it privately; it is not in
  the repo.
- **Guards:** every session went through the runbook's wrapper and guards. The production project ref is recorded only in the
  runbook's `prod.py`, outside the repo.
  - **Production cluster pin (for future production guards):** `pg_control_system().system_identifier` = **7666007964130682852**.
  - Staging is `7692131729119822239`.
- **Order:** 059 (with `SET createrole_self_grant = 'set, inherit';` in the same session), 060-067, 067b, 068, 069, 069b, 069c,
  070-074, 078.
  - Every file reported `rc=0 guard_ok=1 error_lines=0` and ended with `COMMIT`.
  - The only warning was the expected 059:37 `no privileges were granted for "auth"`.
  - After 069b: `owner CREATE on public: false`.

### Preflight (step 0)

Every P-line matched the runbook's expected values, with two exceptions:

- **P4 `pg_default_acl`:** production has **rows=27, md5=a40277f9cab4d54f9ceeea2baac0316c**; staging has 24 (md5 `79ee8190…`).
  - The 3 extra rows are the **cron** schema, per the founder's earlier full `pg_default_acl` export: for_role `supabase_admin`,
    in_schema `cron`, types S/f/r, grants to `postgres` only.
  - The `public`, `auth` and `extensions` rows matched staging.
  - The architect accepted it. Nothing in 059-078 touches the cron schema.
  - The runbook's "24 rows" expectation was staging's and was wrong for production; correct it in any future runbook.
- **P2 / P7 (informational, noted):** `auth.users=6` vs `public.users=4`. The 2 extra are unfinished sign-ups with no users row.
  The 069c precondition `id_ne_auth_id=0` held.

### Post-apply verification (step 7, `verify-post.sql`, read-only)

**Every V1-V9 line was identical to the runbook's expected output**, which is the staging output:

- V1: anon/authenticated reach only 063's 13 explicit grants (11 authenticated-only, plus `fn_payment_v2_managed` and
  `fn_payment_v2_legacy_guard` via PUBLIC).
- V2: no networks, funding off.
- V3: 27 payment_v2 tables, 3 sequences, 25 payment_v2 functions, 37 public `fn_payment_v2_*`, RLS on for all.
- V4: `payment_v2_owner` has no CREATE on public and no USAGE on auth; it can execute `fn_current_user_id()`; `actor()` has no
  `auth.` reference.
- V5: `postgres` holds `[A] by supabase_admin` + `[IS] by postgres` on all six payment_v2 roles; worker membership is kept on
  purpose (no 079).
- V6: CR-stripped body md5s equal staging's.
- V7: `trg_vaulted_instant_release` and `fn_purchase_credit` are gone; 0 legacy functions executable by authenticated.
- V8: `id_ne_auth_id=0`, trigger enabled.
- V9: a session with no users row gets `42501 PAYMENT_V2_SIGN_IN`.

### Production migration ledger (applied order; it is NOT the filename order)

1. **001-058**, applied earlier through the dashboard SQL editor, in filename order:
   001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019a, 019b, 019c, 020, 021, 022,
   022b, 022c, 023a, 023b, 023c, 024a, 024b, 024c, 024d, 024e, 024f, 025, 026, 026b, 027, 028, 029, 030, 031, 032, 033, 034, 035,
   036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053, 054, 055, 056, 057, 058.

   **Production's 001-058 state is drifted from the repo**, per "2026-10-21 - Cloud schema drift audit" above:
   - Five function bodies ran as older or edited versions:
     - `fn_mark_shipped` was 009's;
     - `fn_confirm_shipment`, `fn_mark_default` and `fn_record_proof` were uncommitted 013-era bodies;
     - `fn_purchase_credit` was an unknown 011 body.

     077 later replaced or dropped all of these except `fn_mark_default`, which remains the production 013-era body.
   - `sku_models.external_id/gender/source/style_code` exist with no migration creating them, and the duplicate
     `skus_art_url_check` existed (077 dropped it).
   - The 4-arg `fn_list_card(uuid,uuid,integer,payout_method)` was already gone before 022b.
   - 052's `supabase_realtime` publication is platform-provided.
   - Every app function body is stored with CRLF (the SQL-editor paste path).
   - 034's search_path loop skipped the citext functions, because it ran as `postgres`.
2. **075** `revoke_legacy_purchase_redeem`
3. **076** `revoke_view_writes`
4. **077** `drift_repair_and_null_identity_guards` (075-077 founder-applied and verified before this session)
5. **059** `payment_v2_records` (session `createrole_self_grant = 'set, inherit'`)
6. **060** `contracts`, **061** `settlement`, **062** `recovery`, **063** `permissions_fences`, **064** `exact_integer_encoding`,
   **065** `table_specific_terms`, **066** `exact_usdc_fee`, **067** `decision_column_alias`
7. **067b** `owner_create_on_public` (bracket open)
8. **068** `contexts_evidence`, **069** `attempt_context_parsed_evidence`
9. **069b** `owner_revoke_create_on_public` (bracket closed)
10. **069c** `actor_current_user_id`
11. **070** `context_governance_order`, **071** `rpc_metadata_encoding`, **072** `ack_context_revision`, **073** `evidence_decision_column`,
    **074** `verifier_context_attempt_alias`
12. **078** `vaulted_requires_authentication`

059-078 were applied as LF via psql, so their bodies are LF, unlike 001-058. Every file in `supabase/migrations/` (93) is now
applied in production. A numeric 001→078 replay on an empty database stops at 077 by design (its preguard pins the drifted
production bodies), so replays must reproduce the drift first, as the staging rehearsal did.

### Open (unchanged by this apply)

- **Funding is off** and no network exists. Worker logins and an end-to-end worker RPC run on Supabase are still unproven.
- **track/data:** UNAUTHENTICATED error mapping for the `sign in to …` strings (077) and for `PAYMENT_V2_SIGN_IN`.
- **tests/payment-db/01_fixtures.sql** builds mode-1 fixtures with a NULL `authenticated_at`, which 078 refuses (outside this lane).
- **`fn_mark_default`** still carries the production 013-era body (not repaired by 077; behaviour unaudited).
- **Indexes** on the four `sku_models` columns are still unknown.

## 2026-10-22 - Migration 079: seller review is not authentication; fn_mark_default audit (staging applied; production NOT touched)

Founder authorization (this task only): author `079` on `track/payment-security` and apply/test it only on Supabase
`flexsoar-staging` (ref `krkydvvvtszceutprfmy`) through the guarded staging wrapper. Lanes widened for this task:
`tests/payment-db/**` and `lib/db/errors.ts` (plus its tests). **No production connection was made.**

Pre-flight: the first run stopped (AGENT_RULES §0). `main` had `d7a755c`, an empty deploy-trigger commit that the branch
lacked. The founder merged `fd72bc7` into main and fast-forwarded the branch. Re-run: HEAD == main == `35aa1d4`,
`git log HEAD..main` empty.

### 079_review_approval_is_not_authentication.sql

Founder rule: `items.authenticated_at` means FlexSoar physically holds the pair AND has authenticated it.

| Function | Before | 079 |
|---|---|---|
| `fn_approve_submission` (041:54) | Seller review stamped `authenticated_at/by`. | Stamps the new `items.review_approved_at/by`; no `authenticated_*` reference left. |
| `fn_mint_card` (027) | Required `authenticated_at` for every item; approval passed it with its own stamp. | Custody `seller` requires `review_approved_at` (`item % is seller-held and has not been approved in review`). Any other custody still requires `authenticated_at` (unchanged message; fails closed for a future custody value). |
| `fn_authenticate_item` (008) | Stamped any item in `pending_intake`/`in_custody`, whatever its custody. | Refuses custody other than `warehouse` (`item % is seller-held, cannot be authenticated`). |
| `fn_mark_default` (production 013-era body) | No status check; a NULL note erased `grading_notes`. | Requires `status = 'awaiting_seller'` with neither `shipped_at` nor `defaulted_at` (`redemption % is %, expected awaiting_seller`). A NULL or blank note is refused (22023). |

- **Why new columns.** No existing column records FlexSoar's review:
  - `graded_at/graded_by` are written by the seller (`fn_submit_listing`: `graded_by = v_user`).
  - `grade_source` is a label.
  - `status = 'in_custody'` lasts only inside the approval.
  - The `submission_approved` notification is a message, not an item record.

  `review_approved_at timestamptz` and `review_approved_by uuid REFERENCES users(id)` are nullable with no default, like
  `authenticated_by`. Comments are set on both, and on `authenticated_at` stating the rule.
- **Style (074/078).** A temp snapshot, then single-line fragment substitutions on `pg_get_functiondef` (each must occur
  exactly once and must not already be applied). Owner, ACL, SECURITY DEFINER, search_path and all other `pg_proc`
  metadata must be identical before and after. One overload each; no arity change.
- **Preguard also pins:**
  - `fn_mark_default`'s CR-stripped md5 to the production export (`9e32bf38…`);
  - approval's only `authenticated_` references are the two stamped columns;
  - `custody_model = {warehouse, seller}`;
  - the new columns are absent and `authenticated_at` has no comment.
- **Postguard also checks:**
  - the new columns' type, nullability, default and FK, and that they are empty;
  - anon/authenticated/service_role have no INSERT/UPDATE/REFERENCES on them, and SELECT exactly as on `authenticated_by`.
- **No data is rewritten.** Existing stamps are listed by the audit below for a separate founder decision.

**Readers of `authenticated_at`, checked against the catalog and the code:**

| Reader | Effect of 079 |
|---|---|
| 078 `prepare_sale` / `correspondence` | None. Seller → mode 0 without reading the stamp; warehouse needs it as before. |
| 078 `record_attestation` receipt clear | Still correct. New seller items arrive unstamped; it still clears legacy stamps. |
| 061 reconcile (release) | A writer; it stamps from the attested pass and sets custody warehouse in the same update. |
| `fn_grade_item` | Promotes status when stamped. Only warehouse items reach `pending_intake`/`in_custody`. |
| `app/(market)/vault-status.ts`, `CardDetail` | Seller → `held_by_seller` whatever the stamp. No change. |
| `app/admin/grading/*`, `ItemActions` | The queue is `pending_intake`/`in_custody`, which is warehouse only. No change. |
| `app/admin/cards/[id]`, `app/admin/consignments/[id]` ("Authenticated at") | New seller cards show "—" (correct). **Legacy seller cards still show the review time under that label** until the data decision below. |
| `lib/api/contract.ts` `getItems({authenticated})` | Filters on the stamp. New seller items no longer count as authenticated (correct). |

**fn_mark_default audit (production body = repo 013 body; the "unknown body" was whitespace-only drift).**
- **Null identity:** safe. `fn_require_admin()` refuses NULL and non-admin callers before reading anything (proven on staging for
  ghost, non-admin fulfiller and no-claims sessions).
- **Behaviour before 079 (staging, rolled back):**
  - a second default incremented `defaults_count` to 2;
  - a shipped redemption could be defaulted, which flipped the item to `released`;
  - a NULL note set `grading_notes` to NULL, erasing seller and REJECTED history;
  - a blank note was accepted.

  All four are fixed in 079 (above). The admin client (`components/admin/db-writes.ts`) already documented WRONG_STATUS for
  "already shipped, or already defaulted"; the SQL now enforces it.
- **Not changed (by design):** no buyer refund or ledger entry, and no `due_by` check. Restriction stays permanent.

### Staging (PG 17.11, system_identifier 7692131729119822239): applied

The wrapper, `guard.sql` and `common.sh` are the rehearsal's, unchanged except for paths and the app name.

- **Guard:** `staging_marker` with its comment, `auth.users = 0`, `current_user = session_user = postgres`, and the ref in the URI user.
- **Wrapper negative test:** a wrong ref was refused before connecting (rc=90).

Sequence:
1. Baseline: the read-only catalog state above.
2. `checks079.sql` BEFORE 079.
3. Dry run (079 with ROLLBACK): rc=0.
4. Pre-apply fingerprint: 1295 objects, sha256 `45f34be9…`, **identical to the rehearsal's final state**.
5. **079 applied: rc=0, COMMIT, no WARNING/NOTICE**, at 2026-10-21T16:56:50Z.
6. Post fingerprint: 1298 objects. The diff is exactly:
   - added: `items.review_approved_at`, `items.review_approved_by`, `items_review_approved_by_fkey`;
   - body changed in 4 functions, with no metadata change.
7. `verify-post.sql` (059-078) V1-V9: **byte-identical** before and after.
8. `checks079.sql` AFTER 079.
9. Re-apply: refused by the preguard (rc=3, fragment found 0 times), atomic.

Checks (each case its own rolled-back transaction, simulated PostgREST sessions, 0 rows after):

| Case | Before 079 | After 079 |
|---|---|---|
| A1 approve seller submission | ok, **authenticated_at set** | ok, authenticated_at NULL, review_approved_at/by (admin) set, card minted, listing public |
| A2 approve pending_review **warehouse** item never authenticated | ok, **reads as vaulted** | refused `is not authenticated`, nothing minted |
| A3 approve as non-admin / ghost / no claims | `admin privileges required` | same |
| B1 mint seller item, not reviewed | `is not authenticated` | `is seller-held and has not been approved in review` |
| B2 / B3 mint warehouse unauthenticated / authenticated | refused / ok | refused / ok |
| B4 mint seller item, review-approved | (no column) | ok, not stamped, not vaulted |
| C1 authenticate seller-held item | ok, **stamped** | refused `is seller-held, cannot be authenticated` |
| C2 authenticate warehouse pending_intake | ok | ok |
| C3/C4 authenticate as ghost / non-admin | `admin privileges required` | same |
| D1 default awaiting_seller | ok, count 1, restricted, released | same |
| D2 default twice | **ok twice, count 2** | 2nd refused `is defaulted, expected awaiting_seller`, count 1 |
| D3 default a shipped redemption | **ok, item released** | refused `is shipped, expected awaiting_seller` |
| D4 / D5 NULL / blank note | **ok; NULL erased notes** / ok | refused 22023, notes intact |
| D6 warehouse redemption | `is warehouse-fulfilled` | same |
| D7-D9 ghost / fulfiller / no claims | `admin privileges required` | same |

**Post-079 CR-stripped body md5s** (the runbook's expected values): approve `947e0f9b…`, authenticate `1edea6fb…`,
mark_default `05c85e9d…` (CRs kept, 23), mint `4eadd81b…`.

### tests/payment-db/01_fixtures.sql

Mode-1 (direct) fixture items now carry `authenticated_at = clock_timestamp()` and `authenticated_by` = the fixture's
`authenticator` staff user. Mode-0 (seller) items carry neither.

Proven on staging (rolled back):
- with the fixture's own lines through the inventory insert, the **old** item line in mode 1 is refused by 078
  (`PAYMENT_V2_CORRESPONDENCE: inventory`);
- the **new** line enrols mode 1 (warehouse, stamped, stamped by the authenticator);
- mode 0 works with either line;
- a second fixture in the same transaction reuses the single authenticator.

The rest of `fixture()` calls worker-gated RPCs, which refuse `postgres` on Supabase. **The full payment-db suite was not
run** (it needs the isolated superuser container, which this task did not authorize).

### lib/db/errors.ts

The 42501 refusals now map by message to **UNAUTHENTICATED** instead of falling to the 42501→FORBIDDEN code map:
- 077: `sign in to confirm a shipment`, `sign in to record proof`, `sign in to act on this account`,
  `sign in to read a balance`, `sign in to resolve a trade offer`;
- 060/069c: exactly `PAYMENT_V2_SIGN_IN`.

Also:
- 079's seller mint refusal maps to **WRONG_STATUS** (not NOT_AUTHENTICATED: that recovery is wrong for a seller item).
- 079's other two messages ride existing rules (`, cannot be authenticated`, `, expected`).
- The note refusal (22023) stays UNKNOWN, deliberately. No ContractErrorCode fits, the codes live in `contract.ts`
  (track/data), and the admin action already refuses an empty note.

Tests: one describe block appended to `tests/invariants.test.ts` (10 tests). Other 42501s (`permission denied`,
`PAYMENT_V2_LEGACY_PATH_RETIRED`, `PAYMENT_V2_DEDICATED_CONNECTION_REQUIRED`) stay FORBIDDEN. Against HEAD's `errors.ts`
the six sign-in cases return FORBIDDEN and the seller-mint case UNKNOWN, so the tests discriminate.

`npx tsc --noEmit` rc=0. `npm test`: 21 files, **570/570**. `npm run build` rc=0.

### Production data audit (read-only; run by the founder through the runbook)

The file is `C:\Users\Family\flexsoar-reviews\prod-runbook-079\audit-079-authenticated-at.sql`.

- **A1:** items with `authenticated_at` set and at least one of: custody ≠ warehouse; grade_source seller_declared; stamp equal
  to the card's first provenance time (approval stamped and minted in one transaction); a `submission_approved` notification
  for the item. Each row carries every flag, plus `f_v2_attested_pass` (legitimate) and `f_reads_as_vaulted`.
- **A2:** totals.
- **A3:** pending_review items by custody. Warehouse ones can no longer be approved into "vaulted".
- **A4:** redemptions by status and holder.
- **A5:** `defaults_count` vs defaulted redemptions (double defaults), and defaulted items with NULL notes (erased by a NULL note).

Validated on staging: empty → 0 suspects. With synthetic legacy rows (rolled back), it flagged the seller review stamp and the
warehouse review stamp, and not a 079 approval or a legitimate warehouse authentication.

**Founder decision needed** for the A1 rows: leave them, or a separate migration that moves seller-review stamps into
`review_approved_*`. 079 relabels nothing.

### Production runbook addendum (not run)

The runbook is `C:\Users\Family\flexsoar-reviews\prod-runbook-079.md`, with files in `prod-runbook-079\`. It reuses the founder's
`prod-runbook-059-078\prod.py` and guards, whose write guard pins `system_identifier` **7666007964130682852**; it does not copy
them. Step 0 checks their hashes.

### Found, outside this lane (not changed)

- **track/data:**
  - `lib/db/types.ts` `Item` has no `review_approved_at/by` (additive).
  - `contract.ts` `markDefault` does not pre-validate the note; the database now refuses a blank one.
  - `scripts/smoke_settlement.sql:703-713` authenticates a seller-custody item. 079 refuses that, and the script was already
    unrunnable after 063.
- **track/admin:** "Authenticated at" on the card and consignment pages shows the legacy review time for old seller items.
  Consider showing `review_approved_at` as "Review approved".
- **track/market:** `app/(market)/vault-status.ts`'s comment says custody defaults to `'warehouse'` (013:54). 019b changed the
  default to `'seller'`. The comment is stale; the logic is right.
- **payment-security follow-up (proposed, not in 079):** `fn_confirm_shipment` (077 body) refuses only `shipped`. After an
  admin default, the fulfiller can still confirm shipment, flipping a `defaulted` redemption to `shipped` and incrementing
  `fulfilments_completed`. A forward fix would refuse unless `status = 'awaiting_seller'` (seller-held) or `'requested'`
  (warehouse). This was read from 077's body (077:187 checks only `'shipped'`) and **not executed**.
- **Open (founder rule):** `fn_authenticate_item` now requires warehouse custody, but a warehouse item in `pending_intake` may not
  have physically arrived yet (consignment status is not checked).

### Not verified

- **Production:** no access. Whether production's three CRLF bodies (approve/mint/authenticate) CR-strip to the staging md5s is
  checked by the runbook's P3, not by me. The `fn_mark_default` pin comes from the founder export.
- **The full payment-db suite** (see above).
- **`f_stamped_in_mint_txn` can false-positive:** a warehouse item authenticated and minted in one admin SQL transaction. None of
  the app's paths do that; read it together with the other flags.
- **`graphify update .`:** not run. This worktree has no `graphify-out/`.

## 2026-10-22 - Migration 080: post-079 cleanup (container + staging applied; production NOT touched)

Founder authorization (TASK 080, this task only): author `080` on `track/payment-security`; execute it only against isolated
container databases and Supabase `flexsoar-staging` (ref `krkydvvvtszceutprfmy`) through the guarded staging wrapper. Lanes
widened for this task: `tests/payment-db/**`, `lib/db/types.ts`, the admin item pages, the vault-status comment.
**No production connection was made.** Pre-flight: branch `track/payment-security`, `git log HEAD..main` empty.

Production context (from the founder's 079 run, 2026-10-22): `items=2`; exactly one row carries a seller-review stamp in
`authenticated_at` (custody seller, seller_declared, minted, card pending_vault, `f_reads_as_vaulted=f`,
`f_v2_attested_pass=f`, `review_approved_at` NULL). `fn_approve_submission`'s ACL includes PUBLIC (`=X/postgres`).

### 080_post_079_cleanup.sql

One transaction. It takes `LOCK TABLE items IN SHARE ROW EXCLUSIVE MODE` first, so writers wait and readers do not.

| Step | What | Guards |
|---|---|---|
| 1 data | Every item with `custody <> 'warehouse' AND authenticated_at IS NOT NULL AND review_approved_at IS NULL` and no v2 `authentication_pass`/`review_authentication_pass` attestation for a sale of it: `review_approved_at/by := authenticated_at/by`, `authenticated_at/by := NULL`. NOTICE with the count. | Pre: refuse if any candidate is in warehouse custody (unreachable by construction; kept as asked), is enrolled in `payment_v2.inventory`, or was stamped by a non-admin user. Post: zero rows match the predicate; each moved row equals its snapshot outside the four stamp columns, with the values carried across; every other item is byte-identical (count + md5 of all rows). |
| 2 ACL | `REVOKE EXECUTE ON fn_approve_submission(uuid,integer,integer) FROM PUBLIC, anon`. Body untouched. | Pre: PUBLIC holds EXECUTE (otherwise "already applied or drifted"); no unexpected grantee; body md5 = 079's `947e0f9b…`. Post: ACL = the old entries minus PUBLIC/anon, and exactly `{postgres, authenticated, service_role}` EXECUTE without grant option; effective anon=f, authenticated=t, service_role=t. |
| 3 fn_confirm_shipment | One single-line fragment, placed after the holder check: refuse unless `status = 'requested'` (warehouse, fulfiller NULL) or `'awaiting_seller'` (seller-held), with `shipped_at` and `defaulted_at` both NULL. Message: `redemption % is %, expected %` (→ WRONG_STATUS by the existing `, expected` rule). | 074/078/079 style: pinned CR-stripped md5 (077 body `a933c7a7…`, = production V6); fragment exactly once and not already applied (a re-run reports `already carries the 080 fragment 1`); one overload; owner, secdef, search_path, ACL and all other `pg_proc` metadata identical. |

**Allowed source states (step 3), from the code:**
- Redemptions are created only as `'requested'` (warehouse) or `'awaiting_seller'` (seller-held) (013:272, 026:140, 048:120).
  `fn_redeem_card` is retired by 063, and the v2 redeem refuses.
- They leave by `'shipped'` (`fn_mark_shipped`, `fn_confirm_shipment`) or `'defaulted'` (`fn_mark_default`, which since 079
  accepts awaiting_seller only).
- No other value is ever written.
- The status is bound to custody (fulfiller set ↔ awaiting_seller), so an inconsistent row is refused too.
- Non-holders see the same check order as before: they still get `only the holder of this item can confirm shipment` first.

**Readers of `items.authenticated_at/by` (live catalog on staging + grep of lib/, app/, components/):**

| Reader | Effect of clearing the stamp on a seller-held minted item |
|---|---|
| `fn_mint_card` | Reads at mint only. Seller custody is gated on `review_approved_at` since 079; the moved row is already minted. |
| `fn_grade_item` | Refuses any status but `pending_intake`/`in_custody`. |
| `fn_authenticate_item` | Writer; warehouse custody only since 079. |
| `fn_payment_v2_prepare_sale`, `payment_v2.correspondence()` (078) | Seller → mode 0 without reading the stamp. |
| `fn_payment_v2_record_attestation` (078) | Receipt clears the stamp anyway. |
| `fn_payment_v2_reconcile_event` (061) | Writer at release, from the attested pass. |
| Escrow release / payout eligibility | No reader. Mode-0 release depends on the attestation chain. |
| Redemption | `fn_redeem_card` retired (063), v2 redeem refuses (062). Neither reads the stamp. |
| Views, policies, indexes | None reference the columns. Only `items_authenticated_by_fkey` depends on one, and NULL satisfies it. |
| Triggers on items | `trg_items_condition_grade` fires on float_value only. `payment_v2_fence` refuses non-owner writes to v2-enrolled items, hence the explicit "enrolled" preguard. Nothing else blocks a write to the columns. |
| `app/(market)/vault-status.ts`, `CardDetail` | Seller → "Held by seller" whatever the stamp. |
| `/admin/mint`, `/admin/grading` (`getItems({authenticated})`) | `in_custody` / `pending_intake` only; a minted item never appears. |
| `/admin/cards/[id]`, `/admin/consignments/[id]` | "Authenticated at" now shows "—" for the moved row; "Review approved at" shows the time (below). |

### Container (isolated) run: PASS

`tests/payment-db/run_080_container.sh` ran on container `6ef7375a8c4e` (`flexsoar-schema-replay-20261021-0031`,
supabase/postgres 17.11). Isolation was verified first: NetworkMode none, PortBindings {}, Privileged false, 3 read-only mounts,
lo only.

The database chain:
1. Source DB `flexsoar_mig_test_20261021`, left untouched. Its four pre-079 bodies hash to production's P3 values.
2. Template copy `flexsoar_080_base`, plus 079 (sha `558ab750…`, as postgres).
3. A fresh `flexsoar_payment_v2_test` per scenario.

| Scenario | Result |
|---|---|
| nonadmin | 080 rc=3 `1 candidate item(s) were stamped by a non-admin user`; 82: nothing changed |
| enrolled | 080 rc=3 `1 candidate item(s) are enrolled in payment_v2.inventory`; 82: nothing changed |
| main | 080 rc=0 `moved 2`; 81: 28 PASS; re-run rc=3 `already carries the 080 fragment 1`; 81 again identical |

What 81 covers:
- **Data:** both seller-review stamps moved, with the values carried across, the admin as reviewer, and all other columns
  equal. **Every warehouse item is untouched** (authenticated, legacy review stamp, unauthenticated), and every other item is
  byte-identical. The stamp+review row is left. Redemptions are unchanged by 080.
- **ACL:** the approve ACL is exact. anon gets `42501 permission denied for function fn_approve_submission`. An admin still
  approves; a non-admin still gets `admin privileges required`.
- **fn_confirm_shipment:** the matrix below. A no-users-row session still gets `sign in to confirm a shipment`. Metadata is
  unchanged.

| fn_confirm_shipment | Before 080 | After 080 |
|---|---|---|
| awaiting_seller, fulfiller | accepted | accepted (shipped, item shipped) |
| **defaulted, fulfiller / admin** | **accepted** | refused `is defaulted, expected awaiting_seller` |
| **warehouse defaulted, admin** | **accepted** | refused `is defaulted, expected requested` |
| warehouse requested, admin | accepted | accepted |
| shipped | `is already shipped` | same |
| **seller-held 'requested'** / **awaiting_seller with shipped_at** | **accepted** | refused `, expected awaiting_seller` |
| defaulted, non-holder | `only the holder …` | same |

### Staging (PG 17.11, system_identifier 7692131729119822239): applied

The wrapper `stg.py` and `guard.sql` are 079's, byte-identical (sha `aced31e2…` / `46428260…`). Every session printed
`GUARD_OK staging`.

1. **Read-only baseline:** the catalog reader audit (above), `preflight-080.sql`, `audit-080-stamps.sql`, the 059-078
   `verify-post.sql`, `verify-079.sql`, and the catalog inventory (1298 objects).
2. **`checks80.sql` BEFORE** (synthetic rows, rolled back): the "before" column above, reproduced on Supabase.
3. **Dry run** (080 with ROLLBACK): rc=0, `moved 0`.
4. **Dry run with a synthetic production-shape row** (rolled back): `moved 1`.
   - The row ends in custody seller, with auth NULL and review = the old stamp, by an admin. It is not vaulted.
   - The warehouse-authenticated row is untouched.
   - The confirm and ACL probes match the "after" column.
   - This proves step 1 through the real `payment_v2_fence` and RLS, as `postgres`.
5. **080 applied: rc=0, COMMIT** at 2026-10-22T02:25:05Z. File sha256 `87e7386b…`, CR=0. NOTICEs: `moved 0` and
   `…left as is: 0`.
6. **Inventory diff:** 1298 → 1298 objects, exactly two changed:
   - `fn_approve_submission`: ACL only; body md5 unchanged.
   - `fn_confirm_shipment`: body `a933c7a7…` → `4f1b8f83…`; metadata unchanged.
7. **Verification:**
   - `verify-080.sql`: Q1-Q4 as the runbook expects.
   - 059-078 `verify-post.sql`: only the V6 `fn_confirm_shipment` md5 line differs.
   - `verify-079.sql`: only the Q1 approve ACL differs.
   - Audit: unchanged (staging has no items).
8. **`checks80.sql` AFTER:** the "after" column. Re-apply: refused (`already carries the 080 fragment 1`), atomic.

### PUBLIC / anon EXECUTE on public.fn_* (READ-ONLY report)

Source: the staging catalog, which equals the 059-079 replay. Production may differ, because its 001-058 history drifted. The
runbook's preflight prints the same list for production as `R1|` lines.

| Function | PUBLIC | anon | Definer | Class | Note |
|---|---|---|---|---|---|
| `fn_approve_submission(uuid,int,int)` | yes | yes | yes | admin-only | **Revoked by 080.** Before, `fn_require_admin()` refused inside. |
| `fn_set_card_visibility(uuid,bool)` | yes | yes | yes | user | The owner/admin check refuses anon (`owner_id` is NOT NULL, so it is distinct from NULL). Anon access is unnecessary; a candidate for a later revoke. It distinguishes "not found" from "not your card". |
| `fn_current_user_id()` | | yes | yes | user (helper) | Returns the caller's users.id; NULL for anon. Used by policies and RPC guards. |
| `fn_is_admin()` | | yes | yes | user (helper) | `false` for anon. Used by policies. |
| `fn_sale_history_public(uuid)` | | yes | yes | intentionally public | Settled sale prices per model (the public tape). |
| `fn_card_value_cents(uuid)` | | yes | | intentionally public | Invoker; the fair value shown beside every price. |
| `fn_tier_for_sku(uuid)` | yes | yes | | intentionally public | Invoker. |
| `fn_tier_for_price(int)`, `fn_grade_for_float(numeric)`, `fn_float_multiplier(uuid,numeric)`, `fn_config_bool(text)`, `fn_config_num(text)` | | yes | | intentionally public | Invoker; pure or config reads. |
| `fn_payment_v2_managed(text,jsonb)` | yes | yes | yes | intentionally public (063) | The invoker fence trigger calls it as any role. It returns only whether a row is v2-managed. V1 expects it. |
| `fn_payment_v2_legacy_guard()`, `fn_guard_sku_model_art_url()` | yes | yes | | trigger | Trigger functions cannot be called directly. |

### App (lanes widened by the task)

- **`lib/db/types.ts`:** adds `Item.review_approved_at?` / `review_approved_by?`. They are optional, like `custody`, because
  lib/mock predates them. The doc comment on `authenticated_at` now says it means warehouse authentication only.
- **Admin pages:** `app/admin/cards/[id]/page.tsx` shows "Review approved at" beside "Authenticated at".
  `app/admin/consignments/[id]/page.tsx` has a "Review approved" column before "Authenticated".
- **`components/admin/db-reads.ts`:** adds `getItemReviewApprovals(itemIds: UUID[]): Promise<Map<UUID, Timestamptz | null>>`.
  - Why: `getCard()` and `getConsignment()` (contract.ts, track/data) do not project the column.
  - The task did not name this file. It is the admin lane's read adapter file, and the pages cannot show the value without it.
- **`app/(market)/vault-status.ts`:** comment fixed. The custody default has been `'seller'` since 019b, and review approval is
  never an input. The task named `lib/vault-status.ts`, which does not exist; this is the file the 079 handoff flagged.
- **`tests/review-approved.test.ts` (13 tests):**
  - both pages render the two values in separate places;
  - review approval never makes an item Vaulted;
  - the new refusals map to WRONG_STATUS;
  - the static shape of 080: ASCII/LF, one transaction, no UUID literals, the exact predicate, one UPDATE that never sets
    custody, and the single REVOKE.

`npx tsc --noEmit` rc=0. `npm test`: 22 files, **585/585** (was 572). `npm run build` rc=0.

### scripts/smoke_settlement.sql: stale (not edited)

- **Retired calls:** it calls functions 063 retired (`PAYMENT_V2_LEGACY_PATH_RETIRED`): `fn_purchase_card` (12),
  `fn_reserve_credit` (5), `fn_list_card` (5), `fn_create_trade_offer`/`fn_accept_trade_offer`,
  `fn_confirm_sale_cancellation`, `fn_redeem_card`, `fn_vault_receive`, `fn_vault_mark_defaulted`. It cannot run past its
  first purchase.
- **Seller authentication:** `mk_unvaulted_listing` (≈703-713) runs `fn_authenticate_item` on a **seller-custody** item, which
  079 refuses. The seller path now needs `fn_approve_submission` (review approval), not authentication.
- **Receipt as authentication:** line 813 asserts "item vaulted" via `fn_vault_receive`. That function's
  `coalesce(authenticated_at, now())` made receipt alone count as "authenticated" (023c). The path is retired, and under the
  founder rule receipt is not authentication.
- **Dropped trigger:** ≈883 asserts on `payout_release_at`, which only the dropped `trg_vaulted_instant_release` (078) set.
- **auth.users:** it inserts `auth.users` rows (in a non-fatal block), so it must never be pointed at production.

### Found, outside this lane (not changed)

- **track/admin: `/admin/cards/[id]` throws on the server.**
  - `RetireCardForm` evaluates `document.querySelector(…)` during render, in a Server Component file (`page.tsx` ≈192).
  - So a real server render raises `ReferenceError: document is not defined`.
  - The new test stubs `document` for its own render only.
  - Not verified against a running server.
- **track/data:** project `review_approved_at` on `CardDetail.item` (getCard) and `ConsignmentDetail.items` (getConsignment).
  `getItemReviewApprovals` can then be deleted.
- **Production data:** the moved item's card is `pending_vault` while the item is seller-held. That status came from
  `trg_hold_card_pending_vault` (023c, dropped by 063). 080 does not change it; it needs its own decision.
- **Unchanged behaviour:** `fn_confirm_shipment` still lets an admin ship a warehouse redemption without crediting anyone, as
  before.

### Production runbook addendum (not run)

- The runbook is `C:\Users\Family\flexsoar-reviews\prod-runbook-080.md` (sha256 `808e54a5…bcdc453`), with supporting files
  in `prod-runbook-080\` (listed in `runbook-080.sha256`). It pins commit `722ea81` and 080 sha256 `87e7386b…`.
- Tooling tested locally, with no connection: `pins80` passes, and catches a tampered file; `export-lf-080.sh` reproduces the
  staging sha from `722ea81` and refuses a commit without 080 and a non-commit.
- It reuses `prod-runbook-059-078\prod.py` and both guards unchanged (hash-checked).
- It uses the 079 production outputs as baselines.
- Its before/after audit expects exactly the one-row move above. `audit-diff-080.sh` checks this; it was tested offline against
  one good output and four bad ones.

### Not verified

- **Production values:** `fn_confirm_shipment`'s CR count, the R1 ACL list, and whether production still has exactly one
  candidate. The preflight reads them; P5 must say `candidates=1`.
- **17.6 vs 17.11:** 080 uses `LOCK TABLE`, `pg_get_functiondef`, `aclexplode`, `REVOKE` and `has_function_privilege`, all
  stable within 17.x. Not run on 17.6.
- **The warehouse-custody preguard** cannot fire, because the predicate excludes warehouse. It is a tautological backstop.
- **Full payment-db suite** (10/20/30, workers, races): not re-run; only the 080 files ran.
- **`graphify update .`:** not run; this worktree has no `graphify-out/`.
