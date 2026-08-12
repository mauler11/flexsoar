# Handoff — track/data

Items filed by the data track. Numbered within this file. No global
`HANDOFF.md` exists in this worktree; where an item cites an older global
number the old number is noted and that history predates this file.

**Track status: rebased onto `main` (`efd88c1`).** This file keeps items from
the dev-password sign-in / public profile / middleware→proxy work together
with the credit-ledger and art_url work below.

---

## Open

### 0. BLOCKER: the credit ledger cannot record anything until a migration widens `ledger_entries_check`

Found by live probing (this session, on the project): **every** credit insert
fails with

```
new row for relation "ledger_entries" violates check constraint "ledger_entries_check"  [23514]
```

`ledger_entries_check` (001_schema.sql:219) only admits `asset='currency'`
(with `amount_cents`, no `card_id`) or `asset='card'` (with `card_id`, no
amount). 011 added the `'credit'` asset class and shipped
`fn_purchase_credit`/`fn_purchase_card_with_credit`, both of which insert
`asset='credit'` rows carrying `amount_cents` — but never widened the
constraint. Verified live: `fn_purchase_credit` (service role, 5000 cents,
valid ref) → 23514; balance stays 0. `fn_purchase_card_with_credit` has the
same problem the moment it reaches the insert.

Needed migration (the human's job — .sql is never a track agent's):

```sql
alter table ledger_entries drop constraint ledger_entries_check;
alter table ledger_entries add constraint ledger_entries_check check (
  (asset = 'currency' and amount_cents is not null and card_id is null) or
  (asset = 'card'     and card_id is not null and amount_cents is null) or
  (asset = 'credit'   and amount_cents is not null and card_id is null)
);
```

Credit rows never carry `card_id` (card movement stays on `asset='card'`), so
the third clause is complete. Until it lands, the contract surface is correct
but the positive paths — `purchaseCredit()`, `purchaseCardWithCredit()` — are
DB-blocked. Everything that refuses before writing already works (see item 5).

### 1. Migration request: `fn_list_card` needs a `payout_method` argument

