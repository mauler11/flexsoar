# P2a - Issuer service design and Privy spike (R6 revision)

**Status: design only; independent review R6b required before implementation.** No service code, migration, key, account, API call, or deployment was created for this revision. It defines the issuer lane, the endpoint and trust contracts, a future migration 086 design, and the public-documentation Privy spike. The issuer belongs to `workers/` under `track/payment-security` and uses `lib/db/payment-postgres.ts` (`psql`) only; no pg driver.

## Decisions and existing boundaries

- Founder decisions D1, D4-D7 remain as recorded in `worker-build-plan.md`, "Decisions taken": issuer-only wallet enrollment writer; devnet key file and canary Privy only after a successful policy spike (otherwise 0600 key file); 10-minute quote and 24-hour canary listing; explicit seller prepare action; D7 founder/friend user allow-list. Funding remains disabled until its separately approved canary window.
- **Identity:** the issuer independently verifies the end-user Supabase access JWT and requires JWT `sub` to equal the canonical `X-FlexSoar-User` assertion covered by HMAC. HMAC remains request integrity and web-app authentication; it is not user authentication.
- **Identity schema evidence:** migration 001 initially gave `users.id` its own UUID default and declared a separate nullable `auth_id`. Migration 004 documents the provisioning invariant and installs a trigger rejecting `id <> auth_id` when `auth_id` is set. Migration 006's self-insert policy requires both `id = auth.uid()` and `auth_id = auth.uid()`. Thus auth-provisioned users have `users.id = auth_id = auth.users.id`; legacy rows without `auth_id` do not qualify for issuer identity and fail closed. The subject reader never accepts a caller user ID.
- **JWT dependency:** direct local JWT verification requires Supabase asymmetric signing keys and a published JWKS. Do not accept HS256 or call Supabase Auth as a fallback. Founder must confirm the project's signing mode before enabling the issuer.
- 083/084/085 are applied to staging and frozen. Do not edit them. Migration 085 already fences executor RPCs; migration 086 below is a forward-only design for issuer reader, nonce store, and open-sale leases.
- Funding stays off until the separately approved canary window. No configuration supplied by a request can enable it.

## 1. HTTP endpoints and exact contracts

All public issuer requests are HTTPS `POST`. Maximum raw body 32 KiB; JSON is UTF-8, strict, duplicate keys and unknown fields refused. UUIDs are lowercase canonical form. Public keys are canonical base58 32-byte values. Signatures and binary data are unpadded base64url. Monetary quantities, generations, slots, and Unix times are canonical decimal strings unless a schema explicitly marks a bounded JSON integer. Responses use the exact endpoint schema shown. Common errors are:

```json
{"error":{"code":"ISSUER_*","message":"safe stable text","retryable":false,"requestId":"<uuid>"}}
```

No error includes SQL, credentials, signature bytes, or raw RPC response. DB errors may have an allow-listed `dbCode`. Unknown transaction outcome returns `503 ISSUER_DB_OUTCOME_UNKNOWN`; callers use the same business idempotency key and a fresh HMAC nonce. The HTTP layer never reports an uncertain commit as a definite failure.

### Common validation order

1. Require TLS, method, exact path without query, content type, raw-body size, and required headers. Hash raw bytes before JSON parsing.
2. Parse HMAC key id, canonical decimal timestamp, 16-byte base64url nonce, canonical asserted user UUID, and 32-byte hex MAC. Reject duplicate/malformed headers.
3. Enforce issuer-clock timestamp window of -+/-60 seconds. Rebuild the canonical string in -2, verify HMAC-SHA-256 in constant time.
4. Verify the bearer Supabase JWT independently: fixed issuer, pinned JWKS URL, allowed asymmetric algorithm, known `kid`, signature, exact audience `authenticated`, required valid `exp`, canonical UUID `sub`, and `sub == X-FlexSoar-User`. Enforce at most 30 seconds future skew for `nbf`/`iat` when present. Refuse missing or unknown required claims. No HS256/legacy-secret verification.
5. Require subject in the deployment D7 allow-list.
6. Atomically consume `(kid, nonce)` using the migration-086 issuer-only nonce RPC. Reject duplicate, expired, unknown, or retired key id. If the DB is unavailable, do not dispatch endpoint work.
7. Parse strict JSON and validate exact endpoint schema; then perform endpoint validation below in listed order. No signer or sender is called before every applicable validation succeeds.

Common refusals: `ISSUER_BAD_REQUEST` 400; `ISSUER_AUTH_REQUIRED`, `ISSUER_AUTH_INVALID`, `ISSUER_AUTH_EXPIRED`, `ISSUER_AUTH_SUB_MISMATCH`, `ISSUER_AUTH_REPLAY` 401; `ISSUER_USER_NOT_ALLOWED` 403; `ISSUER_RATE_LIMITED` 429; `ISSUER_DB_UNAVAILABLE`, `ISSUER_DB_OUTCOME_UNKNOWN`, `ISSUER_JWKS_UNAVAILABLE` 503; `ISSUER_INTERNAL` 500. Rate limits are initial design values: enrollment 5 challenges and 5 completions/10 minutes/user, prepare 3/minute/user, record 10/minute/user, authorize 10/minute/user. Return `Retry-After`; limits are not a security boundary. No endpoint trusts that a request came from the web app alone.

### `POST /v1/enroll-wallet`

Challenge request:

```json
{"phase":"challenge","networkGenesis":"<base58-genesis>","wallet":"<base58-wallet>"}
```

Challenge response:

```json
{"networkGenesis":"<base58-genesis>","wallet":"<base58-wallet>","mint":"<base58-mint>","tokenAccount":"<derived-ata>","issuedAt":"<unix-seconds>","message":"<exact-UTF8-proof>"}
```

Complete request:

