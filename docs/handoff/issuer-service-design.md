# P2a — Issuer service design and Privy spike

**Status: design only.** No service code, migration, key, account, or deployment was created. This document settles Phase 2's issuer-owned `open_sale` path and records the Privy public-docs spike. It is the design input for an independent review; implementation must wait for that review.

## Decisions and existing boundaries

- The service belongs in `workers/issuer/`, a new top-level area owned by `track/payment-security`.
- The service uses the existing `lib/db/payment-postgres.ts` transport and its explicit `psql` RPC allow-list. No Postgres driver or arbitrary SQL API is proposed. The current allow-list does not yet include all issuer RPCs needed here; implementation must add only the named functions and typed parameters described below.
- D1: `payment_v2_issuer` is the only wallet-enrollment writer; SQL cross-checks identity and uniqueness, and the service applies the canary allow-list. Re-review before enrolling other sellers.
- D4: devnet uses a key file. For the canary, use a Privy server wallet only if its wallet policy is configured and verified to restrict the issuer to the pinned program and the required instruction set; otherwise use the 0600 key file.
- D5: quote lifetime is 10 minutes; canary seller-listing lifetime is 24 hours. Revoke and re-sign after expiry or material quote drift.
- D6: preparing a sale is an explicit seller action.
- D7: only the founder and friend user IDs are in the issuer-service allow-list. The UUIDs are operator configuration and must not be committed.
- `fn_payment_v2_prepare_sale` requires funding to be enabled. Funding remains off until the separately approved canary window; these endpoints must fail closed before that window.
- 083, 084, and 085 are applied and frozen. Any missing reader or executor fence identified here requires a separately reviewed forward migration; it must not modify those files.

## 1. HTTP endpoints and contracts

All requests are server-to-server `POST` calls over HTTPS. The web route authenticates the user and signs the exact body using the common HMAC envelope in §2. JSON object keys are unique; duplicate keys, unknown fields, values with the wrong primitive type, and bodies over 32 KiB are refused. UUIDs use lowercase canonical form. Public keys are base58 strings; signatures and serialized transactions are base64url without padding. Integer token amounts and Unix times are decimal strings, never JSON numbers.

Success shape is endpoint-specific below. Every refusal uses:

```json
{"error":{"code":"ISSUER_*","message":"safe stable text","retryable":false,"requestId":"uuid"}}
```

`message` contains no SQL, credentials, signature bytes, or RPC response body. Database refusals may include a separate allow-listed `dbCode` field. A psql timeout/disconnect whose commit status is unknown returns `503 ISSUER_DB_OUTCOME_UNKNOWN`; callers retry with the same business idempotency key and a fresh HMAC nonce. The transport must not turn an uncertain commit into a claim that the write failed.

### Common validation order

1. Enforce method, path, content type, body size, strict JSON/schema, and no duplicate keys.
2. Require all HMAC headers; parse `kid`, integer timestamp, 128-bit random nonce, canonical UUID user ID, and 32-byte hex MAC.
3. Require timestamp within ±60 seconds of the issuer clock; compute the canonical string from the raw-body digest; constant-time compare HMAC-SHA-256.
4. Atomically reserve the `(kid, nonce)` in the durable replay store. A repeated nonce is refused before any database or RPC call.
5. Require the signed user ID in the operator-provisioned D7 allow-list. This applies to all user-facing endpoints, including the buyer path.
6. Validate endpoint fields and then perform the endpoint-specific DB and chain checks in the order below.

Common refusals: `ISSUER_BAD_REQUEST` (400), `ISSUER_AUTH_REQUIRED` / `ISSUER_AUTH_INVALID` / `ISSUER_AUTH_EXPIRED` / `ISSUER_AUTH_REPLAY` (401), `ISSUER_USER_NOT_ALLOWED` (403), `ISSUER_RATE_LIMITED` (429), `ISSUER_DB_UNAVAILABLE` / `ISSUER_DB_OUTCOME_UNKNOWN` (503), and `ISSUER_INTERNAL` (500). Proposed rate limits are 5 enrollment challenges and 5 completions per 10 minutes per user, 3 prepares/minute per user, 10 listing records/minute per user, and 10 authorizations/minute per user; each returns `Retry-After`. The internal open-sale poll is single-flight with limit 20. These are design defaults for independent review, not an approved capacity figure. No request is trusted because it came from the web app alone.

### `POST /v1/enroll-wallet`

This is a two-phase endpoint. A challenge is stateless and short-lived; completion revalidates every field.

**Challenge request**

```json
{"phase":"challenge","networkGenesis":"<base58-32-byte>","wallet":"<base58-32-byte>"}
```

**Challenge response**