`listings.payout_method` exists (011, defaults to `'cash'`), but
`fn_list_card` cannot set it — every listing is cash until the migration.
The contract's `listCard()` already carries the `payoutMethod:
PayoutMethod = 'cash'` argument; listing as `'credit'`/`'either'` throws
`UNKNOWN` with a pointer to this item until the migration lands. When it
does:

- give `fn_list_card(card_id, seller_id, price_cents)` a fourth
  `p_payout_method payout_method` parameter (default `'cash'`), `insert`
  it on the new listing, and strip the guard in `listCard()` so the
  argument is passed straight through;
- the listing projections / `ListingSummary` / `ListingRef` should then
  carry `payout_method` so the market can show which listings are
  credit-eligible.
- **While in there**: `fn_purchase_card_with_credit` is security definer
  and takes `p_buyer_id` from the caller. It does not compare it to
  `auth.uid()`. The contract's `purchaseCardWithCredit()` closes the gap
  (FORBIDDEN when buyerId ≠ session user) because nothing else will; the
  check belongs in the SQL function as well.

### 2. Password sign-in is DEVELOPMENT-ONLY and compile-gated — keep it that way

`NEXT_PUBLIC_ENABLE_PASSWORD_AUTH=true` at build time renders an email+
password form on `/sign-in` (`app/(auth)/password-sign-in-form.tsx`) and
compiles in `signInWithPassword` in `app/(auth)/actions.ts`. The gate is
checked in the page *and* inside the Server Action, because an action can
be POSTed to without rendering the form.

- NEXT_PUBLIC_ vars are inlined at build time, so a deployment built
  without the flag has no password path whatever the runtime environment
  claims. **Never build with it set for anything the outside world can
  reach** — there is no password reset and no rate limiting beyond what
  Supabase's own auth surface applies.
- The action provisions the `users` row itself via `ensureUserRow()` on
  the session it just established, exactly as the magic-link callback does,
  so 006's `users_self_insert` policy vets it. Provisioning failure signs
  the session back out rather than landing someone half-signed-in.
- Working dev seed credentials against the live project (verified live —
  sign-in succeeds, `users.is_admin = true` on the resulting session):
  `seed_admin@flexsoar.test` / `seed-admin-dev-only-3f9c2a`. The seed
  script itself is not in the repo; it lives on the human's project.
- `components/ui/**` belongs to track/design; the form's markup is theirs
  to replace.

### 3. Fixture SKUs still need hosted art URLs

`skus.art_url` is on the contract now (`Sku`/`SkuRef`/`UpsertSkuInput`,
both projections) and `getSkus()`/`upsertSku()` return and write it — so
admin's `getSkuArtUrls()` overlay and the uploader's save-staging retire,
and design's sprite-fallback still fires where `art_url` is null. What
remains is the source of the URLs themselves: no R2 credentials exist in
`.env.local` (admin item 10/11), so no one has produced a hosted PNG for
the six fixture SKUs. Until the human lands R2 creds + a CORS policy (or
hosts the art elsewhere) and the pixel-art PNGs are uploaded, every card
renders the sprite fallback — which is the intended behaviour. `lib/mock/**`
is not this track's lane, so the fixtures stay as they are.

### 8. `fn_record_proof` cannot work for a seller — 013 routes it through an admin-only path

Verified live (this session, on the project): a signed-in seller calling
`recordProof()` / `fn_record_proof` on their own seller-held item is refused
with `admin privileges required` (`FORBIDDEN`). The blocker is in the SQL
layers, not the wrapper: `fn_record_proof` is security definer and calls the
existing `fn_set_item_photos` (010), which begins with `fn_require_admin()`.
A seller is never an admin, so every proof recording is refused — on top of
the minted-item photo freeze 013 itself documents. The wrapper surfaces the
refusal faithfully and cannot work around it. The fix is a migration: give
proof its own path that skips `fn_require_admin()` (and, per 013's own notes,
allows photo updates on a minted seller-held item).

---

## Resolved / notes for other tracks

### 4. `art_url` is a real column and on the contract (012)

`skus.art_url` (nullable text, https-only check) is in the schema and now
in `Sku` / `SkuRef` / `UpsertSkuInput`, and in `SKU_COLUMNS` /
`SKU_REF_COLUMNS`. `getSkus()`, `upsertSku()` and every embed that carries
`skus(...)` return it. This retires track/admin's `getSkuArtUrls()`
overlay (their item 11) — nothing in the contract needs it; the column
arrives via the normal read. 012 also made `fn_purchase_card` refuse
credit-only listings (see item 5).

### 5. Credit ledger contract surface (011) — live-verified

- `getCreditBalance()` → `fn_credit_balance`, session client. Resolves the
  caller from the session — there is deliberately no user argument, so a
  session cannot ask after someone else's balance. Zero is a valid balance.
- `purchaseCredit(userId, cents, settlementRef)` → `fn_purchase_credit`,
  **service-role only** (webhook). Idempotent on `settlementRef` (returns
  `null` on redelivery); the minimum top-up is enforced inside the SQL
  (`credit_purchase_min_cents`), surfaced as `BELOW_MINIMUM_TOPUP`.
- `purchaseCardWithCredit(listingId, buyerId)` → `fn_purchase_card_with_credit`,
  session client, with a session-identity guard (item 1).
- `getPlatformConfig()` → all `platform_config` rows, readable by anyone
  (config_read). `REDEMPTION_HANDLING_FEE_CENTS` is now only the fallback;
  `getRedemptionHandlingFeeCents()` reads the live value (011 seeds it at
  1500). track/market's pinned constant in `app/(market)/queries.ts` can
  move to `getRedemptionHandlingFeeCents()`.
- The Stripe webhook records `{ purpose: 'credit_topup', user_id, cents }`
  intents by crediting the ledger; card-purchase metadata behaves as before.
- **Live verification (this session, on the project):** all four refusal paths
  pass — below-minimum top-up (`minimum top-up is 500 cents, got 100` →
  `BELOW_MINIMUM_TOPUP`), non-positive top-up (`must be positive` →
  `INVALID_AMOUNT`), cash listing bought with credit (`settles in cash and
  cannot be bought with credit` → `PAYOUT_MISMATCH`), credit listing bought
  with cash (`settles in credit and cannot be bought with cash` →
  `PAYOUT_MISMATCH`), and insufficient balance (`insufficient credit: balance
  0, price 8000` → `INSUFFICIENT_CREDIT`) — plus `SELF_PURCHASE` on the
  buyer==seller case. Grants confirmed: `fn_purchase_credit`/`purchaseCard`-
  style refusals for anon are 42501; `platform_config` is readable by anon;
  `credit_purchase_min_cents` is 500. The POSITIVE top-up/purchase paths are
  blocked by the item 0 constraint bug, not by the contract.

### 6. `getPublicProfile` — the `/u/[handle]` read, verified live

`getPublicProfile(handle)` in `lib/api/contract.ts` reads the
`public_profiles` view (never the `users` table) and joins `levels` for the
rank name. Probed live against the project with the anon key:

- Positive: `seed_buyer` → full row incl. real `portfolio_value_cents`,
  `rank_name` "Runner" from `levels` (level 1).
- Negative: unknown handle → `null`.
- Casing: `SEED_BUYER` → `seed_buyer` — handles are citext, so lookup is
  case-insensitive; the returned handle is the stored casing.
- The load-bearing distinction holds: `users` read with the anon key
  returns `null` (RLS), while the view returns the row — the view is the
  only public read path.

`getPublicProfileByHandle` (track/market's own workaround) can be replaced
by this function; it is the authoritative read.

### 7. `middleware.ts` was renamed to `proxy.ts`

Next.js 16 renamed the convention: the file is `proxy.ts`, the export is
`proxy` (migrated by `npx @next/codemod middleware-to-proxy .`). The
matcher survived intact and still covers `/admin`; the anonymous branch
redirects to `/sign-in` (verified live: `307` → `/sign-in?next=%2Fadmin`).
Any track that touches the old `middleware.ts` must now touch `proxy.ts`.
`lib/supabase/server.ts`'s "session refresh" comment was updated to match.

### 9. 013 seller-custody contract surface — live-verified

`submitListing`, `approveSubmission`, `rejectSubmission`, `confirmShipment`,
`markDefault`, `recordProof` and `getSubmissions` now wrap 013 in the
contract, all on the SESSION client (013 derives the actor from
`auth.uid()`, so service-role is refused by construction — the pattern from
item 5). `Item` / `ItemSummary` / `getItems` / `getItem` carry `custody`,
`custody_holder_id`, `grade_source`, `asking_price_cents`, `submitted_payout`,
`last_proof_at`; `User` gains `fulfilments_completed`, `defaults_count`,
`is_restricted` (`getUser` returns them). New `ItemStatus` values
`pending_review` / `awaiting_seller_shipment`, and the admin consignments
page's status labels were extended to match. New error codes:
`UNPROVEN_SELLER`, `RESTRICTED`, `TOO_FEW_PHOTOS`, `INVALID_PHOTO_URL`,
`NOT_FULFILLER`, `INVALID_SHIPMENT`, with the 013 message→code rules in
`lib/db/errors.ts` (including `price must be positive` → `INVALID_AMOUNT`).

`getSubmissions()` defaults to the `pending_review` admin in-box. Its
`seller:public_profiles!custody_holder_id(...)` embed hint is required
because `items` has two FKs to `users` (`consignor_id` and
`custody_holder_id`) — verified live that the hint resolves the right one.
Oldest-first and paged like the other queues.

`fn_redeem_card` now writes `redemptions.status = 'awaiting_seller'` for
seller-held items (bare text, no constraint — `RedemptionStatus` is `OpenText`
so no type change). The fulfilment queue UI sees it straight from
`getRedemptions()`: distinguish "waiting on the seller to ship" from
`requested`/`picking` there.

**Live verification (this session, on the project), all through real sign-in
sessions and the actual `lib/db/errors.ts` code:**
- unproven seller, cash/either payout → `cash settlement needs 2 completed
  fulfilments (you have 0); list for credit first` → `UNPROVEN_SELLER`;
- fewer than four photos → `at least 4 photos are required` → `TOO_FEW_PHOTOS`;
- a non-https photo → `photo entries must be https URLs, got …` →
  `INVALID_PHOTO_URL`;
- `price must be positive` → `INVALID_AMOUNT`;
- restricted account → `this account cannot list items` → `RESTRICTED`;
- positive submission lands a `pending_review` item with `custody=seller`,
  `grade_source=seller_declared`, `submitted_payout=credit`, the six component
  scores set, and `float` equal to the rubric weighted sum (probed 0.85);
- non-fulfiller `confirmShipment` → `only the holder of this item can confirm
  shipment` → `NOT_FULFILLER`; the fulfiller then confirms cleanly;
- `recordProof` seller refusal — filed as open item 8.

#### `RedemptionSummary.user` is now `redeemer` (PGRST201 embed fix)

013 added `redemptions.fulfiller_id`, so `redemptions` now has two FKs to
`users`. PostgREST refused the un-hinted `public_profiles` embed with
PGRST201 ("more than one relationship was found") — this was the `/list`
and `/dashboard` 500s, reproduced live against the project. `getRedemptions()`
now embeds explicitly, one FK per alias, and carries the new 013 data:

- `redeemer:public_profiles!redemptions_user_id_fkey(…)` — replaces the old
  `user` alias (renamed on `RedemptionSummary`, so consumers that read
  `row.user.handle` must read `row.redeemer.handle`);
- `fulfiller:public_profiles!redemptions_fulfiller_id_fkey(…)` —
  `UserSummary | null`; null for warehouse-fulfilled redemptions.

Swept the whole contract for the same class of bug: every profile embed now
names its FK where ambiguous. The only ambiguous tables the contract embeds
users/profiles from are `redemptions` (fixed above) and `items`
(`getSubmissions()` already hints `!custody_holder_id`, the four-FK case);
`orders` (`buyer_id`+`seller_id`) is two-FK but the contract selects plain
`ORDER_COLUMNS` with no user embed, so there is nothing to disambiguate.
`listings.seller_id`, `cards.owner_id`, `card_provenance.owner_id` and
`consignments.consignor_id` each have a single FK and stay un-hinted. All
verified live with isolated throwaway fixtures (see the sweep in this
session's notes): the old embed reproduces PGRST201, the fixed `redeemer`/
`fulfiller` embeds return both seller-held (fulfiller object) and warehouse
(fulfiller null) rows, and the unchanged queries keep parsing.