# Handoff — track/market

Items filed by the market track. Numbered within this file. Created on
`track/market` at `861dfd8` (before `main`'s handoff split was visible here).

Read before building: `AGENT_RULES.md`, `docs/HANDOFF-shared.md`, the admin
handoff, and — critically — `lib/api/contract.ts`, because `docs/handoff/data.md`
**does not exist on any branch yet** (checked `track/data`, `main`, and
`remotes/localmain` on 2026-08-11). The contract on this branch is what the
sections below are written against. When the real `data.md` lands, read it
instead of trusting this file.

---

## What track/market built (this pass)

Shipped and verified (`next build`, `tsc --noEmit`, `npx eslint`, `npm test`
= 77 passing) at 2026-08-11. Everything lives under `app/(market)/**` and
`components/market/**`; nothing outside was touched.

1. `app/(market)/layout.tsx` — market shell: header (brand, market + profile
   links, signed-in handle/sign-out via `signOut` from `(auth)`), Footer, and
   `ToastProvider`. Root `app/layout.tsx` untouched.
2. `app/(market)/page.tsx` — browse grid at `/`. Renders `getListings({
   viewerId, brand, model, sizeUs, tier, sort })`. URL-driven filters:
   **brand / model / size / tier / sort** (recent, price_asc, price_desc,
   float_desc, public_at_asc). Early-access visibility comes out of the
   contract's own filter, fed the signed-in `viewerId`.
3. `app/(market)/card/[id]/page.tsx` — detail: `CardDetail` hero, provenance
   chain, oracle fair value + grading notes strip, and three caller-dependent
   panels: **owner** (list/cancel + redeem), **buyer/anon** (BuyPanel / 
   OrderPoll), or a "not on the market" note.
4. `app/(market)/u/[handle]/page.tsx` — public profile from `public_profiles` +
   `levels`: rank name, level, xp, portfolio value, live listings (visibility
   filtered for the caller), trade history table from `card_provenance`. Never
   reads `users`. (WAITS on handoff item 1.)
5. `app/(market)/actions.ts` — Server Actions, the only mutators on the lane:
   - `listCardAction(formData)` — owner re-check, active card, no live listing.
   - `cancelListingAction(formData)` — seller re-check.
   - `createCheckoutAction(listingId)` — gate re-check, self-purchase refusal,
     then a Stripe Checkout Session with
     `payment_intent_data.metadata = { listing_id, buyer_id }` (without it the
     webhook logs `not recorded`); redirects to Stripe. The client NEVER calls
     `purchaseCard`.
   - `getListingForOrderAction(listingId)` — wrapped `getListing` poll target
     (handoff text below had called it `getListingForOrder`; actual name is
     `getListingForOrderAction`).
   - `redeemCardAction(formData)` — owner re-check + address validation; fee is
     the server-side constant, not client input.
   Errors redirect with the server text verbatim in `?error=` (belt-and-braces
   over the upstream gates).
6. `app/(market)/queries.ts` — `currentUserId`, `currentUserLevel`,
   `getPublicProfileByHandle`, `getTradeHistory`, and the pinned
   `REDEMPTION_HANDLING_FEE_CENTS = 1500`.
7. `components/market/**` — `Banner`, `Countdown` (hydration-safe ticking
   timer), `MarketTile`, `MarketFilters`, `BuyPanel` (level gate UI + countdown
   + unlock flip), `OrderPoll` (polls to `order.status === 'settled'`),
   `ListForm` (price in FSC, 15%-below-oracle **warning, not block**),
   `RedeemForm`, `ProvenanceChain`, and the shape adapter `bridge.ts`
   (`CardSummary`/`SkuRef`/`ListingRef` → pure-prop `Card`/`Sku`/`Listing`).

Client components are only the interactive ones (filters, countdown, forms,
buy/poll); every mutation is a Server Action; the contract is never imported
from a client file.

## Actions on other tracks

### 1. Need `getPublicProfile(handle)` — `app/(market)/u/[handle]` uses a local read until it lands

Your item 14 list is exactly right: `getUser({ handle })` returns null for a
stranger since 006, and nothing else in the frozen contract turns a handle into
a profile. I chose your option 1 — please add `getPublicProfile(handle)` — but
built the page against a local read so it compiles and renders today.

**Local workaround in `app/(market)/queries.ts` (my lane, server-only):** reads
`public_profiles` (the view your contract's own embeds use), `levels`, `cards`
(public), and `card_provenance` (no RLS in 001) directly through
`createServerSupabase()`. Never touches `users`. All three reads are flagged in
the file as waiting on `getPublicProfile`.

What I'd want from `getPublicProfile(handle)` if/when it ships:

- `{ id, handle, level, rank_name, xp_total, portfolio_value_cents, created_at }`
  where `rank_name` comes from `levels.name DO NOT leak email/is_admin/is_consignor`.
- The trade history could ride along (`card_provenance` joined to
  cards/skus is not secret), but `getCards({ ownerId })` plus a provenance read
  already covers it, so a plain profile object is enough to unblock.

### 2. Listings sort default and the 1000-row ceiling (from your item 10)

Nothing to do — acknowledged, not a block. `getListings()` defaulting to
`('early_access','public')` is exactly what the market grid wants, and the
`float_asc` / `float_desc` JS-rank-within-1000 is accepted; I expose
`price_asc` / `price_desc` / `recent` / `public_at_asc` as DB-sorted in the
sort control and keep `float_*` available behind the same control.

### 3. Checkout gate must run BEFORE the Stripe Session, not rely on the webhook

`fn_purchase_card` raises EARLY_ACCESS_LOCKED at webhook time — after the
buyer has paid. A below-level buyer paying then learning the sale could not be
recorded is money moved with no card. `createCheckoutAction` therefore
re-checks the same gate (level >= `early_access_level` while `now < public_at`)
against the buyer's `users.level` before creating the Session, and refuses with
the same EARLY_ACCESS_LOCKED semantics — the BuyPanel also disables the button
with the reason (level required / sign-in). The webhook stays the last line of
defence, not the first; this UI should never reach it locked.

### 4. No source for the redemption handling fee

`fn_redeem_card(p_fee_cents)` takes the fee as an argument and the rest of the
schema records it, but nothing tells a UI what the fee IS. I pinned a constant
(`REDEMPTION_HANDLING_FEE_CENTS = 1500` in `app/(market)/queries.ts`, USD
cents, surfaced in the redeem form). A `levels.perks` value or a
`platform_config` row would be the right home; happy to read it from wherever
track/data puts it.

### 5. Stripe environment variables still absent

DEPS.md already lists `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` as needed.
Confirmed both are still missing from `.env.local` (only the three Supabase
vars are present). The checkout action surfaces a readable error when unset;
no code change needed once they land.

### 6. `components/market/bridge.ts` `toSku()` drops `art_url` — market tiles never show uploaded art

Investigated the "card tiles render the sprite instead of the uploaded art"
report. The data side is clean: `SKU_REF_COLUMNS` and `SKU_COLUMNS` in
`lib/api/contract.ts` both select `art_url` (contract.ts:687-692), and it
survives every read on this lane —
`getListings`/`getListing`/`getCard`/`getSkus` all embed the full `SkuRef`
(via `SKU_REF_COLUMNS`) or `SkuSummary` (`SKU_COLUMNS`) row, and
`toCardSummary` (contract.ts:968-984) passes the embedded `sku` object through
`requireEmbed` unchanged — nothing drops `art_url` before it reaches
`app/(market)/**`.

The gap is `toSku()` in `components/market/bridge.ts:31-48`. It hand-builds
the `Sku` row from `SkuRef` field-by-field and never copies `art_url`, so
every page that calls it (`app/(market)/page.tsx` and `u/[handle]/page.tsx`
via `MarketTile`, `card/[id]/page.tsx` via `toSku` directly) hands
`components/card/CardArt.tsx` a `sku.art_url` of `undefined`. `CardArt.tsx:40`
checks `sku.art_url ?` to decide sprite vs. uploaded PNG, so it always falls
back to the sprite renderer regardless of what's in the database.

Fix is a one-line addition — `art_url: sku.art_url,` in the returned object —
but `components/**` is outside this track's lane (AGENT_RULES.md), so I did
not make the edit. Filing here per the lane-boundary rule; `getPublicProfile`
(item 1) shape is unaffected, this is display-only.

---

## Lane boundary flags

- **`app/page.tsx` (create-next-app scaffold) is DELETED — the market grid
  owns `/`.** `app/(market)/page.tsx` resolves to `/`, and route-groups docs
  are explicit that two routes may not resolve to the same path. The scaffold
  page was tracked (all worktrees have it) and belongs to no track's prompt.
  Keeping it breaks `next build` outright. I deleted the scaffold file and the
  browse grid lives at `/` (as instructed). If that was not intended, restore
  `app/page.tsx` from git and re-point the market root.
- `components/card/**` and `components/ui/**` were NOT edited. The grid and
  detail pages adapt the contract's `CardSummary`/`SkuRef`/`ListingRef` shapes
  onto the pure-prop `Card`/`Sku`/`Listing` components via
  `components/market/bridge.ts`, so design-track files stay untouched.
- Nothing in `lib/**` was edited. All reads go through `lib/api/contract.ts`
  except the three workaround reads in `app/(market)/queries.ts` (item 1).
- No writes to tables outside the contract's RPCs. `listCard`, `cancelListing`,
  `redeemCard` are only ever called through the contract.

## Resolved (from earlier shared handoff items)

- Item 8 (contract is server-only): honored — every contract import is in a
  Server Component or a Server Action; client components call the actions.
- Item 8's poll: `OrderPoll` polls the Server Action, not the contract.
- Item 14's placeholder fields: never rendered from an embedded user except
  handle/level; the profile page value comes from `public_profiles` (which 007
  widened) not from `UserSummary.portfolio_value_cents`.

---

# Self-serve listing flow (`/list` + `/dashboard`) — items for track/data

Built the whole front door in this pass (2026-08-13). The **UI is complete**;
four pieces of backend surface block true persistence. Each is filed below
with the EXACT shape this track calls, so granting them is mechanical. Until
they land, `app/(market)/list/actions.ts` + `app/(market)/intake/rpc.ts` call
the RPCs by name through the session client and surface the PostgREST
"function does not exist" (42883) as a clear, honest message — the wizard is
otherwise fully interactive and validated. None of this touches the frozen
contract (`lib/api/contract.ts`); reads always go through it.

### What this pass built (the flow itself)

- `app/(market)/intake/rpc.ts` — server-only seam. Calls the M1/M2/M3 RPCs **by
  name** through `createServerSupabase().rpc(...)` and detects a missing
  function (PostgrestError 42883 / "function … does not exist") as an
  `IntakeUnavailableError` so the UI can say exactly what isn't wired. When
  track/data ships the contract functions, delete this file and import from the
  contract.
- `app/(market)/list/actions.ts` — Server Actions: `getUploadTargetAction`,
  `fileSkuRequestAction`, `submitListingIntakeAction` (server-side validation of
  all six components 0..1 `numeric(3,2)`-exact, https-only photo URLs,
  cash re-gate via `getRedemptions`), `getPayoutEligibilityAction`. These return
  structured `ActionResult` objects (wizard stays put, shows the outcome inline)
  rather than redirecting.
- `app/(market)/list/page.tsx` — server page: streams `getSkus({})` + payout
  eligibility into the wizard.
- `app/(market)/dashboard/page.tsx` — seller dashboard: submissions
  (`getConsignments` consignor), held items (items flattened from
  `getConsignment` details), owed redemptions with a "ship by" deadline
  (M5), and the cash-gate meter.
- `components/market/intake/**` — `intake-config.ts` (angles, six condition
  questions, disclaimer), `SkuPicker`, `SkuRequestForm`, `PhotoUploader`
  (target → PUT → url), `ConditionWizard`, `SelfDeclaredCondition` (amber,
  dashed, SELF-DECLARED, never FloatBar), `PricePayout` (price beside oracle
  value), and `IntakeWizard` (5-step orchestrator, review screen, "in review"
  done state).
- A self-declared float **never** renders like a FlexSoar-graded float: the
  preview is `SelfDeclaredCondition`, visually distinct (amber dashed strip,
  warning copy, no tier colouring), and submission stores answers in
  `items.self_declared`, never the 008 `grade_*` columns.
- Nav: "List" always visible, "Dashboard" and "Profile" when signed in
  (`app/(market)/layout.tsx`).

Verified at 2026-08-12: `next build`, `tsc --noEmit`, `npx eslint`, `npm test`
= 87 passing.

### M1. RESOLVED — intake write path goes through the frozen contract's `submitListing` (013)

Superseded by `docs/handoff/data.md` item 9: 013 already wraps a seller-custody
submission path (`submitListing`, session client, derives the actor from
`auth.uid()`) and it was live-verified there — positive submission lands a
`pending_review` item with `custody=seller`, `grade_source=seller_declared`,
the six component scores set, and `float` equal to the rubric weighted sum.
There was never a need for a bespoke `fn_submit_listing_intake` RPC; the old
`app/(market)/intake/rpc.ts` seam (which called a nonexistent function by
name) is deleted, and `app/(market)/list/actions.ts` now calls `submitListing`
directly. No action needed from track/data on this item.

### M2. "Not listed?" path — `sku_requests` table + `fn_file_sku_request` (BLOCKING)

The picker dead-ends for shoes not in the catalog; the failure mode the task
called out ("file a request rather than dead-ending"). Requested table
(a migration, human's job):

```sql
create table sku_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id),
  brand           text not null,
  model           text not null,
  colorway        text,
  size_us         numeric(4,1),
  notes           text,
  status          text not null default 'open',   -- 'open' | 'reviewed' | 'catalogued'
  created_at      timestamptz not null default now()
);
alter table sku_requests enable row level security;
-- own insert, own read, admin read-all — mirror 009's consignments policies
```

```sql
fn_file_sku_request(
  p_brand text, p_model text, p_colorway text default null,
  p_size_us numeric(4,1) default null, p_notes text default null)
returns uuid
```
session client, `user_id` = `fn_current_user_id()`.

### M3. RESOLVED — presigned photo upload signer, live-verified end to end

`lib/r2/sign.ts` holds the shared signer (`signUploadUrl({ scope, id,
contentType, httpsOnly })`), promoted out of `components/admin/r2.ts`'s
pattern (that file still has its own copy — track/admin's item 10/11 covers
retiring it to re-export from here). `getUploadTargetAction` in
`app/(market)/list/actions.ts` calls it directly: no RPC, no
`fn_get_upload_target`, no `app/(market)/intake/rpc.ts` (deleted). The key is
built entirely server-side as `intake/<userId>/<uuid>.<ext>`; the client
never supplies a filename. `content-type` is restricted to jpeg/png/webp and
size capped at 8MB before signing is even attempted.

**2026-08-13, first pass:** `.env.local` had only the three Supabase vars — no
`R2_*` keys — contradicting that pass's task brief. Filed as a blocker rather
than worked around.

**2026-08-13, same day, after the human added credentials:** confirmed
`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` /
`R2_PUBLIC_URL` are now present. Live-verified with a throwaway Node script
(`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, the project's own
installed deps) that exercised the identical signing config `lib/r2/sign.ts`
uses — same `S3Client` options, same `intake/<userId>/<uuid>.<ext>` key shape
— then performed a real PUT of a 68-byte PNG and a real GET of the resulting
public URL:

- `PUT` to the signed URL → `200 OK`.
- `GET` of the public URL → `200 OK`, `content-type: image/png`,
  `content-length: 68`.
- `OPTIONS` preflight against the R2 endpoint with
  `Origin: http://localhost:3000` → `204`, with
  `Access-Control-Allow-Origin: http://localhost:3000` and
  `Access-Control-Allow-Methods: PUT, GET` — the browser-PUT CORS path (the
  human's dashboard-side item) is also confirmed open for local dev.

Public URL from that probe (a disposable 1x1 PNG, safe to leave or delete):
`https://pub-8be7b83fc3574e138d5f8f7f108a5ed0.r2.dev/intake/live-verification-probe/1b643c4d-d63e-4ddb-a60f-e64ad454d913.png`

The verification script was a scratch file, run and deleted; it never touched
version control. Nothing left in the working tree from this check.

### M4. Payout: credit vs cash, gated on completed fulfilments (PARTIAL)

No payout model exists anywhere in the schema. `getPayoutEligibilityAction`
currently gates **cash** on a local proxy — the seller's own redemptions with
`status='shipped'` via `getRedemptions({ userId })` (a fulfilled shipment on
their account) — and that proxy is flagged in code as pending M4. Please
define the real rule and surface it (a `platform_config` row, or a
`fulfilments` table + RPC). Threshold constant `CASH_FULFILMENT_THRESHOLD = 1`
lives in `app/(market)/queries.ts` (moved there because `'use server'` files
may only export async functions); move it to wherever the real policy lives.
Until then the UI explains why cash is locked instead of hiding it.

### M5. Redemption ship deadline — display only, needs a source

`/dashboard` shows the seller's owed redemptions (`status='requested'`) with a
"ship by" deadline. There is no deadline column. Local constant
`REDEMPTION_SHIP_DEADLINE_HOURS = 72` in `app/(market)/dashboard/page.tsx`
(flagged). A `redemptions.due_at` or platform-config value would retire it.

### M6. Per-SKU float curves for the live estimate

The price step shows "estimated value at your self-declared condition" using
the **linear fallback** of `lib/db/valuation.ts floatMultiplier([], skuId,
float)` because nothing reads a SKU's curve back (admin.md item 4: no
`getFloatCurve`). Once a curve read exists the estimate should use it.