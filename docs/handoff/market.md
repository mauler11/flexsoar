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