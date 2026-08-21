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

### 11. 021 credit-hold reservation surface added; `purchaseCredit` deleted and breaks one out-of-lane caller

Migrations 021 (`021_credit_holds.sql`) and 022 (`022_drop_legacy_settlement.sql`)
are both applied and both now have `.sql` files in this worktree, along with
019a/019b/019c/020 — item 10's "not in this worktree" note is stale; every
message-pattern regex it flagged as a guess has been re-verified against the
actual `raise exception` text in the applied files (see below).

**Verified live before writing anything, per this task's instruction:**
`fn_purchase_card` and `fn_purchase_card_core` each exist in exactly one
five-argument form. `022`'s own `do $$ ... end $$` block asserts this at
migration time (`expected exactly 1 fn_purchase_card, found %`), and reading
`021_credit_holds.sql` confirms the four- and three-argument overloads were
dropped by `021` and `022` respectively before `022` re-asserts the grants on
the five-argument form only. Both `purchaseCard()` (3 args, defaults fill 4
and 5) and `purchaseCardSplit()` (now 5 args) rely on default-filling into
that one five-argument function — there is no second signature for either to
accidentally bind to.

**1. `fn_purchase_credit` deleted from the contract.** `purchaseCredit()` and
its `BELOW_MINIMUM_TOPUP` `ContractErrorCode` member are gone —
`fn_purchase_credit`'s EXECUTE grant is now revoked from every role including
`service_role` (021, section 5), so the export could only ever throw. No stub,
shim, or commented-out block was left in its place.

**RESOLVED (follow-up pass, same day): `app/api/webhooks/stripe/route.ts` is
in fact track/data's lane** — AGENT_RULES.md §1's lanes table lists `webhooks`
under `flexsoar-data`/`track/data` explicitly. The prior pass's prompt had
said not to edit it; that was corrected and the deletion was finished. Removed:
the `purchaseCredit` import, the `TOPUP_PURPOSE` constant, the entire
`credit_topup` branch, and the `BELOW_MINIMUM_TOPUP` arm of
`isPermanentError()` (which also simplified back to a single return
statement — the "Card purchase" / "Credit top-up" split in its comment no
longer has two branches to split). `npx tsc --noEmit` is clean repo-wide,
`npm run build` completes (`Compiled successfully`, all 19 routes render),
`npm test` is unaffected. 021's own migration comment anticipated exactly
this: "The Stripe webhook's credit_topup branch must be deleted; this revoke
only stops it succeeding."

**While in the file: confirmed the webhook's remaining card-purchase call
never needs a hold id, because checkout never creates one.** Read
`app/(market)/actions.ts:149-221` (`createCheckoutAction`, track/market's
lane, not edited): `payment_intent_data.metadata` carries only `{ listing_id,
buyer_id }`; the full `listing.price_cents` is always charged through Stripe;
there is no `reserveCredit()` call anywhere in the checkout path and no
`credit_cents`/`hold_id` metadata field. The webhook's card-purchase leg
still calls the frozen 3-arg `purchaseCard(listingId, buyerId, intent.id)`
(unchanged), which default-fills `p_credit_cents=0, p_hold_id=null` — a
pure-cash settlement, so 021's hold-provenance requirement never triggers
today. **Ask for track/market, if/when an FSC-eligible checkout is wanted:**
add a `reserveCredit(listingId, creditCents)` call before creating the
Checkout Session, and carry the returned hold id plus the FSC amount through
`payment_intent_data.metadata` (e.g. `credit_cents`, `hold_id`). Once that
metadata exists, a follow-up track/data pass can switch this webhook from
`purchaseCard()` to `purchaseCardSplit(listingId, buyerId, settlementRef,
creditCents, holdId)`, reading `credit_cents`/`hold_id` off `metadata` the
same way `listing_id`/`buyer_id` are read now. Not built speculatively here —
there is no metadata field yet to read.

**2. New reservation exports**, all session-client, wrapping 021's new RPCs
verbatim (see their doc comments in `lib/api/contract.ts` for the full
signature and throw list): `reserveCredit(listingId, creditCents)`,
`releaseCreditHold(holdId)`, `getCreditAvailable()`, `getCreditHeld()`,
`expireCreditHolds()`. `getCreditAvailable()`/`getCreditHeld()` take no
argument and resolve the caller from the session, mirroring
`getCreditBalance()`'s existing "a session cannot ask after someone else's"
pattern — this is a contract-layer choice, not one the underlying SQL
enforces: `fn_credit_available(p_user)`/`fn_credit_held(p_user)` are plain
`p_user`-argument functions granted to `authenticated` with no internal
identity check (confirmed by reading the SQL), so a raw RPC call could ask
after any user's held/available FSC. The wrapper is the only thing closing
that.

