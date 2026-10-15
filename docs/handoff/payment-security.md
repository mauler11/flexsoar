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