```json
{"networkGenesis":"<base58>","wallet":"<base58>","mint":"<base58>","tokenAccount":"<derived-ata-base58>","issuedAt":"<unix-seconds>","message":"<exact-UTF8-message>"}
```

The issuer derives `mint` and ATA from its pinned network configuration, never from the challenge request. The wallet must equal the user's already linked `users.solana_address`; challenge issue does not enroll or mutate anything. Request fields other than `phase`, `networkGenesis`, and `wallet` are rejected.

**Complete request**

```json
{"phase":"complete","networkGenesis":"<base58>","wallet":"<base58>","mint":"<base58>","tokenAccount":"<base58>","issuedAt":"<unix-seconds>","signature":"<64-byte-signature-base64url>"}
```

**Complete response**

```json
{"enrolled":true,"networkGenesis":"<base58>","wallet":"<base58>","mint":"<base58>","tokenAccount":"<base58>","proofDigest":"<sha256-hex>"}
```

The existing RPC returns `void` for both insertion and exact idempotent match, so the response does not claim which occurred. A transport error is never reported as success.

**Validation order and calls.** For `phase='challenge'`, after common checks: require canonical genesis and wallet; call the new issuer-only subject reader with `('wallet',HMAC users.id,pinnedNetworkId)`; require the DB-linked wallet matches, user country is `MY`, and genesis equals the configured canary network; derive the ATA and return the exact proof message with pinned mint and ATA. The challenge does not write. For `phase='complete'`, repeat those checks, require submitted mint and token account equal the pinned/derived values, parse canonical decimal `issuedAt` and require no more than 5 minutes old and no more than 30 seconds in the future, reconstruct the exact message and verify Ed25519 using the wallet public key, verify the pinned mint and ATA on both configured RPCs (§5), hash `messageBytes || signatureBytes`, then call `public.fn_payment_v2_enroll_wallet(p_user uuid,p_network uuid,p_wallet bytea,p_token_account bytea,p_proof_digest bytea)` through `payment_v2_issuer`.

Refusals: `ISSUER_NETWORK_MISMATCH` (403), `ISSUER_WALLET_MISMATCH` (403), `ISSUER_PROOF_EXPIRED` / `ISSUER_PROOF_INVALID` / `ISSUER_PROOF_MALFORMED` (422), `ISSUER_ATA_MISMATCH` / `ISSUER_MINT_INVALID` / `ISSUER_TOKEN_ACCOUNT_INVALID` / `ISSUER_RPC_DISAGREEMENT` (422 or 503 for unavailable RPC), and `ISSUER_ENROLLMENT_CONFLICT` (409). Database refusal codes mapped from 084 are `PAYMENT_V2_WALLET_USER_NOT_MY`, `PAYMENT_V2_WALLET_ADDRESS_MISMATCH`, `PAYMENT_V2_WALLET_NETWORK_UNKNOWN`, `PAYMENT_V2_WALLET_MALFORMED`, `PAYMENT_V2_WALLET_ENROLLMENT_CONFLICT`, and `PAYMENT_V2_WALLET_TOKEN_ACCOUNT_USED`. Exact same user/network/wallet/token-account/proof-digest is idempotent; a different token account or proof for the same enrollment is a conflict.

### `POST /v1/prepare-sale`

This is invoked only by an explicit seller action (D6). The client supplies identifiers and an idempotency key, not quote authority.

**Request**

```json
{"listingId":"<uuid>","requestId":"<uuid>"}
```

`requestId` is the stable business idempotency key and is used as `p_terms.id`; it is not proof of ownership. The network is fixed by issuer deployment configuration for the canary, not selected by the browser.

**Response**

```json
{
  "saleId":"<uuid>",
  "listingId":"<uuid>",
  "cardId":"<uuid>",
  "generation":"<u64-decimal>",
  "networkGenesis":"<base58>",
  "program":"<base58>",
  "quote":{"currency":"USDC","decimals":6,"totalUnits":"<u64-decimal>","validFrom":"<unix-seconds>","expiresAt":"<unix-seconds>","fxSnapshot":{"provider":"<configured-provider>","base":"MYR","quote":"USDC","rateNumerator":"<positive-integer>","rateDenominator":"<positive-integer>","observedAt":"<RFC3339-UTC>","sourceReference":"<opaque-id>"}},
  "listing":{"minTotalUnits":"<u64-decimal>","expiresAt":"<unix-seconds>","messageBase64url":"<61-byte-message>"}
}
```

The exact `fxSnapshot` shape above is a proposed service contract; the stored JSON currently has no versioned schema. Review must lock its provider and rounding semantics before implementation. `rateNumerator/rateDenominator` means USDC base units per MYR sen. Proposed conversion is integer-only, rounded up: `totalUnits = ceil(price_cents * numerator / denominator)`. No floating-point money arithmetic. This rounding is a design proposal, not a previously recorded founder decision.