```json
{"phase":"complete","networkGenesis":"<base58-genesis>","wallet":"<base58-wallet>","mint":"<base58-mint>","tokenAccount":"<base58-ata>","issuedAt":"<unix-seconds>","signature":"<64-byte-signature-base64url>"}
```

Complete response:

```json
{"enrolled":true,"networkGenesis":"<base58-genesis>","wallet":"<base58-wallet>","mint":"<base58-mint>","tokenAccount":"<base58-ata>","proofDigest":"<sha256-hex>"}
```

**Validation order / DB / idempotency.** First validate exact phase schema and canonical encodings; derive network from pinned issuer configuration and require requested genesis equals it. Call the 086 reader's `network` kind with NULL subject ID and server-configured network ID to fetch/validate the stored network row; it returns no user data and accepts no user ID. Derive wallet identity only from the already verified JWT `sub`; the request wallet is a candidate and is not trusted as linked. Derive ATA from candidate wallet, pinned token program, mint, and associated-token program. For challenge, return proof fields and message only; no write. For completion, require every supplied network/wallet/mint/ATA field to equal the derived values; `issuedAt` canonical decimal and no older than 5 minutes or more than 30 seconds in the future; reconstruct exact UTF-8 message and verify Ed25519 under wallet key. Query both independent RPC providers for genesis on this request; apply finalized-slot agreement in -5 and validate mint/ATA accounts. Then call `fn_payment_v2_enroll_wallet(p_user,p_network,p_wallet,p_token_account,p_proof_digest)` through `payment_v2_issuer`, setting `p_user` only to verified JWT `sub`. Existing 084 SQL checks `users.solana_address` and country against this user, so a wallet not linked to the verified subject refuses at this final gate; challenge creation alone grants no enrollment authority. Exact same user/network/wallet/token-account/proof-digest is idempotent; any changed field is a refusal, never an update. 084 returns void for exact insertion/no-op; transport uncertainty is not success.

Refusals: `ISSUER_NETWORK_MISMATCH` 403; `ISSUER_WALLET_MISMATCH` 403; `ISSUER_PROOF_EXPIRED`, `ISSUER_PROOF_INVALID`, `ISSUER_PROOF_MALFORMED` 422; `ISSUER_ATA_MISMATCH`, `ISSUER_MINT_INVALID`, `ISSUER_TOKEN_ACCOUNT_INVALID`, `ISSUER_RPC_DISAGREEMENT` 422; RPC unavailable `ISSUER_RPC_UNAVAILABLE` 503; exact enrollment conflict `ISSUER_ENROLLMENT_CONFLICT` 409. Preserve 084 DB codes: `PAYMENT_V2_WALLET_USER_NOT_MY`, `PAYMENT_V2_WALLET_ADDRESS_MISMATCH`, `PAYMENT_V2_WALLET_NETWORK_UNKNOWN`, `PAYMENT_V2_WALLET_MALFORMED`, `PAYMENT_V2_WALLET_ENROLLMENT_CONFLICT`, `PAYMENT_V2_WALLET_TOKEN_ACCOUNT_USED`.

### `POST /v1/prepare-sale`

Request:

```json
{"listingId":"<uuid>","requestId":"<uuid>"}
```

Response:

```json
{"saleId":"<uuid>","listingId":"<uuid>","cardId":"<uuid>","generation":"<u64>","networkGenesis":"<base58>","program":"<base58>","quote":{"currency":"USDC","decimals":6,"totalMicroUsdc":"<u64>","validFrom":"<unix-seconds>","expiresAt":"<unix-seconds>","fxSnapshot":{"schemaVersion":1,"baseCurrency":"MYR","quoteAsset":"USDC","quoteDecimals":6,"unit":"micro-USDC-per-MYR-sen","method":"symmetric-midpoint","maxDisagreementBps":50,"rounding":"ceil-seller-favour","rateNumerator":"<positive-integer>","rateDenominator":"<positive-integer>","totalMicroUsdc":"<u64>","sources":[{"providerId":"<id>","quoteId":"<opaque-id>","rateNumerator":"<positive-integer>","rateDenominator":"<positive-integer>","observedAt":"<RFC3339-UTC>"},{"providerId":"<different-id>","quoteId":"<opaque-id>","rateNumerator":"<positive-integer>","rateDenominator":"<positive-integer>","observedAt":"<RFC3339-UTC>"}] }},"listing":{"minTotalMicroUsdc":"<u64>","expiresAt":"<unix-seconds>","messageBase64url":"<61-byte-message>"}}
```

This versioned `fxSnapshot` is stored with the quote and returned byte-for-byte from the stored row on retries. Rates mean micro-USDC per MYR sen. Provider IDs must be independently configured and distinct. Both quotes must be at most 600 seconds old and no more than 30 seconds future. Let `A = rate1.numerator * rate2.denominator`, `B = rate2.numerator * rate1.denominator`; require `400 * abs(A-B) <= A+B` (relative difference from arithmetic midpoint <= 0.5%). Agreed midpoint is `(A+B)/(2 * d1 * d2)`. Calculate `totalMicroUsdc = ceil(priceCents * (A+B) / (2*d1*d2))` with integer arithmetic only. Use bounded big integers; inputs, each product, sum, denominator, and final amount must fit documented unsigned 256-bit intermediates and `totalMicroUsdc` must be positive and <= `2^64-1`; reject zero, negative, malformed, overflow, stale, disagreeing, or noncanonical values. Quote lifetime is <=10 minutes. Rounding up is always in seller's favour. The seller confirmation screen displays MYR price, each provider name/rate, midpoint rate, and micro-USDC amount. The founder is the canary seller; residual risk from provider collusion, source mispricing, and arithmetic/implementation faults is explicitly accepted for this founder-controlled canary only.

