# Handoff — track/data

Items filed by the data track. Numbered within this file. No global
`HANDOFF.md` exists in this worktree; where an item cites an older global
number the old number is noted and that history predates this file.

**Track status: rebased onto `main` (`efd88c1`).** This file keeps items from
the dev-password sign-in / public profile / middleware→proxy work together
with the credit-ledger and art_url work below.

---

## Open

### 17. 027 (SKU model/variant split): contract layer updated; upsertSku can no longer write market_price_cents or create a SKU — BLOCKING ask for track/admin on SkuForm.tsx

Task: 027_sku_models.sql (applied live, migration file now in this worktree)
split SKU identity into `sku_models` (brand+model+colorway, the ORACLE
`base_price_cents`, the shared art) and `skus` as the size VARIANT
(`model_id`, `size_multiplier`, `price_override_cents`).
`skus.market_price_cents` became a column maintained by
`trg_sku_variant_derive` — `coalesce(price_override_cents,
base_price_cents x size_multiplier)` — and a direct write now RAISES
instead of being silently ignored. Tier moved to the model
(`fn_tier_for_sku`); value stays per-variant (`fn_card_value_cents`,
unchanged).

**Pre-flight note, per AGENT_RULES.md section 0:** this worktree was 6
commits behind `main` when the task was first handed to this pass
(`027_sku_models.sql` did not exist in the checkout at all — confirmed via
`git log HEAD..main` and `git show main:supabase/migrations/027_sku_models.sql`,
which resolved fine from `main` but not from this branch). Stopped and
reported per section 0 rather than working from the task prompt's prose
description of the schema; the human reset the worktree and this pass
resumed from a clean `git log HEAD..main` with no output.

**Every direct writer of `skus.market_price_cents` in the repo, found by
grepping for `market_price_cents\s*:` and `.update(`/`.insert(` against
`skus` repo-wide (not just the two files the task named):**

- **`lib/api/contract.ts`'s `upsertSku()`** — the real one, fixed here (see
  below).
- **`components/admin/skus/SkuForm.tsx`** — builds `market_price_cents:
  market` into the object it hands `upsertSkuAction()` →
  `upsertSku()`. **This will now throw `MARKET_PRICE_IS_DERIVED` on every
  save**, both create and price-edit. Not fixed here — `app/admin/**` and
  `components/admin/**` are track/admin's lane. **Ask:** the form's price
  field needs to become two things: a `base_price_cents` field wired to
  `updateSkuModel()` (or `createSkuModel()` for a new model), and, only
  where a size genuinely diverges, a `price_override_cents` field wired to
  `updateSkuVariant()`. The bench likely also wants `listSkuModels()` /
  `getSkuModel()` for a model-first browse view instead of (or alongside)
  the current flat SKU list, since 027's whole point is one pricing/art
  decision per model instead of one per size.
- **`components/admin/db-writes.ts`** — the task prompt named this file as
  a place to check; it does **not** write `market_price_cents`. Its
  `approveSubmission()` calls `fn_approve_submission(p_item_id,
  p_price_cents)`, and `p_price_cents` there is the **listing** price
  (`asking_price_cents` → the reviewer's decision), an unrelated column on
  an unrelated table. Verified by reading the function in full — no `skus`
  write anywhere in that file.
- **`scripts/seed.ts`** — `ensureSku()` does a raw `.from('skus').insert({
  ..., market_price_cents: SKU.market_price_cents })` with no `model_id` at
  all. This is now broken twice over against the live (post-027) schema: it
  will hit the `model_id` NOT NULL constraint before it ever reaches the
  price trigger. `scripts/**` is this track's lane, but fixing a seed
  script's SKU-creation flow (decide whether it should call
  `fn_create_sku_model` directly or insert `sku_models` as the seed's
  service-role client already does elsewhere in the file, then
  `ensureSkuVariant`) is a design choice outside this task's four numbered
  items — flagging rather than guessing at it unasked.
- **Everywhere else** (`components/market/intake/PricePayout.tsx`,
  `components/market/intake/SkuPicker.tsx`, `components/market/bridge.ts`,
  `app/admin/skus/page.tsx`, `app/admin/skus/[id]/page.tsx`,
  `components/admin/mint/MintTable.tsx`,
  `app/admin/submissions/[itemId]/page.tsx`, `components/admin/db-reads.ts`,
  `lib/db/valuation.ts`, `components/card/value.ts`, `lib/mock/fixtures.ts`,
  `HANDOFF.md`, `docs/handoff/design.md`) only **reads** the column or
  mirrors `fn_card_value_cents`'s existing (unchanged) formula. No other
  write found.