**Validation order and calls.** After common checks: require `listingId` and `requestId` UUIDs; call new `public.fn_payment_v2_issuer_subject_context(p_kind text,p_subject_id uuid,p_network_id uuid)` with `p_kind='listing'`, `p_subject_id=listingId`, and server-configured network ID to read only listing owner/status/price/card/network inputs; require returned seller ID equals the HMAC user and both IDs satisfy D7; refuse non-public, non-owned, non-active, fenced, or unregistered inventory; check configured network/genesis/program/mint/token program and funding-on status; fetch a fresh approved FX quote and validate age/schema; compute total and 10-minute quote window; derive the sale/escrow PDAs from the DB-derived card/sale commitments and pinned program; build `p_terms` exactly as `PaymentSaleTerms` (`id`, `saleAddress`, `escrowAddress`, `totalUnits`, `fxSnapshot`, `validFrom`, `expiresAt`); call `public.fn_payment_v2_prepare_sale(p_listing_id uuid,p_network_id uuid,p_terms jsonb)`; then call existing `public.fn_payment_v2_issuer_context(p_sale_id uuid,p_action text)` with `p_action='open_sale'` to build the seller's signing message and calculate `minTotalUnits = ceil(totalUnits * (10000 - toleranceBps) / 10000)`. The response is the stored quote and message, not client-supplied values.

New `fn_payment_v2_issuer_subject_context(p_kind text,p_subject_id uuid,p_network_id uuid)` is a prerequisite: 060's prepare RPC accepts service-calculated terms, but current issuer-only readers do not return listing owner and price before preparation. Its allow-listed `p_kind` values and minimal JSON shapes are: `wallet` → `{userId,countryCode,linkedWallet,networkId,genesis,mint,tokenProgram}`; `listing` → `{listingId,sellerId,listingStatus,cardId,cardStatus,priceCents,inventoryRegistered,saleFenced,networkId,genesis,program,config,mint,tokenProgram,fundingEnabled}`; `sale` → `{found,saleId,listingId,sellerId,cardId,networkId,state,sellerWallet,quoteTotalUnits,quoteValidFrom,quoteExpiresAt,toleranceBps,issuerTerms}`; `attempt` → `{found,attemptId,buyerId,saleId,networkId,state,expiresAt,permitHex}`. For `sale` and `attempt`, `p_network_id` must be NULL and network is derived from the stored row. A missing `sale` keyed by the prepare `requestId` returns `{found:false}` for safe recovery. The function requires issuer role, never accepts a user ID as caller identity, and never returns unrelated PII. Recovery returns exact stored terms when a prepare committed but its reply was lost, preserving idempotency without trusting a new FX quote on retry.

Refusals: `ISSUER_LISTING_NOT_FOUND` (404), `ISSUER_LISTING_NOT_OWNED` / `ISSUER_USER_NOT_ALLOWED` / `ISSUER_NETWORK_MISMATCH` (403), `ISSUER_LISTING_UNAVAILABLE` / `ISSUER_FUNDING_DISABLED` / `ISSUER_FX_UNAVAILABLE` / `ISSUER_FX_STALE` / `ISSUER_QUOTE_INVALID` (409 or 503 for unavailable provider), `ISSUER_SALE_IDEMPOTENCY_CONFLICT` (409), and `ISSUER_DB_OUTCOME_UNKNOWN` (503). Existing 060 DB codes include `PAYMENT_V2_NOT_CONFIGURED`, `PAYMENT_V2_SALE_FENCED`, and `PAYMENT_V2_SELLER_WALLET_REQUIRED`, and `PAYMENT_V2_SALE_IDEMPOTENCY_CONFLICT`; idempotency conflict on reused sale ID must map to `ISSUER_SALE_IDEMPOTENCY_CONFLICT`. Same `requestId` recovers/returns the original sale and terms; changed listing or terms under that ID is a conflict.

### `POST /v1/record-listing`

**Request**

```json
{"saleId":"<uuid>","messageBase64url":"<61-byte-message>","signatureBase64url":"<64-byte-signature>"}
```

**Response**

```json
{"saleId":"<uuid>","recorded":true,"listingExpiresAt":"<unix-seconds>","minTotalUnits":"<u64-decimal>"}
```