**Validation order / DB / idempotency.** Validate exact request shape/UUIDs. Call 086 subject reader with `('listing',listingId,configuredNetworkId)`; require returned owner equals JWT `sub`, is D7-allowed, and listing is public/active, inventory registered, unfenced, and owned by the seller. Require returned network and program/config/mint/token-program match pinned config and funding is enabled; otherwise refuse. Fetch two independent provider quotes and validate schema, freshness, agreement, overflow, and rounded total. Set stable `p_terms.id=requestId`, derive sale and escrow PDAs from DB context and pinned program, create the ten-minute stored snapshot, then call `fn_payment_v2_prepare_sale(p_listing_id,p_network_id,p_terms)` using the exact `PaymentSaleTerms` fields. Read prepared sale context with `fn_payment_v2_issuer_context(saleId,'open_sale')`, then return stored quote plus the sale-bound listing message/floor. Same request ID with same listing/terms recovers the original sale and snapshot; any changed listing or terms under that ID maps to `ISSUER_SALE_IDEMPOTENCY_CONFLICT` 409. No fresh FX read can mutate an existing sale.

Refusals: `ISSUER_LISTING_NOT_FOUND` 404; `ISSUER_LISTING_NOT_OWNED`, `ISSUER_USER_NOT_ALLOWED`, `ISSUER_NETWORK_MISMATCH` 403; `ISSUER_LISTING_UNAVAILABLE`, `ISSUER_FUNDING_DISABLED`, `ISSUER_SALE_IDEMPOTENCY_CONFLICT`, `ISSUER_QUOTE_EXPIRED` 409; `ISSUER_FX_UNAVAILABLE`, `ISSUER_FX_STALE`, `ISSUER_FX_DISAGREEMENT`, `ISSUER_FX_INVALID`, `ISSUER_FX_OVERFLOW` 503 for provider outage, otherwise 422; `ISSUER_DB_OUTCOME_UNKNOWN` 503. Preserve DB codes including `PAYMENT_V2_NOT_CONFIGURED`, `PAYMENT_V2_SALE_FENCED`, `PAYMENT_V2_SELLER_WALLET_REQUIRED`, and `PAYMENT_V2_SALE_IDEMPOTENCY_CONFLICT`.

### `POST /v1/record-listing`

Request:

```json
{"saleId":"<uuid>","messageBase64url":"<61-byte-message>","signatureBase64url":"<64-byte-signature>"}
```

Response:

```json
{"saleId":"<uuid>","recorded":true,"listingExpiresAt":"<unix-seconds>","minTotalMicroUsdc":"<u64>"}
```

**Validation order / DB / idempotency.** Validate exact keys, UUID and canonical base64url/lengths. Read `fn_payment_v2_issuer_subject_context('sale',saleId,NULL)` (network derived from sale); require returned owner equals verified JWT `sub` and D7. Require opening state, unchanged sale/listing commitment and quote, current policy, and expiry satisfying `quoteExpiresAt <= listingExpiresAt <= dbIssuedAt + 86400`, with DB-anchored `issuedAt` and overflow-safe integer arithmetic. Reconstruct 61-byte message from DB domain/program/card/sale/generation; verify tag, binding, seller signature using stored seller wallet, floor within stored tolerance and expiry. Then call `fn_payment_v2_record_listing(p_sale,p_message,p_signature)`; SQL repeats binding/floor/expiry checks. Exact byte/signature retry is idempotent; different bytes for the sale refuse.

Refusals: `ISSUER_SALE_NOT_FOUND` 404; `ISSUER_SALE_NOT_OWNED`, `ISSUER_USER_NOT_ALLOWED` 403; `ISSUER_SALE_NOT_OPENING`, `ISSUER_LISTING_STALE`, `ISSUER_QUOTE_STALE`, `ISSUER_LISTING_CONFLICT` 409; `ISSUER_LISTING_MESSAGE_MALFORMED`, `ISSUER_LISTING_BINDING_INVALID`, `ISSUER_LISTING_SIGNATURE_INVALID`, `ISSUER_LISTING_FLOOR_OUT_OF_TOLERANCE`, `ISSUER_LISTING_EXPIRED` 422; `ISSUER_DB_OUTCOME_UNKNOWN` 503. Preserve 083 DB codes `PAYMENT_V2_SALE_MISSING`, `PAYMENT_V2_LISTING_MALFORMED`, `PAYMENT_V2_NOT_CONFIGURED`, `PAYMENT_V2_LISTING_BINDING`, `PAYMENT_V2_LISTING_FLOOR_OUT_OF_TOLERANCE`, `PAYMENT_V2_LISTING_EXPIRY`, `PAYMENT_V2_LISTING_CONFLICT`.

### `POST /v1/authorize-attempt`

The web app first creates an attempt via authenticated `fn_payment_v2_initiate(p_listing_id,p_idempotency_key,p_policy_version,p_policy_digest)`. SQL derives buyer identity from that session. The issuer receives only the durable attempt ID.

Request:

```json
{"attemptId":"<uuid>"}
```

Response:

```json
{"attemptId":"<uuid>","permitSha256":"<hex>","transactionBase64url":"<serialized-v0-transaction>","issuer":"<base58>","buyer":"<base58>","recentBlockhash":"<base58>","lastValidBlockHeight":"<u64>","signer":"issuer-partial"}
```

**Validation order / DB / idempotency.** Validate exact schema and UUID. Read `fn_payment_v2_issuer_subject_context('attempt',attemptId,NULL)`; require owner equals verified JWT `sub` and D7, attempt pending/authorizable, unexpired, and sale current. Then call `fn_payment_v2_authorize_attempt(p_attempt_id)` for the immutable 690-byte permit. Check permit length, policy/version, and network/program/config pins; rebuild expected `buy_sale` from DB context and permit. Load only operator-pinned lookup tables; verify lookup table owner/address set and expanded account metas. Fetch fresh blockhash only after every DB/permit/transaction check. Pin issuer fee payer, program and issuer keys; require exactly one expected instruction and reject every other instruction/writable account. Pass only typed validated transaction to the selected signer; verify issuer partial signature over exact message and preserved empty buyer signature slot; return serialized result. Same attempt returns the same stored permit; a fresh blockhash may make a different transaction. No transaction is broadcast by this endpoint.