**`upsertSku()` fixed in place — its signature is NOT one of the frozen 16**
(it is itself a 009 sanctioned extension: "Direct table write under
skus_admin_write — there is no RPC"), so the body was changed rather than
worked around or left broken:

- Supplying `market_price_cents` (including explicit `null`) now throws
  `MARKET_PRICE_IS_DERIVED` before any Supabase client is even constructed —
  the value is never silently dropped or guessed-and-misrouted to a model
  (a variant-shaped caller can't know if it's the model's only size, so
  repricing "the" model on its behalf could silently reprice every sibling
  size).
- A plain insert (no `id`) now throws `SKU_CREATION_REQUIRES_MODEL` —
  `skus.model_id` is `NOT NULL` as of 027 and `UpsertSkuInput` has no field
  to supply one, so insert-via-upsertSku cannot succeed at all any more.
  Both messages name the real replacement (`createSkuModel` +
  `ensureSkuVariant`, or `updateSkuModel` / `updateSkuVariant`).
- The update branch (existing variant, `id` present, no
  `market_price_cents`) is untouched — `retail_price_cents`, `sprite_key`,
  `palette`, `demand_score`, `mint_cap` etc. still update exactly as before.

**Also fixed while in the file — `getSkus()`'s `SkusQuery.tier` filter was
matching the wrong column.** It built its price-range OR-filter against
`skus.market_price_cents`, but 027 moves tier to the MODEL
(`fn_tier_for_sku` reads `sku_models.base_price_cents`). Those two only
agree when a variant has a `1.000` size_multiplier and no
`price_override_cents` — true for every variant today (027 ships the curve
flat), but the C3 section of `scripts/smoke_catalog.sql` (this migration's
own smoke test) demonstrates a variant whose override crosses a tier
boundary while its model tier stays put, which the old filter would have
sorted into the wrong tier bucket. `getSkus()` now resolves the requested
tiers against `sku_models.base_price_cents` first, then filters variants by
`model_id`. Not one of the task's four numbered items, but directly caused
by 027 and in this same file — flagged explicitly rather than silently
folded in.

**New additive exports** (SANCTIONED EXTENSIONS block in `contract.ts`
updated with a `027:` bullet): `listSkuModels(query?)`, `getSkuModel(modelId)`,
`createSkuModel(brand, model, colorway, basePriceCents?)` (wraps
`fn_create_sku_model`), `updateSkuModel(modelId, input)` (direct table
write, `sku_models_admin_write` — deliberately has no `art_url` field, that
stays `replaceSkuArt()`-only), `ensureSkuVariant(modelId, sizeUs)` (wraps
`fn_ensure_sku_variant`), `updateSkuVariant(skuId, input)` (direct table
write, `skus_admin_write`, only `size_multiplier`/`price_override_cents`).
`replaceSkuArt()` is unchanged, per 027's own migration comment — same
`(uuid, text) -> skus` signature, it just now propagates to every sibling
size.

New `ContractErrorCode` members, each mapped in `lib/db/errors.ts` against
the exact raise text in `027_sku_models.sql`: `MARKET_PRICE_IS_DERIVED`,
`SKU_MODEL_IDENTITY_REQUIRED`, `INVALID_SKU_SIZE`,
`SKU_CREATION_REQUIRES_MODEL` (the last is thrown client-side by
`upsertSku()` only — there is no matching SQL raise for it).
`sku_model % not found` and the new model-level art guard (42501) both ride
existing generic rules (`/\bnot found\b/i`, the `42501 -> FORBIDDEN` code
map) — pinned by a test rather than assumed.

**`Sku` (lib/db/types.ts) gained `model_id`, `size_multiplier`,
`price_override_cents`, all marked optional on the TS type** even though
`model_id`/`size_multiplier` are `NOT NULL` in the database — same
precedent as `User.fulfilments_completed` above (013): the shared
`lib/mock/fixtures.ts` and `components/market/bridge.ts` (track/market's
file) both build `Sku`-shaped objects that predate 027 and are not this
track's or this task's to edit. Required fields would have failed `tsc` in
two other tracks' lanes for a schema fact those files have no way to know
about yet. New `SkuModel` interface added alongside.

**Tests:** `tests/invariants.test.ts` — **191 passing (was 172, +19)**. New
coverage, none of it executing SQL (that's what `scripts/smoke_catalog.sql`
is for, live — this suite must not duplicate it, per the task's own
instruction): `upsertSku()` rejects with `MARKET_PRICE_IS_DERIVED` for
`market_price_cents` on both an update- and insert-shaped call and for an
explicit `null`; rejects with `SKU_CREATION_REQUIRES_MODEL` for a plain
insert, naming `createSkuModel`/`ensureSkuVariant` in the message; the new
exports exist with the arities their RPCs/table shapes imply;
`contractErrorCode()` maps every new 027 raise text (and confirms the two
that deliberately have no new rule still resolve via the existing generic
ones); and a mirror of `scripts/smoke_catalog.sql`'s C3 section proving
tier is the model's `base_price_cents` for every variant of a model
regardless of a per-size `price_override_cents`, while value
(`market_price_cents`) genuinely diverges — using `tierForPrice()` (already
imported in this suite) as the same mirror `fn_tier_for_price` gets
elsewhere, never a new formula.

**Not verified live:** none of this was probed against the live project.
Every raise text came from reading `027_sku_models.sql` directly, not from
a live call — this task's writes are all admin-acting-in-a-session
mutations (`fn_create_sku_model`, `fn_ensure_sku_variant`,
`updateSkuModel`/`updateSkuVariant`'s direct table writes), and calling any
of them for real would be a real catalog write against the live project
(AGENT_RULES.md section 2). `npx tsc --noEmit` clean, `npm run build`
compiles (`Compiled successfully`, all 22 routes render), `npx eslint` on
every changed file clean with zero warnings.

### 16. Re-landed setCountry() — lost to a worktree reset as `39f0efa`, rebuilt against current main; track/market has a ready wiring plan waiting on this

`39f0efa` shipped this once; the commit is unreachable (an earlier pass's
worktree got reset back to main's tip before it merged — confirmed via
`git branch -a --contains 39f0efa` and this branch's own reflog, both empty/
consistent with track/market's 2026-08-24 handoff entry in
`docs/handoff/market.md`, which independently discovered and documented the
same loss when it went looking for `setCountry()` and found nothing). Not
recovered from the dangling commit — rebuilt from scratch against this
branch's current `lib/api/contract.ts`/`lib/db/errors.ts`, per instruction.

**Pre-flight note:** this worktree was 2 commits behind `main`
(`733a9b4`/`abd1875`) when this pass started — AGENT_RULES.md §0 says stop
for a reset in that situation. Checked what was actually behind first: both
commits add only `docs/handoff/market.md` (track/market's own writeup of the
blocked wiring task above) — no `.sql`, no `lib/api/contract.ts`, nothing
that could make this pass's work stale. Flagged to the human and given the
go-ahead to proceed without a reset rather than stopping the pass; noting it
here per §12 ("anything you found that is wrong but outside your lane" — this
isn't exactly that, but it's a process deviation worth a paper trail).

**Changes, all additive to `lib/api/contract.ts` per the SANCTIONED
EXTENSIONS block (new 025 bullet added there):**

- `setCountry(countryCode: string): Promise<void>` — session client only,
  calls `requireCurrentUserId()` first (client-side UNAUTHENTICATED for a
  genuinely anonymous caller) then `fn_set_country(p_country)`. No `p_user`
  argument exists on the SQL side, so this can only ever write the caller's
  own `users.country_code` — verified by reading `025_user_country.sql`
  directly (`v_user := fn_current_user_id(); ... update users set
  country_code = v_code where id = v_user`), not assumed from the name.
  Never service-role: a service-role call has no `auth.uid()`, so
  `fn_current_user_id()` is null and the RPC itself would raise 'sign in to
  set your country' — this export doesn't special-case that, it just never
  calls the service client to begin with, same posture as every other
  session-scoped mutation in this file.
- `ContractErrorCode` gained `INVALID_COUNTRY_CODE` (the ISO-shape raise).
  `COUNTRY_NOT_SET` was **not** re-added — it already landed in `ef83d6d`
  (item 15 above) and this pass double-checked (`grep -n COUNTRY_NOT_SET`)
  before touching either file.
- `lib/db/errors.ts` — two new `MESSAGE_RULES`, both regexes read directly
  from `025_user_country.sql`'s `raise exception` text, not guessed:
  `/country must be a two-letter ISO country code/i` → `INVALID_COUNTRY_CODE`,
  and `/sign in to set your country/i` → the **existing** `UNAUTHENTICATED`
  code (same pattern as `fn_reserve_credit`'s `'sign in to reserve FSC'` and
  `fn_submit_listing`'s `'sign in to list an item'` — a new code was not
  needed here, just a new pattern matching an existing one).
- Fixed an adjacent doc-drift bug while in the file: `getPayoutMethodForUser`'s
  comment still said a null country "resolves to 'credit'" — true pre-025,
  false now (025 makes it raise, mapped to `COUNTRY_NOT_SET`). Updated in
  place since it directly contradicted the `COUNTRY_NOT_SET` doc comment two
  members above it in the same file. Not one of the three requested items,
  but in-lane and adjacent enough to fix rather than leave misleading.

**Test:** `fn_payout_method_for_user`'s local mirror (`derivePayoutMethod`,
`tests/invariants.test.ts`) asserted `null`/`undefined` → `'credit'` — 025
made that wrong (same bug the migration itself closes: real signups leave
`country_code` NULL, and every launch consignor is Malaysian, so they'd all
have been paid FSC with no error). Changed the mirror to throw on
null/empty, split the one test into two (MY→cash/SG,US→credit stays; a new
one asserts the throw on null/undefined/empty-string), kept `derivePayoutMethod`
rather than deleting it, per instruction. Added two more tests exercising the
real `contractErrorCode()` (not a mirror, same reasoning as item 15's
`COUNTRY_NOT_SET` tests — `lib/db/errors.ts`'s only dependency on
`lib/api/contract.ts` is a type-only import) for both new message rules.

**Consumer, not built here:** `docs/handoff/market.md`'s 2026-08-24 entry has
a fully drafted (dry-run-verified against `39f0efa`, then reverted) wiring
plan for `app/(market)/list/actions.ts` and `app/(market)/actions.ts` —
call `setCountry()` from `submitListingIntakeAction`, and thread a country
picker into `ListForm`'s relist path (`listCardAction`, which has no country
input today and would otherwise dead-end a re-lister who never went through
intake with raw SQL text in `?error=`). Both files are `app/(market)/**`,
outside this track's lane — filed here so whoever picks up track/market next
knows the export they were blocked on now exists.