**Validation order and calls.** After common checks: decode canonical base64url and require lengths 61/64; call `fn_payment_v2_issuer_subject_context('sale',saleId,NULL)` and require its seller ID equals the HMAC user and D7; require sale state `opening`, listing/quote still current, listing expiry in the future and at most 24 hours from issue; derive binding from DB domain, program, card commitment, sale commitment and generation; verify the message tag, binding, signature under the DB-stored seller wallet, floor within the DB tolerance of the stored quote, and expiry at least quote expiry; call `public.fn_payment_v2_record_listing(p_sale uuid,p_message bytea,p_signature bytea)`. SQL independently rechecks binding/floor/expiry and stores the seller bytes. Exact bytes/signature retry is idempotent.

Refusals: `ISSUER_SALE_NOT_FOUND` (404), `ISSUER_SALE_NOT_OWNED` (403), `ISSUER_SALE_NOT_OPENING` (409), `ISSUER_LISTING_MESSAGE_MALFORMED` / `ISSUER_LISTING_BINDING_INVALID` / `ISSUER_LISTING_SIGNATURE_INVALID` / `ISSUER_LISTING_FLOOR_OUT_OF_TOLERANCE` / `ISSUER_LISTING_EXPIRED` (422), `ISSUER_LISTING_CONFLICT` (409), and `ISSUER_DB_OUTCOME_UNKNOWN` (503). Exact 083 DB refusal codes are `PAYMENT_V2_SALE_MISSING`, `PAYMENT_V2_LISTING_MALFORMED`, `PAYMENT_V2_NOT_CONFIGURED`, `PAYMENT_V2_LISTING_BINDING`, `PAYMENT_V2_LISTING_FLOOR_OUT_OF_TOLERANCE`, `PAYMENT_V2_LISTING_EXPIRY`, and `PAYMENT_V2_LISTING_CONFLICT`.

### `POST /v1/authorize-attempt`

The web app first creates the attempt through its existing authenticated session path using `public.fn_payment_v2_initiate(p_listing_id uuid,p_idempotency_key uuid,p_policy_version text,p_policy_digest text)`. The session/RPC derives buyer identity; the web app passes only the returned durable `attemptId` to the issuer. The issuer endpoint then authorizes and produces the issuer-signed, buyer-unsigned v0 transaction. The buyer signs and submits it; the issuer does not broadcast a buy.

**Request**

```json
{"attemptId":"<uuid>"}
```

**Response**

```json
{"attemptId":"<uuid>","permitSha256":"<hex>","transactionBase64url":"<serialized-v0-transaction>","issuer":"<base58>","buyer":"<base58>","recentBlockhash":"<base58>","lastValidBlockHeight":"<u64-decimal>","signer":"issuer-partial"}
```

**Validation order and calls.** After common checks: validate UUID; call new `fn_payment_v2_issuer_subject_context('attempt',attemptId,NULL)` and require its `buyerId` equals the HMAC user and is D7-allowed; require attempt is pending/authorizable and unexpired; call existing `public.fn_payment_v2_authorize_attempt(p_attempt_id uuid)` to get the immutable 690-byte permit; decode and validate exact size, policy/version and network/program/config pins; construct only the `buy_sale` instruction with `buyV2Instruction`; load only operator-pinned lookup tables and verify their program owner/address set; obtain a fresh blockhash for the pinned network; build the exact v0 message with issuer as fee payer; require the only instruction is the single expected `buy_sale`, its issuer and buyer keys match the permit, and no client-provided instruction or address is present; partially sign with `IssuerSigner`; verify the returned issuer signature over the exact message and ensure the buyer signature slot remains empty; return the serialized transaction and blockhash validity.

New `fn_payment_v2_issuer_subject_context('attempt',...)` is also a prerequisite. 060's `fn_payment_v2_authorize_attempt` returns a permit but does not establish that the authenticated web user owns that attempt; the verifier-only attempt reader cannot be called by the issuer login. The new reader must expose the buyer ID and only the fields needed to build/validate the permit transaction, be issuer-only, and never permit caller-supplied buyer identity.

Refusals: `ISSUER_ATTEMPT_NOT_FOUND` (404), `ISSUER_ATTEMPT_NOT_OWNED` / `ISSUER_USER_NOT_ALLOWED` (403), `ISSUER_ATTEMPT_UNAVAILABLE` / `ISSUER_ATTEMPT_EXPIRED` / `ISSUER_AUTHORITY_ROTATED` (409), `ISSUER_PERMIT_INVALID` / `ISSUER_TRANSACTION_INVALID` / `ISSUER_LOOKUP_TABLE_INVALID` (422), `ISSUER_BLOCKHASH_UNAVAILABLE` / `ISSUER_SIGNER_UNAVAILABLE` (503), and `ISSUER_DB_OUTCOME_UNKNOWN` (503). Existing DB refusal codes include `PAYMENT_V2_ATTEMPT_MISSING`, `PAYMENT_V2_AUTHORIZATION_DISABLED`, and `PAYMENT_V2_AUTHORITY_ROTATED`. Authorization is idempotent: the same attempt returns the same stored permit. A renewed blockhash may produce a different message/signature while the immutable permit stays the same. The client must verify the returned issuer signature and sign as the permit buyer before send.