Refusals: `ISSUER_ATTEMPT_NOT_FOUND` 404; `ISSUER_ATTEMPT_NOT_OWNED`, `ISSUER_USER_NOT_ALLOWED` 403; `ISSUER_ATTEMPT_UNAVAILABLE`, `ISSUER_ATTEMPT_EXPIRED`, `ISSUER_AUTHORITY_ROTATED`, `ISSUER_SALE_STALE` 409; `ISSUER_PERMIT_INVALID`, `ISSUER_TRANSACTION_INVALID`, `ISSUER_LOOKUP_TABLE_INVALID` 422; `ISSUER_BLOCKHASH_UNAVAILABLE`, `ISSUER_SIGNER_UNAVAILABLE` 503; `ISSUER_DB_OUTCOME_UNKNOWN` 503. Preserve DB codes `PAYMENT_V2_ATTEMPT_MISSING`, `PAYMENT_V2_AUTHORIZATION_DISABLED`, and `PAYMENT_V2_AUTHORITY_ROTATED`. Any refusal has zero signer and sender calls.

### Background `open_sale` submitter (no public HTTP endpoint)

Read candidates from `fn_payment_v2_open_sale_queue(p_limit)` with `1 <= p_limit <= 20`, then claim a ready batch through proposed 086 `fn_payment_v2_claim_open_sale(p_limit)` before work; it atomically returns operation ID, sale ID, lease UUID, fencing token, and expiry. Read `fn_payment_v2_issuer_context(saleId,'open_sale')` and `fn_payment_v2_listing_for_open(saleId)`; require D7 seller, pinned genesis/program/issuer, current sale/listing state, and exact stored 61-byte message/signature. The 084 queue is a read-only candidate view, not a lock. Renew with proposed `fn_payment_v2_renew_open_sale_lease(operationId,leaseId,fencingToken)` and complete through `fn_payment_v2_finish_open_sale(operationId,leaseId,fencingToken,outcome,signature)`; both require the current lease ID and monotonically increasing fencing token. Expired/stale workers cannot record success; an already submitted chain transaction may still land after lease expiry, so on restart/unknown send outcome read the PDA and reconcile exact contents before resubmitting. PDA state is final for deduplicating completed opens.

Before signing, check sale PDA: exact immutable sale/card/generation/seller/floor match means already submitted and awaits verifier; conflict stops and alerts. If absent, verify seller signature and rebuild precisely `[Ed25519 verify, pinned open_sale]`, pin fee payer/issuer/program and all account metas, pass through the common transaction validator and signer, then send. Never mark complete from RPC send acknowledgement alone. Lease completion RPC checks fencing token and only records outcome; verifier records finalized lifecycle.

Migration 085 changes `fn_payment_v2_claim_operations` to lease only `execute_outcome` and `acknowledge_claim`. Its finish/context/signed/stage RPCs refuse other actions (`PAYMENT_V2_OPERATION_LEASE_LOST` or `PAYMENT_V2_EXECUTOR_ACTION_FORBIDDEN` as applicable), with signed/stage restricted to `execute_outcome`. Therefore executor cannot claim `open_sale`; this was verified in `085_payment_v2_executor_action_fence.sql`. Keep the executor handler's early `SKIP_ISSUER_OWNED` before context/signing as defense in depth. No further executor fence migration is designed here.

Open-submit refusals: `ISSUER_OPEN_QUEUE_INVALID`, `ISSUER_OPEN_LISTING_MISSING`, `ISSUER_OPEN_CONTEXT_MISMATCH`, `ISSUER_OPEN_WRONG_STATE`, `ISSUER_OPEN_ACCOUNT_CONFLICT`, `ISSUER_BARE_OPEN_REFUSED`, `ISSUER_OPEN_LEASE_LOST`, `ISSUER_RPC_DISAGREEMENT` stop and alert; `ISSUER_OPEN_SUBMIT_UNKNOWN` requires read-before-retry. Extra instruction or writable account is `ISSUER_TRANSACTION_INVALID`. Zero signer/sender calls on any rejected request.

## 2. Web app -" issuer identity and HMAC

The Next server route obtains a session access JWT, forwards the exact bearer token, and derives the asserted identity from the verified route session's `auth.user.id` (the JWT `sub`). It must not map a client `userId`, body, query, or wallet to identity. The issuer verifies the JWT independently against the project-pinned issuer and JWKS; after verifying schema invariant evidence above, that `sub` is the `users.id`. Require HMAC asserted UUID equals JWT `sub`.

Pin `iss=https://<project-ref>.supabase.co/auth/v1`, `aud=authenticated`, and a fixed JWKS URL `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` for the deployment's known project ref. Initially configure exactly `ES256`; any other asymmetric algorithm needs explicit review and configuration pin. Reject `none`, all HMAC algorithms including HS256, unknown `kid`, and keys with wrong `kty`/curve/use. Cache verified JWKS locally for at most five minutes; one bounded refresh on unknown `kid`, then refuse. Supabase documents an edge cache of up to 10 minutes for JWKS, so rotation/revocation propagation may be longer than the local cache and must be included in incident response. Required claims: signature, issuer, audience, `exp`, canonical UUID `sub`; allow no more than 30 seconds future skew for `nbf` and `iat` if present. Require JWT lifetime bounded by the project access-token policy (design maximum 1 hour); reject if `exp-iat` exceeds it when `iat` is present. No Auth API fallback.

