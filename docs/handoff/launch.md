# Manual order requests — track/launch

## Behavior and scope

Card listing UI offers an email-only manual order request. No database writes,
payment initiation, reservation mutation, ledger mutation or ownership transfer.
Existing Solana recovery remains reachable through Payment status; its code is
unchanged. The historical checkout-return query no longer replaces recovery
with the old polling panel.

`MANUAL_CHECKOUT_ENABLED=true` enables server-side allowlist evaluation.
`config/manual-checkout.json` ships as `{}`. Add listing UUID keys with exactly
`{"status":"open"}` or `{"status":"reserved"}`. Missing/invalid entries and
flag-off are Coming soon. Both page and POST enforce the gate. Current listing
status, seller, order and MYR price are re-read through the session client;
client-supplied identity, price and payment destination are ignored.

## Vercel configuration and rollout

- `MANUAL_CHECKOUT_ENABLED`: leave unset/false until ready; use `true` to enable.
- `MANUAL_USDC_ADDRESS`: verified Solana wallet address for mainnet USDC receipts;
  server environment only, rendered deliberately as a public payment destination.
- `RESEND_API_KEY`: existing secret; never rendered or returned.
- `FROM_EMAIL`: existing Resend-verified sender.
- `SUPPORT_EMAIL`: monitored operations inbox (existing default info@flexsoar.net).
- `NEXT_PUBLIC_SITE_URL`: canonical HTTPS site origin for the email QR URL
  (defaults to https://flexsoar.net).
- Existing Supabase URL/anon-key bindings remain required for sign-in and reads.

Replace `public/payments/duitnow-qr.png` with the verified business QR before
opening any listing. The shipped image is visibly labelled PLACEHOLDER and
cannot be scanned for payment. Verify Resend sender/provider configuration and
run a controlled email delivery check before enabling; no live messages were
sent during implementation.

Requests are NOT reservations. Staff must confirm availability before asking
for payment, manually update allowlist status/redeploy, verify money in the
business account and arrange collection/refunds. No automatic five-day timer,
settlement, card transfer or refund is introduced. MYR prices are not silently
converted to USDC: staff confirms the USDC amount before the buyer sends.

## Limits

The existing in-memory limiter enforces five attempts/hour by each user AND IP
per runtime instance, including invalid/honeypot attempts after authentication.
It resets on cold starts and is not global across Vercel instances. A strict
global quota needs shared state or a platform control; none was added because
this task prohibits database writes. Forwarded IP assumes trusted Vercel ingress.

References have the requested 40 bits of cryptographic randomness (FS- plus
eight RFC 4648 base32 characters). With no durable store there is no global
uniqueness constraint or exactly-once retry guarantee. Treat browser/network
and provider failures as ambiguous; the UI asks buyers to contact support
before submitting again or paying. Resend uses an idempotent two-message batch
per generated reference, but a new submission generates a new reference.

## New exports

- `manualCheckoutStatus(listingId: string): ManualCheckoutStatus`
- `manualPaymentConfig(): { address: string; qrUrl: string }`
- `validateContact(value: unknown): ManualOrderContact`
- `orderReference(): string`
- `manualOrderMessages(order: ManualOrderEmail)`: support/buyer text + HTML templates
- `sendManualOrderEmails(order: ManualOrderEmail): Promise<void>`
- `ManualOrderForm({ listingId }: { listingId: string })`: client request form
- POST `/api/manual-orders`, server page `/order/[listingId]`
- Types/constants in `lib/manual-checkout/`: contact/email/status shapes, UUID
  pattern, seller disclosure and payment instructions.

## Validation

43 focused tests cover gates/CTA, signed-out refusal, malformed/oversized input,
contact validation, honeypot, both rate-limit dimensions and reset, client price
and identity ignored, unavailable listings, reference format/distinctness,
escaping, and the two-message Resend contract/provider failures.

Final `npm test`: 883 passed, 5 failed, 3 skipped (891 total).

Next route-type generation resolves initially missing generated types, then
TypeScript passes. Full suite retains five baseline signer socket failures:
`unshare: cannot open /proc/self/uid_map: Read-only file system`. Production
build remains blocked fetching Geist/Geist Mono from Google Fonts, as in the
baseline. Database, payment-v2, Solana program and ledger/card logic were not
changed. Real sign-in/listing reads and email delivery were not live-tested.