### Background `open_sale` submitter (no public HTTP endpoint)

Each serialized poll calls `public.fn_payment_v2_open_sale_queue(p_limit integer)` with `1 <= p_limit <= 20`. For each queued sale it calls `fn_payment_v2_issuer_context(saleId,'open_sale')` and `fn_payment_v2_listing_for_open(saleId)`. It requires a D7-listed seller, current pinned genesis/program/issuer, state `opening` or `open`, a stored matching 61-byte listing and signature, and exact equality between message binding/floor/expiry and the DB context. `listing_for_open` is the source of seller bytes; no web request supplies them.

Before submission, check the sale PDA on chain. If present, compare its immutable sale/card/generation/seller/floor state to the DB and stored listing; treat an exact match as already submitted and let the verifier observe it, otherwise stop and alert. If absent, verify the stored Ed25519 signature under the DB seller wallet, build the open instruction from the issuer context and pass it only through `openSaleWithListing(open,listing,signature,true)`, which returns exactly `[Ed25519 verify, open_sale]` in that order. The issuer pays fees and signs. On unknown send outcome, re-read the PDA before any resubmission. The verifier later records the finalized open lifecycle; the issuer queue is not an executor lease.

The 084 queue is issuer-only and selects ready, not-observed `open_sale` rows only when the sale is opening/fenced and a listing exists. The executor's generic lease RPC can still return `open_sale`; its future handler must skip it before fetching context or signing. Before production executor operation, a separately reviewed forward migration must fence `open_sale` from the executor lease RPC, as F7 records. The issuer process must remain single-instance/single-flight for this queue. The only allowed open transaction is the paired transaction; a bare `open_sale` is a hard internal error and an alert, never a fallback.

Background refusal codes: `ISSUER_OPEN_QUEUE_INVALID` (500), `ISSUER_OPEN_LISTING_MISSING` / `ISSUER_OPEN_CONTEXT_MISMATCH` / `ISSUER_OPEN_WRONG_STATE` / `ISSUER_OPEN_ACCOUNT_CONFLICT` / `ISSUER_BARE_OPEN_REFUSED` (stop and alert), `ISSUER_RPC_DISAGREEMENT` (stop and alert), and `ISSUER_OPEN_SUBMIT_UNKNOWN` (recover by account read before any resend). No open job is marked complete based only on an RPC send acknowledgement.

## 2. Web app ↔ issuer HMAC channel

The Next route calls `supabase.auth.getUser()` and refuses without a verified session. It maps that `auth.user.id` through the server-side user repository (`getUser({authId: auth.user.id})`) and uses the resulting `users.id`; the body, query string, seller wallet, or client-provided `userId` never sets identity. The route canonicalizes and serializes the JSON once, then signs those exact UTF-8 bytes. The issuer recomputes the raw-body digest before JSON parsing.

Headers: `X-FlexSoar-Key-Id`, `X-FlexSoar-Timestamp` (Unix seconds, decimal), `X-FlexSoar-Nonce` (16 random bytes, base64url), `X-FlexSoar-User` (canonical `users.id` UUID), and `X-FlexSoar-Signature` (lowercase hex HMAC-SHA-256).

Exact canonical string, UTF-8, LF between lines, no final LF:

```text
flexsoar-issuer-v1
<UPPERCASE_METHOD>
<exact-path-without-query>
<timestamp-decimal>
<nonce-base64url>
<users.id-lowercase-uuid>
<lowercase-hex-sha256-of-raw-body>
```

Signature is `HMAC-SHA-256(K[kid], canonicalString)`. No query parameters are accepted on these routes. The verifier checks timestamp ±60 seconds, key ID, exact path/method, body digest and constant-time MAC before the nonce store or application logic. It atomically consumes `(kid,nonce)` in a local durable journal owned by the issuer OS user (directory 0700, records 0600, fsync before dispatch); entries remain for 10 minutes. Cleanup deletes only entries older than the 10-minute horizon. The single supervised process is not a substitute for durable replay state.

The web app may send only identifiers and seller-authored proof material: listing ID, stable prepare request ID, linked wallet/network proof fields and signature, exact seller-signed listing bytes/signature, or attempt ID. It may not send or choose a quote, price, FX rate, floor, expiry, seller/buyer identity, payout/token account, mint, treasury, issuer, program, config, card/sale commitments, PDA, ALT, permit, or transaction instruction as authority. Such fields are fetched, derived, or checked against DB and pinned operator configuration. Seller-signed listing bytes are accepted as a claim to verify, never trusted as authoritative without reconstruction and verification. Before displaying the seller signing prompt, the web route must independently fetch the authenticated seller's `fn_payment_v2_listing_view(listingId)` result and verify the issuer response's quote, binding, floor, and expiry against that DB result; the browser displays those independently checked numeric values and signs only the exact reconstructed message. This protects against a buggy or compromised issuer response; it cannot make a fully compromised signing UI honest.