If founder finds legacy-secret signing is still active: block issuer launch. Confirm dashboard has migrated the legacy secret into Signing Keys and an asymmetric standby key is visible; deploy/test the asymmetric-only verifier while issuer endpoints remain disabled; rotate signing to the asymmetric key; require clients to refresh tokens (old HS256 sessions receive 401 by design); confirm newly issued JWTs are the pinned asymmetric alg and JWKS verification succeeds; wait at least maximum legacy JWT lifetime plus 15 minutes, then revoke the legacy secret. Never temporarily accept HS256. If verification or client refresh fails, keep issuer disabled and restore/fix signing configuration before enabling; do not weaken the verifier. Supabase describes migration, rotation, JWKS and legacy revocation in its [JWT Signing Keys documentation](https://supabase.com/docs/guides/auth/signing-keys) and [JWT signing keys announcement](https://supabase.com/blog/jwt-signing-keys). The actual project mode is unconfirmed; founder is checking.

Headers: `X-FlexSoar-Key-Id`, `X-FlexSoar-Timestamp` (Unix seconds decimal), `X-FlexSoar-Nonce` (16 random bytes base64url), `X-FlexSoar-User` (canonical UUID), and `X-FlexSoar-Signature` (lowercase hex HMAC-SHA-256). Exact UTF-8 canonical string, LF separators, no final LF:

```text
flexsoar-issuer-v1
<UPPERCASE_METHOD>
<exact-path-without-query>
<timestamp-decimal>
<nonce-base64url>
<users.id-lowercase-uuid>
<lowercase-hex-sha256-of-raw-body>
```

Signature is `HMAC-SHA-256(K[kid], canonicalString)`. Issuer consumes nonce using 086 table `payment_v2.issuer_hmac_nonces` with unique `(kid,nonce)`, DB-generated expiry, atomic insert/consume, issuer-only RPC. Retain at least 10 minutes. Key IDs are recorded in append-only `payment_v2.issuer_hmac_key_ids`; reuse of any current or retired `kid` is forbidden. Rotation registers a never-used `kid`, stages it, switches web route, accepts overlap for at most 10 minutes, retires old key ID permanently, then destroys old secret; emergency rotation revokes immediately. Nonce DB outage or corrupt/unknown state fails closed.

The web app may send IDs and seller-authored proof only: listing ID, stable prepare request ID, linked wallet enrollment fields/signature, seller-signed listing bytes/signature, attempt ID. It may never send prices, FX, floors, expiry, owner/buyer, wallet destinations, mint, treasury, issuer, program, config, card/sale commitments, PDA, ALT, permit, account list, or instruction as authority. Issuer re-derives these from DB and pinned configuration. Seller signing screen independently reads the authenticated listing view and displays MYR price, both FX sources/rates, midpoint, and amount from stored snapshot; it compares those against reconstructed signed bytes. This can detect issuer response mismatch, not a compromised display environment.

## 3. IssuerSigner, transaction validator, and custody modes

Custody mode is immutable at process startup (`key-file` or `privy`). Unknown setting or failed startup check disables signing. Runtime errors never change modes and there is no automatic fallback.

Before either signer mode, an issuer-process transaction validator takes a typed operation and DB-derived context, rebuilds the one expected transaction, and compares the entire message. For opening: exact Ed25519 precompile plus pinned program `open_sale` pair, exact seller proof, sale/card/generation/domain/floor/expiry, pinned issuer fee payer, exact account metas/writability. For purchase: exact single pinned `buy_sale`, decoded permit equality, pinned issuer fee payer and buyer, allow-listed ALT expansion and exact writable/read-only accounts. Reject every other instruction, program, writable account, signer, fee payer, or ALT. Never accept serialized arbitrary transaction as a signer request.

`IssuerSigner` is an operation-specific typed API:

```ts
type SignRequest =
  | { kind: 'open-sale-pair'; operationId: string; leaseId: string; fencingToken: string; saleId: string; serializedTransactionBase64url: string; expectedMessageSha256: string; listingMessageBase64url: string; sellerSignatureBase64url: string }
  | { kind: 'buy-sale'; attemptId: string; permitSha256: string; serializedTransactionBase64url: string; expectedMessageSha256: string };
interface IssuerSigner {
  publicKey: string;
  signValidated(request: SignRequest): Promise<{ signedTransactionBase64url: string }>;
  health(): Promise<{ ok: true } | { ok: false; code: 'SIGNER_UNAVAILABLE' }>;
}
```

The issuer process validates DB context, rebuilds the full expected transaction, and sends a typed request over a local Unix socket to a distinct signer process running as a separate OS user. Socket permissions and peer credentials are checked. The signer process has no DB, RPC, or other network credentials; it accepts only the two operation variants, re-parses the transaction, checks pinned program/issuer/fee payer, exact allowed instruction sequence and account writability, and verifies that only the expected signature slot changes. It returns a signed serialized transaction; the issuer verifies the complete message and signatures again before any send. The key-file mode can meet this boundary. Privy mode requires an app secret and outbound network access to Privy in the signing adapter. Placing those in the signer violates the no-network-credentials rule; placing them in the issuer process removes the signer-process boundary for that mode. This is an unresolved architecture conflict, so Privy mode is unavailable under the current constraints unless a separately reviewed credential-broker design is explicitly accepted.

**Key file.** Dedicated signer OS user; JSON key file outside repo, regular non-symlink, mode exactly 0600, owned by that user; load at startup only; verify derived public key equals pinned issuer. Never export, log, or rewrite key. Stop on permission/key mismatch. Rotation is founder-managed restart with new pinned public key and on-chain authority transition.

**Privy server-wallet startup self-check.** Read and pin wallet public key, policy ID and version; require policy constraints for exact program ID and exact `open_sale`/`buy_sale` instruction names/data; allow only the Ed25519 precompile condition needed by open pair; deny all other instructions by default. Confirm no `signAndSendTransaction` capability/rule; only low-level signing is enabled. Confirm partial signatures are preserved and only the expected signature slot changes on both transaction formats. Any denial, unknown policy version/condition, unsupported SDK behavior, or mismatch disables signing at startup and keeps it disabled until explicit restart/config review. No fallback to key-file.

**Public-docs spike (2026-10-23; no account or API calls).** Privy's policy documentation describes Solana instruction-level checks including program ID and Anchor IDL instruction decoding; every instruction is evaluated, and unspecified requests default to deny. This makes program plus named-instruction restrictions appear expressible. Policy docs do not prove this deployment's exact policy or behavior for the Ed25519 precompile, and public docs reviewed did not confirm Node SDK partial-signature preservation for this exact v0+ALT/open-pair flow. **Verdict: not viable for the canary under the current signer isolation constraint.** The policy primitives are promising, but the credential/network conflict above and unconfirmed partial-signature behavior remain blockers. A separately reviewed exception/credential-broker architecture plus successful startup and integration checks could change the verdict; until then use only the explicitly selected key-file mode. Unknown/denied behavior stops signing; there is no automatic fallback.

Pricing is time-sensitive and vendor-published: the public page currently lists Developer free up to 50K signatures and $1M monthly volume; Core $299/month for 500-2,499 MAU; Scale $499/month for 2,500-9,999 MAU; Enterprise custom, with signature pricing advertised as low as $0.001/signature. Limits, overage, and quote must be rechecked before purchase. See [Privy pricing](https://www.privy.io/pricing). Public documentation does not provide a canary-specific price or SLA.

Latency: Privy's May 2026 post reports Solana median signing latency of 72.42 ms in 1,000 SLATE runs and a 30-45 ms improvement across wallet operations; its under-200-ms end-to-end claim includes a combined swap flow and is not a measure of this issuer's signing-only path. These are vendor measurements, not an SLA. Measure our exact policy and transaction from the deployment region before a canary. Failure modes include API/network denial, policy simulation/refusal, rate limiting, timeout after remote signing, service/key outage, and SDK incompatibility. Fail closed; on unknown signing/send outcome recover by exact message/signature and chain read, never by weakening policy or fallback signer. Sources: [Privy latency report](https://www.privy.io/blog/reducing-trading-latency-on-privy), [policies overview](https://docs.privy.io/controls/policies/overview), [wallet policies and controls](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls), [Node SDK setup](https://docs.privy.io/basics/nodeJS-node/setup), [wallet infrastructure architecture](https://docs.privy.io/security/wallet-infrastructure/architecture).

## 4. No bare `open_sale` property

**Code boundary:** one private paired-open builder consumes DB listing bytes, verifies seller signature and listing binding, rebuilds `[Ed25519 verify, pinned open_sale]`, invokes the common transaction validator, and calls signer/sender only on the accepted pair. Do not export a raw open instruction constructor. Executor handler skips `open_sale` before context/signing even though 085 DB fence already excludes it.

**Static grep test:** scan `workers/` for raw `open_sale` constructors, `openSaleInstructionFromContext`, and `sendRawTransaction`; assert raw constructor and send are confined to the paired builder and no executor imports issuer signer/submitter. Keep path allow-list explicit and narrow.

**Unit test:** fake signer/RPC checks exactly two ordered instructions, seller proof/message, sale/card/generation/domain, pinned program/issuer fee payer and exact accounts. Reject missing listing, invalid signature, wrong order, bare or extra instruction, wrong program, any altered writable account, mismatched sale/floor/expiry, stale state, conflicting PDA and stale lease. Assert zero signer and zero sender calls on every rejected case. Open-sale lease/race/restart cases are in -7.

## 5. Enrollment proof and two-provider finalized checks

Exact signed UTF-8 bytes; LF separators, no final LF:

```text
FlexSoar wallet enrollment v1
network:<base58-genesis-hash>
user:<canonical-lowercase-users-uuid>
wallet:<base58-32-byte-pubkey>
mint:<base58-32-byte-pubkey>
token-account:<base58-32-byte-associated-token-address>
issued-at:<canonical-unix-seconds>
```

`user` is JWT `sub`, checked against HMAC assertion and D7. Wallet signs exact bytes with Ed25519; issuer verifies and hashes `messageBytes || signatureBytes` with SHA-256. Proof body is never logged or stored. ATA derives from associated-token program, wallet, pinned token program, and mint. Both providers independently return the configured genesis **on every enrollment request**.

For each provider, read `getSlot(finalized)`; refuse if slots differ by more than 32. Let `target=min(slotA,slotB)`. Fetch mint and ATA with finalized commitment and `minContextSlot=target` from both; require each context slot >=target and no more than 32 slots beyond target; require exact owner and raw account-data equality, plus decode checks: mint initialized, pinned token program owner, six decimals; ATA initialized/non-frozen, pinned token program owner, exact mint and wallet authority. Any missing account, slot disagreement, genesis mismatch, malformed account, or provider split refuses. Provider independence is an operator configuration requirement, not something the service can cryptographically establish.

Only after all proof and chain checks call `fn_payment_v2_enroll_wallet`. 084 requires MY user, linked address, known network, 32-byte values, uniqueness and immutability; exact idempotence is precisely same `(user,network,wallet,token_account,proof_digest)`. Same user/network/wallet with any changed token account or proof digest refuses; token account reused by another row refuses. Never treat a different proof for an existing enrollment as an update.

## 6. Migration 086 design (not authored)

Forward-only schema design, issuer-only grants and negative ACL tests required before implementation:

1. `fn_payment_v2_issuer_subject_context(p_kind text,p_subject_id uuid,p_network_id uuid) RETURNS jsonb`, one SQL statement/snapshot, security definer with fixed search path, executable only by `payment_v2_issuer`. No user-id parameter. Per-kind NULL rules are hard SQL refusals; subject-owned kinds return owner for comparison to verified JWT `sub`.
   - `network` (used for enrollment): subject ID **must be NULL**, network ID **must be non-NULL** and resolve uniquely; exact result `{found:true,networkId,genesis,mint,tokenProgram,associatedTokenProgram,fundingEnabled}`; all fields non-NULL. This reads the configured network row only and returns no user identity. The 084 enrollment writer independently checks the verified `sub`'s linked wallet and country.
   - `listing`: subject ID non-NULL listing UUID; network ID non-NULL and equal to stored network; result `{found:true,listingId,ownerId,listingStatus,cardId,cardStatus,priceCents,inventoryRegistered,saleFenced,networkId,genesis,program,config,mint,tokenProgram,fundingEnabled}`. All fields required/non-NULL. Missing listing is SQL refusal.
   - `sale`: subject ID sale UUID; network ID **must be NULL**; derive network from sale. Result `{found:true,saleId,listingId,ownerId,cardId,networkId,state,sellerWallet,quoteTotalUnits,quoteValidFrom,quoteExpiresAt,toleranceBps,preparedAt,fxSnapshot,issuerTerms}`. Every field required/non-NULL. Missing sale is SQL refusal.
   - `attempt`: subject ID attempt UUID; network ID **must be NULL**; derive from attempt/sale. Result `{found:true,attemptId,ownerId,saleId,networkId,state,expiresAt,permitHex}`; all required/non-NULL except `permitHex` may be NULL only before authorization; missing attempt is SQL refusal.
   - `prepare_recovery`: subject ID is request UUID; network ID must be NULL; returns exact stored prepare result using a single snapshot: either `{found:false}` when no matching request exists or the exact sale result shape above. No other kind may return `found:false`.
   - Unknown kind, NULL-swap, wrong network nullability, unknown/ambiguous network, missing subject except documented prepare recovery, or incomplete/nullable required output hard-refuses. SQL checks stored ownership filters; service compares returned `ownerId` with independently verified subject. No row-level PII beyond the fields listed.
2. `payment_v2.issuer_hmac_nonces(kid,nonce,expires_at)` with unique `(kid,nonce)`, DB-derived expiry and atomic insert/consume RPC `fn_payment_v2_consume_issuer_nonce(kid,nonce)`. Duplicate returns stable replay refusal; failure to consume fails closed. `issuer_hmac_key_ids` is issuer configuration/audit state with unique append-only key IDs/fingerprints/status; retired IDs remain forever and cannot be reused.
3. Add durable open-sale lease/claim RPCs for issuer, not executor: `fn_payment_v2_claim_open_sale(p_limit integer)`, `fn_payment_v2_renew_open_sale_lease(p_operation_id uuid,p_lease_id uuid,p_fencing_token bigint)`, and `fn_payment_v2_finish_open_sale(p_operation_id uuid,p_lease_id uuid,p_fencing_token bigint,p_outcome text,p_signature text)`. Claim atomically uses `FOR UPDATE SKIP LOCKED` on a ready operation, returns lease UUID, monotonically increasing fencing token and expiry; renew/finish require matching operation, lease ID and token. Old token is refused after reclamation. Candidate queue remains read-only. Chain transaction can land after lease expiration; fencing prevents stale DB completion, while PDA read reconciles chain truth.

All nullability errors, cross-user access, forbidden roles, wrong network, unknown kinds, missing subjects, nonce replay, key-id reuse and stale fencing tokens need explicit negative cases in the migration integration plan. These are proposals, not claims about existing 083-085 functions.

## 7. Stale-state rules

The 24-hour listing cap is anchored to DB `sales.created_at` captured for the prepared sale (`preparedAt`), not issuer wall clock or request time. DB functions use their own transaction time and overflow-safe arithmetic; require listing expiry >= quote expiry and <= `preparedAt + 86400`.

| Transition | Immutable commitment | Re-read under lock / immediately before action |
|---|---|---|
| prepare | stable request ID, selected DB listing and FX snapshot once inserted | current owner/status/price/card, inventory registration/fence, funding/network and enrolled seller wallet before prepare RPC |
| record listing | sale ID, stored quote/snapshot, domain/program/card/sale/generation and seller wallet | sale/listing state, quote validity, fence, stored owner and DB-anchored preparedAt under SQL sale lock |
| open submit | stored listing bytes/signature and immutable sale commitments | operation lease/fencing token, sale/listing current state, PDA and account state immediately before signing/sending |
| authorize attempt | durable attempt ID, buyer, immutable permit terms | attempt/sale state, expiry, authority epoch, funding/config, buyer enrollment under authorization RPC locks; re-read immediately before signer |
| signing/sending | validated full message and exact signature slot | lease token/state plus fresh chain/blockhash context; any mismatch aborts before signer or sender |

Race tests must cover cancel/fence/price changes after prepare, stale quotes/listing, authority rotation, duplicate open submitters, send-before-read unknown outcome, expired lease worker resumption, attempt replay, concurrent nonce consume, and enrollment/prepare idempotency races. Issuer software cannot make a malicious RPC truthful; disagreement stops.

## 8. Threat model

| Threat | Capability | Remaining controls and limit |
|---|---|---|
| Compromised web app | Can alter requests, suppress UI, or misrepresent a seller screen. | Cannot assert another `sub` without a valid JWT for that subject; issuer JWT verification + HMAC equality + D7 + DB owner check. Seller can still be deceived by compromised signing display. Buyer must co-sign. |
| Compromised issuer application | Can request operations and lie in its FX/RPC handling. | Separate signer accepts typed operations only; validator rebuilds allowed transaction; on-chain issuer/seller/buyer signatures, seller floor, seller-bound destinations, funding gate and caps remain. Can deny service; bug in trusted validator/host remains serious. |
| Compromised signer process or key | Can misuse issuer key subject to its own typed checks; root/host compromise can defeat OS isolation. | Transaction validator is in front of both modes; on-chain seller signature/floor, buyer co-sign, program checks and caps constrain transactions. Full signer-host/root compromise is not claimed harmless; pause funding and rotate issuer authority. |
| Leaked HMAC key | Can forge web-app integrity headers but cannot mint a valid end-user JWT. | JWT sub equality, D7, ownership and transaction rules still apply; revoke/rotate `kid`, inspect logs. A simultaneous valid JWT/session theft can exercise that subject until exp/revocation. |
| Replayed request | Re-send within timestamp tolerance. | Atomic DB nonce `(kid,nonce)` consumption rejects replay; business idempotency makes exact fresh-nonce retries recover same result. Expired/reused kid refused. |
| Stolen/valid session JWT | Act as that subject until token expiry or key/session revocation; logout alone may not instantly invalidate an offline-verifiable JWT. | Short token lifetime, asymmetric key revocation/JWKS refresh (Supabase edge cache may be up to 10 minutes, plus issuer cache), D7 removal, DB ownership, seller/buyer signature and caps. Incident response disables subject/issuer and revokes signing key if needed; no promise of instantaneous per-session revocation. |
| RPC lies / split view | False account, slot, blockhash or confirmation. | Pin genesis; two-provider finalized checks and slot/data agreement; program validates transaction. Colluding providers can lie, delay or cause fees/DoS; stop on disagreement. |
| DB error, stale row, uncertain commit | Refusal, malformed context, lost reply. | Single-snapshot reader, DB locks for transitions, idempotency and leases; preserve refusal/unknown status. No signer/sender call on failed context. Stop on uncertain result until readback. |
| FX sources collude/misprice | Agree on a bad rate or bad external market data. | Two independent providers, 0.5% agreement, freshness, integer conversion, seller-favour rounding and transparent seller screen. Founder-controlled seller canary explicitly accepts residual source risk; does not generalize approval to other sellers. |

The program enforces issuer identity, seller signature/floor, buyer co-signature, sale destinations, trade and aggregate escrow caps. These bound misuse; they do not neutralize compromised signer host or manipulated seller display.

## 9. Test plan and R6 exit criteria

**Unit (fake RPC and fake signer):** JWT alg/kid/issuer/audience/expiry/sub/skew/JWKS rotation; HMAC canonicalization/equality; replay, expired nonce, retired kid; strict schemas and refusal order; exact enrollment proof, wrong network/user/wallet/mint/token account, proof replay and slot boundaries; FX provider agreement, ages, rational boundary, seller-favour rounding, integer conversion, overflow and tampering; subject-reader null contracts; DB outcome mapping; stale-state gates; both signer modes, startup denial/unknown and no fallback; altered/extra instruction, writable-account, ALT, fee payer and partial signature rejection. Assert zero signer and zero sender calls for every rejected request.

**Container integration:** fresh isolated 078→085 replay plus proposed 086 when authored; real `psql` transport and roles. Verify reader ACL/nullability/owner filters/cross-user refusals; 085 executor claim refuses `open_sale`; nonce atomic consume and key-id reuse; enrollment exact idempotence and cross-network/user/mint/token-account replay refusal; two-provider finalized-slot agreement; prepare stable idempotency and FX tampering/boundaries; record binding/floor/expiry; authorize wrong buyer/expired permit/authority rotation; duplicate open submitter lease, stale fencing token, crash/restart and unknown-send recovery. Match `prepare -> record_listing -> listing_for_open -> paired open transaction` byte-for-byte; do not send in this test. Program test harness checks below-floor buy and unenrolled buyer. Isolated container only; no external RPC, real key, production, or staging.

The following **R6 exit criteria are verbatim** and block implementation approval:

1. Session identity is independently verified by the issuer or the residual D7 impersonation authority is explicitly accepted.
2. Freeze FX schema/provider/rounding and prove price-to-quote conversion with boundary and tampering tests.
3. Review the forward subject-reader SQL, including nullability, role ACLs, ownership filters, and negative cross-user cases.
4. Prove both signer modes fail closed and cannot sign altered/extra instructions; no automatic mode fallback.
5. Verify 085's executor fence with a negative claim test and update the stale design statement.
6. Add race/restart tests for duplicate open submitters, unknown send outcome, nonce journal crash, stale quote/listing transitions, and concurrent replay.
7. Enrollment integration tests must prove cross-network/user/mint replay refusal and two-provider finalized-slot rules.
8. Require zero signer and zero sender calls for every rejected request, plus a negative buy-below-floor and un-enrolled buyer test against the isolated 078→085 database replay and program test harness.

These criteria describe required tests; this docs-only revision did not run or claim them. The Phase 2 exit test in `worker-build-plan.md` remains: unit tests with fake RPC/signer refuse tampered message, wrong signer, substituted sale, expired listing, floor outside tolerance, unenrolled wallet, wrong-mint ATA, replayed HMAC and missing allow-list; container integration proves prepare -> record_listing -> listing_for_open -> open transaction built (not sent) matches `openSaleWithListing` byte-for-byte.

## 10. Unconfirmed items / implementation blockers

1. Founder has not yet confirmed whether the Supabase project currently issues asymmetric JWTs. Issuer launch is blocked until asymmetric signing and pinned JWKS are verified; HS256 fallback is prohibited.
2. Migration 086 reader, nonce/key-id tables and open-sale lease RPCs do not exist. They need separate SQL review/authorization and must implement the exact contracts above.
3. Exact FX providers, credentials, quote authenticity method, units normalization, source independence, provider SLA and seller screen are unconfigured. The two-provider policy and schema are design decisions for review, not operational evidence.
4. Privy public docs do not establish exact policy behavior for our Ed25519 instruction or partial-signature preservation for this v0+ALT transaction. No account/API test, live policy self-check, canary quote, or dependable latency figure was obtained. Privy is not approved unless the spike proves these points.
5. D7 UUIDs, network/mint/program/issuer values and ALT addresses remain founder-provisioned configuration and are intentionally absent.
6. This document does not claim the R6 exit tests have passed. Independent review R6b is the next step; implementation must wait.