**Verification:** `npx tsc --noEmit` clean. `npm test`: **164 passing** (was
161 at the start of this pass). `npm run build` compiles (`Compiled
successfully`, all 19 routes render). `graphify update .` run after the
edits.

**Not verified live:** `setCountry()` was not called against the live
project (would be a real write to a real user's row — AGENT_RULES.md §2).
The two new message-pattern matches are taken verbatim from
`025_user_country.sql`'s `raise exception` text, same caveat as item 15's
`COUNTRY_NOT_SET` pattern — not independently confirmed against a live
Postgres error.

### 15. COUNTRY_NOT_SET given the same loud-path treatment as CREDIT_HOLD_EXPIRED in the Stripe webhook

Own finding from a prior pass: `isPermanentError()` in
`app/api/webhooks/stripe/route.ts` omitted `COUNTRY_NOT_SET`, so a settlement
for a pre-025 listing whose seller has no country retried forever on a 500
while the buyer's money sat captured. Root cause, read from the migration:
025's `fn_payout_method_for_user` now raises instead of defaulting NULL to
`'credit'`, and `fn_purchase_card_core` calls it mid-settlement
(`021_credit_holds.sql:325`), so the raise happens **after** Stripe has
already captured the card, inside the same transaction `purchaseCardSplit()`
awaits.

**The code didn't exist yet.** `COUNTRY_NOT_SET` was not a member of
`ContractErrorCode` and had no `lib/db/errors.ts` message rule — the raise
fell through to `UNKNOWN`, which explains why it wasn't already in
`isPermanentError()`'s list (it isn't now either, deliberately) but also
wasn't caught by anything else — a bare `UNKNOWN` hit the generic 500 branch.