**HMAC key rotation.** Each key has a non-secret `kid`; secrets are random 32-byte values stored outside both repos in the web secret store and issuer-owned secret file/secret manager. Rotation stages a new key on the issuer, switches web signing to its `kid`, accepts old+new for at most 10 minutes, then removes the old key. Emergency rotation revokes old immediately and invalidates outstanding requests. Never put either key in logs, client bundles, command-line arguments, or committed files. HMAC rotation does not rotate the Solana issuer signer or DB credentials.

## 3. `IssuerSigner` and Privy spike

Proposed interface:

```ts
interface IssuerSigner {
  readonly publicKey: string; // canonical base58 issuer address
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
  signMessage(message: Uint8Array): Promise<Uint8Array>; // only if a future issuer operation needs it
  health(): Promise<{ ok: true } | { ok: false; code: 'SIGNER_UNAVAILABLE' }>;
}
```

The service verifies every returned signature against `publicKey` and the exact serialized message. Signer implementations never receive a caller-provided transaction without the endpoint's full local validation. The only production uses are fee-paying/signing the paired `open_sale` transaction and issuer co-signing the validated `buy_sale` transaction.

**Key-file implementation.** Load one Solana CLI JSON byte-array keypair at process startup from a path outside the repo. Require a regular file, no symlink, owner UID equal to the dedicated issuer OS user, mode exactly 0600 (no group/other access), and public key equal to the issuer configured in the pinned network. Fail startup otherwise. Do not expose a key export, HTTP signing oracle, shell, debug dump, or log of key bytes; do not write rotated keys to disk from the service. Restart under the issuer OS identity after founder-managed rotation. If compromised, pause funding, rotate on chain through governance, replace the key, and verify no old signer remains configured.