**3. `purchaseCardSplit` extended in place to five arguments** (`holdId` last).
This is a prior additive export (018-020), not one of the frozen 16, so it
was changed in place rather than given a second variant — a second variant
here would recreate exactly the two-code-paths problem 022 just cleaned up on
the SQL side. It now throws `CREDIT_PROVENANCE_REQUIRED` itself, client-side,
when `creditCents > 0` and `holdId` is null — `purchaseCardSplit` always runs
on the service-role client (the webhook), which never has a session, so any
call of its with an FSC leg **must** carry a hold id created earlier by the
buyer's own session via `reserveCredit()`. The SQL enforces the identical
rule independently (`fn_purchase_card_core` raises the same-meaning
`'spending FSC requires a session matching the buyer, or a credit hold'` if
this client check is ever bypassed), so nothing relies on the TS check alone.
No caller of `purchaseCardSplit` exists yet anywhere in the repo (grepped) —
extending its signature could not break anyone.

**4. `getCreditBalance()` doc comment now says plainly it is NOT spendable**
and points at `getCreditAvailable()`, per AGENT_RULES.md §5. Grepped the
whole repo for callers of `getCreditBalance` — there are none outside
`lib/api/contract.ts` itself, so nothing needed fixing; the function was only
ever exported, never called from any track's UI code.