**Changes:**
- `lib/api/contract.ts` — added `'COUNTRY_NOT_SET'` to `ContractErrorCode`,
  doc comment citing 025 and the `fn_purchase_card_core` call site.
- `lib/db/errors.ts` — added a `MESSAGE_RULES` entry matching
  `/has no country on file/i` → `COUNTRY_NOT_SET`.
- `app/api/webhooks/stripe/route.ts` — added `isCountryNotSet()`, mirroring
  `isCreditHoldExpired()`: intercepted in the catch block *before*
  `isPermanentError()`, logs `console.error` CRITICAL with payment_intent,
  listing_id, buyer_id, and now seller_id (hoisted `listing` out of the `try`
  so the `catch` can still read `listing.seller_id` — it's only reachable
  after `findListingForSettlement` succeeds, so it's always populated by the
  time this branch runs), then acknowledges 200 `recorded: false` so Stripe
  stops retrying. No forced retry, no refund — same "leave it for a human"
  posture as the credit-hold-expired branch.

**What an operator does when they see this log — spelled out because the fix
is out-of-band and there is no button for it:**
1. Get the seller to set a country. This **must** be the seller acting
   themselves — `fn_set_country` is self-service by construction (`update
   users set country_code = ... where id = v_user`, `v_user :=
   fn_current_user_id()`), and there is no admin-callable equivalent. An
   operator cannot do this step on the seller's behalf.
2. Once set, **the settlement must be replayed, and this codebase has no
   in-app way to do that.** No script, no admin action, nothing under
   `app/admin/**` touches `purchaseCardSplit` or settlement replay (checked:
   the only three call sites of `purchaseCardSplit` in the repo are
   `app/(market)/actions.ts`, `app/api/webhooks/stripe/route.ts` itself, and
   its definition in `lib/api/contract.ts`). The only real path is Stripe's
   own event-resend feature — dashboard "Resend" on the original
   `checkout.session.completed` event for that `payment_intent`, or the
   equivalent API call — which re-delivers the event to this same webhook.
   With the country now set, `fn_payout_method_for_user` resolves normally,
   `findOrderBySettlementRef` still finds no order for that
   `payment_intent.id`, and `purchaseCardSplit` completes on the replay. This
   is a genuine gap: filing it here rather than building a replay script,
   since scripting a live settlement write is exactly the kind of "test
   purchase against the project is a real purchase" action AGENT_RULES.md
   section 2 rules out for an agent to do unprompted — a human should decide
   whether an admin-side replay tool is worth building.