**Privy server-wallet option (public-docs spike, 2026-10-23).** Privy documents server-side Solana wallets and policy rules for `signTransaction` / `signAndSendTransaction`. Its current policy docs say a Solana transaction is allowed only when every instruction is allowed; the policy can compare `solana_program_instruction.programId` and decode `solana_instruction_data` using a modern Anchor IDL with explicit discriminators and an `instruction_name` condition. The IDL `address` is ignored, so program-ID and instruction-data rules must both be present. A policy can therefore allow only this pinned program ID and the named `open_sale`/`buy_sale` instructions, plus the Ed25519 precompile needed for the paired opening transaction; unrelated programs default deny. Configure no `signAndSendTransaction` rule if the issuer must broadcast only through its own checked RPC path. See [Privy policy overview](https://docs.privy.io/controls/policies/overview) and [wallet policies and controls](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls).

**Verdict: viable for the canary, conditionally.** Public docs confirm the policy primitives required by D4: Solana program allow-list, decoded instruction allow-list, per-instruction evaluation, and default deny. Before choosing it for the canary, an implementation spike must verify the actual wallet policy against both production instruction encodings and both flows; no Privy account or API call was made for this design task. Keep the key-file implementation as fallback.

**Pricing.** Privy's public pricing page currently lists a free Developer tier with 50,000 monthly signatures, Core at $299/month for 500–2,499 MAU and Scale at $499/month for 2,500–9,999 MAU, and custom Enterprise pricing (including a published signature price “as low as $0.001/signature”). Confirm eligibility and contract terms with Privy before the canary; this review did not request a quote. Source: [Privy pricing](https://www.privy.io/pricing).

**Latency.** Privy's May 2026 engineering post reports a 30–45 ms signing improvement and a 72.42 ms median Solana wallet-operation latency from 1,000 SLATE runs; its 2024 server-wallet announcement claims under-200-ms signature times. These are vendor measurements, not FlexSoar end-to-end latency or an SLA. Source: [Reducing trading latency](https://www.privy.io/blog/reducing-trading-latency-on-privy) and [Introducing server wallets](https://privy.io/blog/introducing-server-wallets).

**Failure modes and limits.** Public docs describe server rate limits, policy default-deny, authorization signatures, and policy/simulation refusals. A denied or failed request must not be retried by broadcasting a substitute transaction. Treat timeout after signing as unknown: recover by the exact message/signature, not a new sale or buyer debit. Privy's API, enclave, rate limits, network, or policy changes can make the canary signing path unavailable; alert and fail closed. No exact Privy per-request latency, canary quote, uptime commitment, or support commitment was confirmed. Public docs did not establish that the current Node SDK can partially sign this exact v0 transaction containing the pinned ALT while preserving the buyer's empty signature slot; that is a required spike check, not a confirmed fact. Sources: [Node SDK setup](https://docs.privy.io/basics/nodeJS-node/setup), [policy evaluation and Solana instruction conditions](https://docs.privy.io/controls/policies/overview), and [security architecture](https://docs.privy.io/security/wallet-infrastructure/architecture).

## 4. “No bare `open_sale`” property

**Code boundary.** Only a private `buildPairedOpenSaleTransaction(context,storedListing)` helper may construct or submit opening transactions. It obtains bytes via `fn_payment_v2_listing_for_open`, calls `openSaleWithListing`, checks the returned instruction sequence is exactly `[Ed25519Program, pinnedProgram.open_sale]`, and passes only that sequence to the issuer signer and sender. Do not export a raw open instruction builder from the issuer module. No generic operation executor gets the issuer signer or issuer RPC; its `open_sale` branch returns `SKIP_ISSUER_OWNED` before context lookup/signing. Future production migration fence remains mandatory per F7.

**Static grep test.** Add a test that runs `grep -R` over `workers/issuer` for `openSaleInstructionFromContext`, raw `open_sale` instruction constructors, and `sendRawTransaction`. Assert the raw builder appears only in the paired helper, and every send call is reachable only from that helper's paired result. Assert no executor module imports `IssuerSigner` or the issuer open-sale submitter. Keep the grep allow-list tiny and path-specific so moving code cannot silently bypass the check.

**Unit test.** With fake signer/RPC, assert the accepted transaction has exactly two ordered instructions (Ed25519 verify, matching open-sale program instruction), the Ed25519 message and signer equal the stored listing, the open instruction matches sale/card/generation/domain/program, and fee payer/signer equal the pinned issuer. Assert rejection for no stored listing, bad signature, wrong order, extra instruction, bare `open_sale`, mismatched sale, changed floor/expiry, stale state, and a present-but-conflicting PDA. The fake sender must receive zero calls on every rejected case.

## 5. Enrollment proof and chain checks

Exact UTF-8 signed bytes, LF line endings, no final LF:

```text
FlexSoar wallet enrollment v1
network:<base58-genesis-hash>
user:<canonical-lowercase-users-uuid>
wallet:<base58-32-byte-pubkey>
mint:<base58-32-byte-pubkey>
token-account:<base58-32-byte-associated-token-address>
issued-at:<canonical-unix-seconds>
```

The web route obtains `user` from the authenticated server session; the wallet signs the exact challenge bytes using Ed25519. The issuer decodes and canonicalizes every field, checks user against HMAC and D7, checks timestamp, checks linked wallet in DB, and verifies the signature under that wallet's public key. The proof digest written to 084 is `SHA-256(messageBytes || signatureBytes)`; the raw proof is not stored in the database or logs.

Derive the Associated Token Account with the associated-token program and the `wallet`, pinned token program ID, and pinned mint from the network row. Require the supplied token-account address equal the derived PDA. On both independently configured RPCs, verify `getGenesisHash` equals the pinned genesis; the mint account exists, is owned by the pinned token program, is initialized and has six decimals; the ATA exists, is owned by the pinned token program, decodes as initialized/non-frozen, and contains exactly the pinned mint and wallet authority. Require the two providers return identical mint/ATA account owner and data at finalized commitment. Any disagreement, missing account, wrong owner/mint/authority, frozen/uninitialized state, or wrong decimals refuses enrollment. D9's primary and cross-check RPCs are independent configuration; neither endpoint string nor account data comes from the browser.

Only after proof and chain checks call 084's issuer-only `fn_payment_v2_enroll_wallet`. SQL independently requires a MY user, `users.solana_address` match, known network, 32-byte values, uniqueness, and immutability. Signature and ATA truth remain the issuer's responsibility, as the migration states.

## 6. Threat model

| Threat | What it can do | What remains enforced / response |
|---|---|---|
| Compromised web app | Send forged internal requests for users whose sessions it can exercise; manipulate identifiers, deny service, or deceive a seller about what a wallet is signing. | HMAC and D7 gate service access; body values are hints only. DB supplies owner, price, wallet and sale state. The seller signature binds the bytes, but a dishonest UI can misrepresent those bytes; do not claim the on-chain floor protects a seller who was tricked into signing a lower floor. Buyer must still co-sign `buy_sale`. |
| Compromised issuer host | Read its DB credential and signer; attempt any transaction permitted by signer policy; corrupt local RPC/quote checks or try to return a false quote. | Web route independently checks signing values against the authenticated listing view; on-chain issuer identity, seller/buyer signatures, sale PDA, seller-bound ATA, seller-signed floor, funding gate, `max_trade`/`max_escrow` caps, and program checks still apply. It cannot forge seller or buyer signatures or redirect immutable sale destinations. A host compromise can still cause denial of service and should trigger pause, signer rotation, and forensic review. |
| Leaked HMAC key | Spoof calls and the signed `users.id` field until revoked; exploit any allowed-user action. | D7, DB-derived state, seller proof, buyer signature, floor and caps limit authority, but HMAC is an internal authentication boundary. Revoke key immediately, rotate with new `kid`, inspect nonce/request logs, and consider web compromise. |
| Replayed request | Repeat an authenticated body within its timestamp window. | Durable atomic nonce consumption rejects the same `(kid,nonce)`; business idempotency keys make a fresh-nonce retry recover the same enrollment, sale, listing, or permit. No write is repeated blindly after unknown outcome. |
| RPC lies or split view | Feed false ATA state, stale blockhash, or false account status. | Pin genesis and program; cross-check account reads on two independent providers at finalized commitment; compare account bytes and DB commitments. On disagreement stop. RPC agreement is not cryptographic proof against collusion; the on-chain program remains final authority for transaction validity. |
| DB error, timeout, or malicious row | Refuse, return stale data, or leave write outcome uncertain. | `payment-postgres.ts` validates database identity and dedicated login and reports uncertain outcomes distinctly. Do not retry with new business IDs. Read back using the same stable key, preserve exact DB refusal, and stop on malformed context. SQL constraints/triggers, immutable snapshots, and on-chain checks remain additional gates. |

On-chain controls cap each trade and aggregate escrow, bind seller and token destinations, require issuer plus buyer signatures for `buy_sale`, and enforce the seller-signed minimum floor at purchase. The issuer service cannot make funding live: funding remains paused until the separate founder canary decision and configured caps. These controls limit issuer misuse but do not make a compromised issuer host harmless.

## 7. Test plan and Phase 2 exit test

**Unit tests with fake RPC and signer:** HMAC canonicalization, exact ±60-second boundary, constant-time invalid MAC handling, replay after process restart, key rotation overlap/revocation, D7 rejection, all endpoint schemas/refusal order, proof canonicalization/signature/expiry/ATA, two-provider disagreement, integer FX conversion, quote expiry and retry recovery, SQL error/outcome-unknown mapping, seller binding/floor/expiry, wrong seller or buyer, attempt permit-to-instruction equality, pinned ALT validation, partial issuer signature verification, and every no-bare-open case in §4. Ensure a failed validation makes zero signer/send calls.

**Container integration:** against a fresh isolated 078→085 replay plus any separately reviewed forward reader migration, run the real `psql` transport with dedicated issuer role. Exercise enrollment (including non-MY, wrong linked wallet, duplicate ATA, proof digest idempotency), prepare (wrong owner, fenced listing, funding off, stable request ID and conflicting reuse), record-listing (valid proof, tampered binding, bad signature, low floor, expired message, exact retry and conflict), authorize (wrong buyer, expired quote, authority rotation, exact permit retry), and open queue (no listing, valid listing, prepared → pair built but not sent). Assert executor cannot call issuer-only readers and its open-sale handler skips before context/signing. Keep the container network-none; no external RPC, Privy account/API, keys, staging DB, or production DB in this phase.

**Phase 2 exit test from `worker-build-plan.md`:** unit tests with fake RPC + fake signer refuse tampered message, wrong signer, substituted sale, expired listing, floor outside tolerance, unenrolled wallet, wrong-mint ATA, replayed HMAC, and missing allow-list. Container integration proves `prepare -> record_listing -> listing_for_open -> open transaction built (not sent)` matches `openSaleWithListing` byte for byte. Add the static grep test and assert no bare open transaction reaches the fake sender. This document does not claim those tests have run.

## Unconfirmed items for independent review

1. Privy docs support policy conditions, but the exact Node SDK partial-sign behavior for our v0/ALT transaction, policy behavior for the Ed25519 precompile, and the canary plan/price remain unverified without an account/API test or a quote.
2. The existing DB API lacks issuer-readable listing-owner/price context and caller-bound attempt context. The proposed `fn_payment_v2_issuer_subject_context` is a future forward-migration prerequisite and has not been authored.
3. FX snapshot schema and its exact rounding rule are proposed here; they need review and a provider decision before implementation.
4. The real D7 UUIDs, pinned canary network/mint/program, issuer wallet, approved FX source, and reviewed lookup-table addresses are founder-provisioned values and intentionally absent from this document.
5. The executor lease fence is still a separately reviewed future migration before executor production operation.
