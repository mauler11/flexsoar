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