**Tests:** added `tests/invariants.test.ts` — `COUNTRY_NOT_SET error mapping
(025)` (imports the real `contractErrorCode()` from `lib/db/errors.ts`
directly rather than mirroring it; that module's only dependency on
`lib/api/contract.ts` is a type-only import that erases at compile time, and
`lib/api/contract.ts` is already loaded in this suite via
`CREDIT_HOLD_MINUTES_FALLBACK`, so there was no import-cost question like
item 13's route.ts case) and a new case in `stripe webhook error
classification` asserting `COUNTRY_NOT_SET` is excluded from the
`isPermanentError()` mirror, same shape as the existing `CREDIT_HOLD_EXPIRED`
case.

**Verification:** `npx tsc --noEmit` clean. `npm test`: **161 passing** (was
158 before this pass — the task description's stated baseline of 162 did not
match what this worktree actually ran before these changes; noting the
discrepancy rather than the target number). `npm run build` compiles
(`Compiled successfully`, all 19 routes render, including
`/api/webhooks/stripe`). `graphify update .` run after the edits.

**Not verified live:** could not reproduce the actual raise against the live
project (would require a real listing whose seller has a NULL country_code
post-025, which 025's own migration comment says no longer exists for any
user who lists after it ran — reproducing it needs a pre-025 in-flight
listing, which this pass did not have). The message-pattern match
(`/has no country on file/i`) is taken verbatim from
`025_user_country.sql`'s `raise exception` text, not independently confirmed
against a live Postgres error.

### 14. Closed three track/market workarounds (`docs/handoff/market.md`, 2026-08-23 entry); one correction to that entry's safety reasoning, filed here per AGENT_RULES.md section 10

Task named three items track/market had documented as workarounds. All three
addressed in `lib/db/types.ts` / `lib/api/contract.ts` only — no file outside
this track's lane was touched.

**1. `CardStatus` was missing `'pending_vault'`** (023a_card_status_pending_vault.sql
added it to the live enum). Added to `CardStatus` and `CARD_STATUSES` in
`lib/db/types.ts`, with a doc comment distinguishing it from `'locked'` (per
023a's own comment: `'locked'` means "has a live listing"; `'pending_vault'`
means "owner changed, shoe hasn't arrived yet — no listing, must not
transfer"). **Grepped the whole repo for a switch or allow-list over
`CardStatus` that could now silently admit it**: no `switch` on `CardStatus`
exists anywhere (checked every `switch (` in the repo — the three that exist
are keyed on error codes, sort options, or wizard steps, none on card
status). The one allow-list that matters, `getCards()`/`getListings()`'s
default status filter in `lib/api/contract.ts`
(`.in('status', statusFilter<CardStatus>(query.status, ['active', 'locked']))`),
is an explicit two-value list, not derived from the type — widening
`CardStatus` cannot widen it, and `'pending_vault'` staying excluded from a
default browse/card query is exactly what 023c's "must not be sellable,
listable, tradeable or redeemable" requires. Test added confirming this
allow-list still excludes it (`tests/invariants.test.ts`, `describe('CardStatus
(023a pending_vault)'`).

This retires `isPendingVault()`/`CardStatusWithVault` in
`app/(market)/card/[id]/page.tsx` — that's track/market's file, not edited
here; they can compare `detail.status === "pending_vault"` directly now that
the mirror type carries it.

**2. `getPlatformConfig()` did not expose `credit_hold_minutes`.** Added to
the `PlatformConfig` interface and to `getPlatformConfig()`'s mapping, same
pattern as every other `platform_config` key here (`byKey.get(...) ??
fallback`). New export `CREDIT_HOLD_MINUTES_FALLBACK = 1440`, same pattern as
the existing `REDEMPTION_HANDLING_FEE_CENTS`. Live value is 1440 (024f's own
comment: "credit_hold_minutes was just raised to 1440"), matching Stripe's
24h Checkout Session ceiling — the fallback's doc comment states the
direction-of-risk explicitly: raising it (or the live value) above 1440 is
harmless since Stripe just clamps its own ceiling; **lowering the live
`platform_config` value while a caller still reads the 1440 fallback is not**
— a Checkout Session could then outlive the hold backing its FSC leg, so a
buyer could pay after their hold already released the FSC back: cash
collected with no card transferred. Tests added confirming the fallback
value, that it matches market's own pinned copy of the same constant in
`app/(market)/checkout-math.ts` (they will drift once market switches to the
live config value — flagged there, not fixed here, since `app/(market)/**`
is out of lane), and the exact fallback precedence logic.

This retires market's `CREDIT_HOLD_MINUTES_FALLBACK` pin in
`app/(market)/checkout-math.ts` once they switch `createCheckoutAction` to
read `getPlatformConfig().credit_hold_minutes` — not done here, out of lane.

**3. Added `getVaultIntakeForCard(cardId)` to the contract**, reading the
023c `vault_intakes` table (`status, due_by, carrier, tracking_number,
shipped_at`, most recent row per card). Session client; `vault_intakes`' own
RLS (`consignor_id = self OR buyer_id = self OR admin`) does the access
control, matching what market's local workaround read already relied on.
This is a **read**, not a write — the all-writes-through-contract rule in
AGENT_RULES.md section 2 doesn't cover it, so exposing it is a consistency
fix, not closing a rule violation (worth being precise about, since the task
described it that way too). Shape matches market's existing
`VaultIntakeStatus` in `app/(market)/queries.ts` field-for-field (only
`due_by`/`tracking_number` are snake_case here vs. their camelCase — this
contract follows every other export's PostgREST-column-name convention, so
their adapter, not this shape, should change when they switch over).

Both 2 and 3 are additive to `lib/api/contract.ts` (new exports, no frozen
signature touched) — documented in the SANCTIONED EXTENSIONS block at the
top of the file under a new `023a/023c:` bullet.

**Correction filed, not made in place — `docs/handoff/market.md` is
track/market's file (AGENT_RULES.md section 10: "Never edit another track's
handoff file").** Their 2026-08-23 entry, section 1, reasons that the
FSC-only direct `purchaseCardSplit()` call is safe "because
`app/(market)/actions.ts` is a `'use server'` Server Action running with the
buyer's own session." Read `purchaseCardSplit()` in `lib/api/contract.ts`
(lines ~1453 on this branch) to check: it calls `createServiceSupabase()`
unconditionally, every single call, regardless of what client code invoked
it from. Service-role has no `auth.uid()` — there is no session inside this
function no matter how the caller got there. **What actually makes the
FSC-only path safe is the hold**, read directly out of
`021_credit_holds.sql`'s `fn_purchase_card_core` (lines 284-306, unchanged by
024f): when `p_hold_id` is passed, the function re-validates it independent
of any session — status `'active'`, not expired, `user_id = p_buyer_id`,
`listing_id = p_listing_id`, `amount_cents >= v_credit` — all in SQL, all
against the row `reserveCredit()` created earlier under the buyer's own
session. The `elsif fn_current_user_id() is distinct from p_buyer_id` branch
right after it (021_credit_holds.sql:307) is the one that *would* need a
session, and it only runs when `p_hold_id is null` — never true for
`purchaseCardSplit`'s FSC-only path, since it throws
`CREDIT_PROVENANCE_REQUIRED` itself before the RPC call if `creditCents > 0`
and `holdId` is null. **Practical implication, since this is exactly the
kind of thing AGENT_RULES.md section 9 asks to say plainly: if a future
change ever dropped the `holdId` argument from a `purchaseCardSplit` call
while leaving `creditCents > 0`, the current (correct) doc reasoning would
predict a hard failure — `CREDIT_PROVENANCE_REQUIRED` or the SQL's own
"spending FSC requires a session..." raise — because there is no session to
fall back on. It would not fail open.** Flagging for track/market to correct
in their own file; not urgent (no code depends on the doc text), but the
reasoning as written points at the wrong mechanism for the next person who
reads it.

**Verification:** `npx tsc --noEmit` clean. `npm test`: **142 passing** (was
136) — six new tests across two `describe` blocks (`CardStatus (023a
pending_vault)`, `PlatformConfig.credit_hold_minutes (021/024f)`), all
model-level against the real exported constants/types (`CARD_STATUSES` from
`lib/db/types.ts`, `CREDIT_HOLD_MINUTES_FALLBACK` from `lib/api/contract.ts`
itself — imported directly this time, not mirrored: probed the import cost
first (~2.2s standalone), confirmed it adds well under a second to this
file's actual run (432ms total import time for the whole suite), nowhere
near route.ts's 14s that ruled out a direct import in item 13). `npm run
build` compiles (`Compiled successfully`, all 19 routes render, including
`/card/[id]` and `/api/webhooks/stripe`).

**Not verified live:** `getVaultIntakeForCard()` was not probed against the
live project — doing so would need a real `vault_intakes` row (a first-sale
purchase), which is a real financial write this session may not perform
(AGENT_RULES.md section 2). Read against `023c_vault_custody.sql`'s actual
DDL instead (table + RLS policy text), not guessed. The `credit_hold_minutes`
live value (1440) was not re-verified live in this pass either — taken from
024f's own migration comment, which states it was "just raised to 1440,"
and from market's 2026-08-23 handoff entry, which live-verified it with the
anon key on the same day.

### 13. Checkout wired to split settlement — webhook now on checkout.session.completed/.expired; one grant gap found and fixed; one left as a genuine blocker for track/market

Task: wire the checkout data layer to 019c/021/022b's split-settlement SQL,
which `scripts/smoke_settlement.sql` already verifies live end to end.

**STEP 1 audit — all five requested functions already had contract exports,
verified by reading `lib/api/contract.ts` in full, not assumed:**
`reserveCredit()` (`fn_reserve_credit`), `releaseCreditHold()`
(`fn_release_credit_hold`), `getCreditAvailable()` (`fn_credit_available`),
`getCreditHeld()` (`fn_credit_held`), `purchaseCardSplit()` (the 5-arg
`fn_purchase_card`) — all landed in item 11 above, before this task. **STEP 2
added nothing**, because nothing was missing. This is a genuine negative
result, not a skipped step: every one of the eight `raise exception` strings
this task asked me to re-verify (STEP 4) was also already mapped correctly in
`lib/db/errors.ts`, checked character-for-character against
`021_credit_holds.sql` and `019c_settlement.sql` as they exist in this
worktree now (they didn't when item 11 was written — that pass worked from a
live probe, not the file; both agree).

**Bug found and fixed while verifying grants for STEP 3: `expireCreditHolds()`
was calling a function it had no grant on.** 021 granted
`fn_expire_credit_holds()` to `authenticated`; `022b_permissions_lockdown.sql`
(lines 161/165) revokes that and grants it to `service_role` only — "a
stranger cannot drop everyone else's in-flight checkout holds by calling it in
a loop". The contract export was still calling `createServerSupabase()` (the
session client), which has held zero grant on this RPC since 022b landed —
every call would have failed FORBIDDEN. Fixed in place (it's a 021 additive
export, not one of the 16 frozen signatures) to `createServiceSupabase()`.
Verified by reading `021_credit_holds.sql:537` against
`022b_permissions_lockdown.sql:161-165` side by side; not live-probed, since
nothing here was ever callable to probe.

**STEP 3, the webhook.** `app/api/webhooks/stripe/route.ts` no longer listens
for `payment_intent.succeeded`; it now handles `checkout.session.completed`
and `checkout.session.expired`, per the task. On completion it retrieves the
real `PaymentIntent` (`stripe.paymentIntents.retrieve`) — never trusting
`session.payment_status`, which reads `unpaid` even after
`checkout.session.completed` for delayed payment methods, and checks
`intent.status === 'succeeded'` before doing anything — reads `listing_id` /
`buyer_id` / `credit_cents` / `hold_id` off `intent.metadata`, and settles
through `purchaseCardSplit()` (the 5-arg RPC) with `intent.id` as
`settlementRef` always, satisfying "a cash leg needs a non-empty
settlement_ref" unconditionally since Checkout only reaches `succeeded` with a
real intent id. Redelivery safety is unchanged and still two-layered:
`findOrderBySettlementRef(intent.id)` before calling, plus 017's own
idempotency inside `fn_purchase_card`.

**`CREDIT_HOLD_EXPIRED` is NOT folded into the ordinary acknowledge-and-log
path.** By the time this can fire, Stripe has already captured the buyer's
cash — settlement not happening here means a charged buyer with no card and
no FSC back (the hold flips to `expired`, not consumed). The webhook still
returns 200 (retrying is futile — the hold's expiry is deterministic on every
redelivery, verified by reading `fn_purchase_card_core`'s exception handling:
an unhandled `raise exception` aborts the whole RPC transaction, so the
`update ... set status = 'expired'` right before the raise does NOT persist
either — the row is untouched, still `active` with a past `expires_at`, so a
retry hits the identical raise every time), but logs it as a distinct
`CRITICAL` block with every identifying field (payment intent, buyer, listing,
hold id, amount, currency) and takes no automatic recovery action — no
refund, no fresh hold, no forced retry — leaving it for a human. Exactly what
the task asked for; said here explicitly since "log it loudly" has no
executable definition otherwise.

**STEP 3, `checkout.session.expired` — implemented, but with a real
limitation, not silently worked around.** `fn_release_credit_hold(p_hold_id)`
— the function that frees exactly one hold — is granted to `authenticated`
only in both 021 and 022b; it was never granted to `service_role`, and its own
ownership guard (`fn_current_user_id()` vs the hold's `user_id`) would refuse
a service-role caller even if it were. The webhook has no session by
construction, so **it cannot release a specific hold**. The only
service-role-callable surface either migration leaves for this is
`fn_expire_credit_holds()` — a global sweep of every hold whose `expires_at`
has passed, not just the one this checkout abandoned. `handleCheckoutExpired`
calls that (now that it's fixed, see above) and logs which hold it was
targeting, but the sweep only actually frees that FSC once the hold's own
`credit_hold_minutes` TTL (default 30 min, `platform_config`) has separately
elapsed — it does nothing if the Stripe Checkout Session's own `expires_at`
fires first. **Ask for track/market, when `createCheckoutAction` is extended
to call `reserveCredit()` (per item 11's ask, still open — checkout is
cash-only today, nothing calls `reserveCredit()` anywhere in `app/**`,
verified by grep):** set the Checkout Session's `expires_at` no earlier than
the hold's expiry (or shorter, and re-reserve on retry), and carry
`credit_cents` / `hold_id` into `payment_intent_data.metadata` alongside the
existing `listing_id` / `buyer_id`. **Ask for whoever next touches SQL:** the
clean fix is granting `fn_release_credit_hold` to `service_role` with a
provenance carve-out mirroring `fn_purchase_card_core`'s own pattern (trust a
hold id without a session, since service-role has none), so
`checkout.session.expired` can release the ONE hold that actually expired
instead of sweeping globally. Not built here — `.sql` is human-only.

**STEP 4 error mapping** — all eight raise strings the task listed were
already correctly mapped in `lib/db/errors.ts` (item 11's earlier pass got
these right against the applied files); re-verified each again here against
`021_credit_holds.sql` as it exists in this worktree now, character for
character: `insufficient FSC: balance %, requested %` (line 313),
`credit hold % expired at %` (295), `credit hold % belongs to another user`
(298), `credit hold % is for a different listing` (301),
`credit hold % covers only % of % requested` (304-305),
`FSC settlement is disabled` (278), `a cash leg of % cents requires a
settlement_ref` (320-321), `spending FSC requires a session matching the
buyer, or a credit hold` (308). No pattern changed.

**`isPermanentError()` in the webhook** now also treats
`INSUFFICIENT_CREDIT`, `CREDIT_SETTLEMENT_DISABLED`,
`CREDIT_PROVENANCE_REQUIRED`, `CREDIT_HOLD_WRONG_USER`,
`CREDIT_HOLD_WRONG_LISTING`, `CREDIT_HOLD_INSUFFICIENT` and
`SETTLEMENT_REF_REQUIRED` as permanent (acknowledge, don't retry) — all six
reproduce identically on redelivery, same reasoning as the pre-existing four.
`CREDIT_HOLD_EXPIRED` is deliberately excluded from this list; see above.

**STEP 5 tests.** `npm test`: **119 passing** (was 107). Twelve new tests,
all model-level mirrors of `route.ts`'s pure decision logic (metadata
parsing/validation, the cash-leg amount clamp, permanent-vs-retryable error
classification) — same convention as every other `describe` block in this
file, not calls into the real RPC or an import of `route.ts` itself. Tried
importing `route.ts` directly first: it works, but costs ~14s just to resolve
the Stripe/Supabase/Next module graph, against ~0.5s for this entire file
today, so it was rejected in favour of the mirror pattern already established
here. No new contract exports needed tests, because STEP 1/2 found none were
added.

`npx tsc --noEmit` clean, `npm run build` compiles (`Compiled successfully`,
all 19 routes render including `/api/webhooks/stripe`), `npm test`: 119
passing.

**Not verified live:** the whole webhook rewrite, by necessity — a live
webhook call needs a real Stripe event, a real signature, and a real
settlement, which this session may not write to the live database
(AGENT_RULES.md §2 — "never write to the live database"; STEP 8's own live
probe requirement is for read/policy checks, and this is a write). Everything
above was verified by reading the applied `.sql` files directly, plus `tsc`
and `next build` passing. **The Stripe dashboard's webhook endpoint still
needs its subscribed events changed** from `payment_intent.succeeded` to
`checkout.session.completed` + `checkout.session.expired` — an operational
step, not code, and outside what this track can do from here.

### 12. 022b `purchaseCardWithCredit` deletion, and two dead error mappings found while checking it

`fn_purchase_card_with_credit(uuid, uuid)` is dropped by `022b_permissions_lockdown.sql`
(verified by reading the file: `drop function if exists
fn_purchase_card_with_credit(uuid, uuid);`, and its own assertion block
confirms the drop). Deleted `purchaseCardWithCredit()` from
`lib/api/contract.ts` — same treatment as `purchaseCredit()`'s deletion
(item 11): no stub, no shim, doc comment removed with it. No caller existed
anywhere in `app/**` (grepped). Added a `022b:` bullet to the SANCTIONED
EXTENSIONS doc block recording the deletion, mirroring the `021:` bullet's
`purchaseCredit()` entry.

**Checked `lib/db/errors.ts` per this task's instruction — whether
`fn_purchase_card_core` raises the same message before deleting a mapping —
and found three different answers for the three codes this function touched:**

- `CREDIT_SETTLEMENT_DISABLED`: **kept**, pattern fixed. `fn_purchase_card_core`
  (019c/021) does raise for this same condition, but the wording changed:
  `'FSC settlement is disabled'`, not the old `'credit settlement is
  disabled'` that `fn_purchase_card_with_credit` (011/014, now dropped)
  raised. The old regex only matched the dropped function's exact text, so
  it had gone quietly dead — verified by reading `019c_settlement.sql:143`
  and `021_credit_holds.sql:278` directly. Repointed the pattern at the
  live wording.
- `INSUFFICIENT_CREDIT`: **kept as-is**, comment only. Its regex already
  covers `fn_purchase_card_core`'s and `fn_reserve_credit`'s live wordings;
  only the `insufficient credit` alternative (011/014's exact text) was
  dead weight, now dropped from the pattern along with the stale "kept in
  case an unreplaced install still runs the old body" comment — the body
  is not just replaced, it no longer exists.
- `PAYOUT_MISMATCH`: **message rule deleted, `ContractErrorCode` member
  kept.** Neither of the two raises this rule ever matched is reachable any
  more: 011/014's `fn_purchase_card_with_credit` text (022b) and 012's
  payout-guarded `fn_purchase_card` text (022, already dropped before this
  session) are both gone, and the live `fn_purchase_card_core` (021)
  never refuses on payout method at all — AGENT_RULES.md section 5's
  "independent axes" model replaced it. Removed the dead `MESSAGE_RULES`
  entry (with a comment explaining why, in place). **Did not** remove
  `'PAYOUT_MISMATCH'` from `ContractErrorCode` itself:
  `app/api/webhooks/stripe/route.ts`'s `isPermanentError()` still compares
  `thrown.code === 'PAYOUT_MISMATCH'` (webhooks are this track's lane, but
  this task named `contract.ts`/`errors.ts` only, and removing the member
  would need editing that comparison too — flagging rather than doing it
  unasked). That branch is now unreachable dead code in `route.ts`, harmless
  as a never-true arm of an `||`, but worth cleaning up next time someone is
  in that file.

Also renamed `tests/invariants.test.ts`'s `'holds for a real credit-topup
txn_id (asset=credit)'` to `'holds for a real credit txn_id with a single
offsetting pair (asset=credit)'` — assertion unchanged, only the name, which
previously read as evidence that a credit top-up path exists (it does not,
per AGENT_RULES.md section 5).

`npx tsc --noEmit` clean, `npm run build` compiles (all 19 routes render),
`npm test`: **107 passing** (unchanged — this task only touched comments,
one dead mapping, and one test name, no assertion logic).

**Not verified live:** nothing here needed a live probe — every claim above
came from reading the applied `.sql` files directly (`019c_settlement.sql`,
`021_credit_holds.sql`, `022_drop_legacy_settlement.sql`,
`022b_permissions_lockdown.sql`), all present in this worktree.

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