**5. Error-string verification, now against the applied `.sql` files rather
than guesses** (`lib/db/errors.ts`): `SETTLEMENT_REF_REQUIRED` was guessing at
wording that turned out to already substring-match by accident (the pattern
has been tightened to the exact text anyway: `'a cash leg of % cents
requires a settlement_ref'`, `019c_settlement.sql:157` /
`021_credit_holds.sql:320-321`). `SWEEP_EXCEEDS_UNSWEPT` was also an
accidental match, now tightened to `'sweep of % cents exceeds unswept
commission of % cents...'` (`020_platform_earnings.sql:168-170`). The
credit-cents-vs-price arm of `INVALID_AMOUNT` was **not** an accidental
match — it was simply wrong: `fn_purchase_card_core` does not raise for
`p_credit_cents` above the listing price, it silently clamps
(`v_credit := least(greatest(coalesce(p_credit_cents, 0), 0), v_price);`,
`021_credit_holds.sql:274`). That rule has been removed. The real "credit vs
price" raise lives in `fn_reserve_credit` instead — `'reserve of % exceeds
listing price %'` — and is mapped now. Also found and fixed:
`INSUFFICIENT_CREDIT`'s pattern was `/insufficient credit/i`, but the two
live raises actually say `'insufficient FSC: balance %, requested %'`
(`fn_purchase_card_core`) and `'insufficient available FSC: % available, %
requested'` (`fn_reserve_credit`) — **neither contains the word "credit"**,
so the old pattern would never have matched either live raise; both would
have fallen through to `UNKNOWN`. Broadened to catch all three wordings.
New mappings added for 021's five new raise families: expired hold
(`CREDIT_HOLD_EXPIRED`), hold belonging to another user
(`CREDIT_HOLD_WRONG_USER`, covers both `fn_purchase_card_core`'s and
`fn_release_credit_hold`'s wording), hold for a different listing
(`CREDIT_HOLD_WRONG_LISTING`), hold smaller than the requested credit
(`CREDIT_HOLD_INSUFFICIENT`), and the session-or-hold provenance refusal
(`CREDIT_PROVENANCE_REQUIRED`).

**6. Tests added to `tests/invariants.test.ts`** under `describe('credit
holds (021)', ...)`: available = balance - held with expired holds excluded,
reserving more than available raises, a second reserve on the same listing
replaces rather than stacks, settling with a hold consumes it and a second
consumption raises, an expired hold raises rather than settling, and a hold
for listing A refuses to settle listing B. **All six are model-level checks
against an in-memory array of synthetic rows, mirroring the SQL's logic —
none of them touch the database or call the real RPC**, same as every other
describe block in this file; the reservation order they mirror (available is
checked BEFORE the caller's own prior hold on the same listing is released)
was copied from reading `fn_reserve_credit` itself, not simplified. Full
suite: 107 passing (was 87 before this pass).

**Not verified live:** everything in this item was checked by reading the
applied `.sql` files directly (all now present in `supabase/migrations/`),
not by probing the live project — this task's instruction was to read
`pg_get_functiondef`-equivalent source (the migration files themselves,
since they are now in the worktree) rather than live-probe a real credit
RPC, which would risk a real reservation/settlement. Nothing here was
guessed.

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

### 10. 018-020 contract surface — live-verified where possible, two items need follow-up

Migrations 018, 019a/b/c and 020 are applied to the project, but no
`015_*.sql` .. `020_*.sql` file exists in this worktree (`supabase/migrations/`
still ends at `014_fixes.sql`) — everything below came from probing the live
project with the anon/service-role/seed-admin credentials in `.env.local`,
not from reading SQL. `replaceSkuArt` (015) was merged the same way in an
earlier session.

**Added to the contract:** `purchaseCardSplit` (the 4-arg `fn_purchase_card`,
service-role), `getPayoutMethodForUser` (session, not admin-gated — verified
callable from anon/session/service-role alike), `listConditionBands` (session,
projects `grade, label, sort_order` only — deliberately not `min_float`/
`max_float`, see the function's doc comment), `getPlatformPosition` /
`recordSweep` / `checkSolvency` (session, admin-gated — verified
`fn_platform_position` refuses service-role with "admin privileges required").
`condition_grade` added to `CardSummary`/`ItemSummary`/`SubmissionSummary` and
copied through `toCardSummary`/`toItemSummary`/`getSubmissions()`'s mapper —
checked this one specifically against the art_url mapper bug this task
warned about. `credit_cents`/`cash_cents`/`seller_payout`/`payout_release_at`
added to `OrderSummary`. `show_numeric_float` added to `PlatformConfig`
(live-verified `false`). Also fixed in `lib/db/types.ts` while in there:
`AssetClass` and `LedgerEntryType` were missing `'credit'` and the four
`credit_*` entry types 011 actually writes (live-verified against
`ledger_entries` — asset values are `card`/`currency`/`credit` and entry
types include `credit_purchase`/`credit_sale_gross`/`credit_sale_net`/
`credit_sale_fee`); this predates 018-020 but blocked writing a correct
ledger net-to-zero invariant, so it's fixed now.

**NOT added:** any FSC top-up export. `fn_purchase_credit`'s EXECUTE grant is
revoked from `authenticated` and `anon` — live-verified (42501 "permission
denied for function fn_purchase_credit" from both a real seed-admin session
and anon). It is **still granted to `service_role`**: a negative-amount probe
from service-role reached the business-logic raise ("credit purchase must be
positive, got -1"), not a permission error, so the grant itself has not been
pulled there. `purchaseCredit()` in `lib/api/contract.ts` is now commented
DEAD per this task's instruction, and its one caller —
`app/api/webhooks/stripe/route.ts`'s `credit_topup` branch (metadata
`purpose: 'credit_topup'`) — still calls it and, per the grant above, would
still technically succeed. That file is outside this track's lane
(`lib/api/contract.ts` only), so it was not touched. Whoever owns webhooks
should route that branch to something else, or a migration should pull the
`service_role` grant too if the intent is "this can never fire again."

**listings.payout_method for routing — none found.** Grepped the whole repo:
`lib/api/contract.ts` never selects `listings.payout_method` at all (checked
`LISTING_COLUMNS`) and never has. The only other hits —
`components/market/intake/IntakeWizard.tsx`, `components/admin/db-reads.ts`,
`app/(market)/list/actions.ts` — are all about `items.submitted_payout` (the
seller's own election at intake, feeding `fn_submit_listing`'s `p_payout`),
not `listings.payout_method`. Nothing to fix; noted here because the task
asked this be reported either way.

**Two ContractErrorCode message-pattern regexes are best-effort, not
verified.** `SETTLEMENT_REF_REQUIRED`, the credit_cents-vs-price arm of
`INVALID_AMOUNT`, and `SWEEP_EXCEEDS_UNSWEPT` in `lib/db/errors.ts` are
guesses at the raise wording, not copies of it — the migration SQL isn't in
this worktree, and live-probing an actual `fn_purchase_card` / `fn_record_sweep`
call (even with a garbage listing id / an amount far above `unswept_cents`)
was correctly refused by this session's sandbox as a real financial write
RPC. If they don't match, nothing breaks silently: `fail()` always surfaces
the server's verbatim message, the code just falls back to `UNKNOWN` instead
of the specific one. Whoever has SQL access next should grep the actual
`raise exception` text in the 018-020 migration(s) and tighten these three
patterns (they currently sit right after the `INSUFFICIENT_CREDIT` rule and
right before the `ledger_entries is append-only` rule in `MESSAGE_RULES`).

**Other live-verified facts, for whoever touches this surface next:**
`cash_payout_countries` holds exactly one row (`MY`, home corridor).
`condition_bands` has 5 rows, `sort_order` 1-5:
factory_new/minimal_wear/field_tested/well_worn/battle_scarred, boundaries
`[0, .08, .2, .45, .7, 1.001)`. New `platform_config` keys beyond
`show_numeric_float`: `sweep_reserve_bps` (1500), `sweep_reserve_min_cents`
(50000), `payout_hold_days` (7), `seller_shipment_days` (7),
`proof_of_possession_days` (90), `proof_required_on_first_sale` (true),
`proof_response_days` (7), `cash_payout_min_fulfilments` (2) — the last few
predate 018-020 but weren't previously catalogued here.
`fn_platform_position()`/`fn_check_solvency()` both return a single-row
`table(...)` — call `.single()` on the `.rpc()`, same as any other
one-row-table RPC, or PostgREST hands back a one-element array instead of
the object the types promise.

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