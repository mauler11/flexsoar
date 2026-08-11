## Handoff requests

### From track/data

Ordered by what blocks the most. Nothing here was worked around by touching
another track's files.

---

#### RESOLVED — items 1 to 5 (was: deps, users.id, items RLS, users RLS, fn_award_xp)

Left as a record of what changed, since tracks C and D were told to expect
some of these.

- **Dependencies installed.** `@supabase/ssr` 0.12.4, `@supabase/supabase-js`
  2.112.2 and `stripe` 22.4.0 are on `main`. `lib/db/vendor-shims.d.ts` is
  deleted and `tsc --noEmit` passes against the real published types with no
  code changes — the shims were faithful.

- **`users.id` = `auth_id`** is now enforced by the `users_id_matches_auth`
  trigger, and `fn_current_user_id()` resolves `auth.uid()` consistently across
  every policy. `lib/db/provision.ts` already did this; the trigger makes a
  seed or manual insert that forgets it fail loudly.

- **`items_admin_read` / `items_consignor_read` landed**, so the pre-mint
  pipeline is visible to the admin grading queue and to the consignor. The
  service-role workaround in `getConsignment()` is deleted — it reads as the
  user again.

- **`fn_award_xp` is revoked** from `anon` and `authenticated`, along with
  `fn_refresh_float_percentiles` and `fn_refresh_levels`. See item 11 for what
  that means for `awardXp()`.

- **`users` still has no RLS.** 004 did not enable it, and it remains readable
  by anyone holding the anon key, `email` included. Still worth a migration —
  it needs a self-read policy in the same change or the `/admin` gate fails
  closed for everyone.

---

#### 6. `middleware.ts` is deprecated in Next 16

Next 16 renamed the convention to `proxy.ts`. `middleware.ts` still works and
is the path this track was scoped to own, so the rename was left alone —
`proxy.ts` is not one of my paths. Run when convenient:

```bash
npx @next/codemod@canary middleware-to-proxy .
```

---

#### 7. For track/admin — the `/admin` gate is optimistic, not authoritative

`middleware.ts` redirects non-admins away from `/admin`, and it fails closed.
But the Next docs are explicit that proxy/middleware is for optimistic checks,
not authorisation, and it does not run on Server Action invocations reached
from an already-loaded page. **Every admin page and action should re-check
`is_admin` server-side**, e.g.:

```ts
const user = await getUser({ authId: authUserId });
if (!user?.is_admin) notFound();
```

Since 005 this is defence in depth rather than the only defence: `mintCard` and
`advanceConsignment` are enforced inside the database against `auth.uid()` (see
item 11). Do it anyway — it turns a raw `FORBIDDEN` from Postgres into a
sensible page, and it is the only guard on admin screens that read data or call
anything else.

---

#### 8. For track/market — `lib/api/contract.ts` is server-only

It reaches `lib/supabase/server.ts`, which reads `next/headers` and holds the
service-role path used by `purchaseCard()` and `refreshLevels()`. Importing it
from a client component is a build error, and deliberately so: that is what
keeps `SUPABASE_SERVICE_ROLE_KEY` out of every client bundle.

Call it from Server Components and Server Actions. For the post-checkout poll
described on `ListingDetail.order`, wrap `getListing()` in a Server Action or a
route handler and poll that — a client component cannot import the contract
directly. Route handlers outside `app/api/webhooks/**` are not my paths, so I
have not added one.

For the browser, `lib/supabase/client.ts` exports `createBrowserSupabase()`.
Auth and realtime only — never reads or writes.

---

#### 9. Stripe: env vars, metadata, and the email template

**Environment variables** — add to `.env.local` and to the deployment:

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_SITE_URL=     # optional; magic-link redirects fall back to the Host header
```

**Checkout Sessions must set payment intent metadata.** The webhook attributes
the sale from it and cannot proceed without it:

```ts
payment_intent_data: {
  metadata: { listing_id: listing.id, buyer_id: user.id },
}
```

An intent arriving without both keys is acknowledged with a 200 and logged as
`not recorded` — retrying it would never help.

**Supabase Auth redirect URLs.** `/callback` must be on the project's Redirect
URLs allow-list (Authentication → URL Configuration), for local and deployed
origins both, or Supabase refuses the `emailRedirectTo`.

**Magic-link email template.** `app/(auth)/callback/route.ts` accepts either
shape, so no change is strictly required. The `token_hash` form is the current
recommendation:

```
{{ .SiteURL }}/callback?token_hash={{ .TokenHash }}&type=magiclink
```

---

#### 10. Smaller notes

- **Sign-in discloses whether an address is registered.** `shouldCreateUser`
  is false on `/sign-in`, so Supabase answers an unknown address with an error,
  and AGENT_RULES.md says surface server errors verbatim. If user enumeration
  matters more than the verbatim rule here, that is a product call — say so and
  I will make `/sign-in` always claim success.

- **`value_asc` / `value_desc` on `getCards()` and `float_asc` / `float_desc`
  on `getListings()` page inside a 1000-row window.** PostgREST cannot order by
  a SQL function (`fn_card_value_cents`) or by a column on an embedded table,
  so those four sorts pull one window and rank in JS; `offset + limit` beyond
  1000 returns nothing. Every other sort is ordered and paged by the database
  with no ceiling. A generated column or a view would remove the ceiling, but
  both are `.sql` changes.

- **`getCards()` defaults** to `status in ('active','locked')`, newest first,
  50 rows, capped at 200. `getListings()` defaults to
  `status in ('early_access','public')`. Neither default was specified in the
  contract; change them if a UI track needs different ones.

- **`lib/db/valuation.ts` mirrors `fn_float_multiplier` and
  `fn_card_value_cents` in TypeScript**, used only for the JS-side sorts above.
  Single-card values come from the RPC and are exact. If either SQL function
  changes, change that file with it.

---

#### 11. Which client each mutation runs on (after 004 and 005)

004 revoked execute on five functions; 005 granted two of them back and put an
`is_admin` check inside instead. Net result:

| contract function      | client        | authorisation                          |
| ---------------------- | ------------- | -------------------------------------- |
| `mintCard`             | **session**   | `fn_require_admin()` inside the SQL     |
| `advanceConsignment`   | **session**   | `fn_require_admin()` inside the SQL     |
| `purchaseCard`         | service-role  | webhook only; no session exists         |
| `refreshLevels`        | service-role  | nightly job; no session exists          |
| `awardXp`              | service-role  | internal helper, see below              |
| `listCard`             | session       | checks ownership itself                 |
| `cancelListing`        | session       | checks ownership itself                 |
| `redeemCard`           | session       | checks ownership itself                 |
| `gradeItem`            | **session**   | `fn_require_admin()` inside the SQL (008)|
| `authenticateItem`     | **session**   | `fn_require_admin()` inside the SQL (008)|
| `rejectItem`           | **session**   | `fn_require_admin()` inside the SQL (008)|

**For track/admin, this is now much better news than item 7 suggested.**
`fn_mint_card` and `fn_advance_consignment` enforce `is_admin` themselves,
against `auth.uid()`, inside the transaction. A Server Action that reaches them
without an admin session is refused by the database, not merely by a route
gate. You should still check `is_admin` in the page for a decent error, but it
is no longer the only thing standing between a user and a mint button.

The refusal surfaces as `ContractError` with code **`FORBIDDEN`** and message
`admin privileges required`. Branch on the code.

**`advanceConsignment(id, to, actorId, note)` ignores `actorId`.** 005 takes
the actor from the session — `fn_require_admin()` returns the caller's
`users.id` and that is what lands on `consignment_events.actor_id`, so a
mismatched argument can no longer forge history. The parameter survives only
because this contract is frozen. Keep passing the signed-in user so the call
site stops lying the day the signature can change; `scripts/seed.ts` verifies
the behaviour by passing the wrong id on purpose and asserting 0 of 6 events
recorded it.

**Do not call either one service-role.** Under the service key `auth.uid()` is
null, no `users` row resolves, and the guard refuses. That is also why
`purchaseCard` stays service-role and cannot adopt the same pattern: the Stripe
webhook has no session to check.

**`awardXp` is effectively internal.** 004 classifies `fn_award_xp` as a helper
— mint, purchase and redemption already award their own XP inside the same
transaction, and an unguarded award is a self-service fee discount
(XP -> rank_score -> level -> seller_fee_bps). It stays exported because the
contract is frozen, but if you are reaching for it, the XP probably belongs
inside a SQL function. Say so here and it can go into 006.

---

#### 12. `scripts/seed.ts` — what it does and how to run it

```bash
node --env-file=.env.local --experimental-strip-types scripts/seed.ts
```

Walks one shoe end to end against the live project: consignment `draft ->
completed`, item graded and authenticated, minted, listed, purchased with a
fabricated `settlement_ref` (`seed_pi_001`, `seed_pi_002`, …), then prints the
ledger and the provenance chain with the net-to-zero and single-open-hop
invariants restated.

- **Re-runnable.** The two users (`seed_consignor`, `seed_buyer`) and the SKU
  have fixed identities and are reused. Everything downstream is created fresh
  per run, so each run exercises the whole path rather than reporting that
  there was nothing to do — and each run therefore adds one card and one
  settled order.
- **It does not import `lib/api/contract.ts`,** for two reasons that are not
  preferences: the contract's reads and several of its mutations call
  `cookies()` from `next/headers`, which only resolves inside a Next request;
  and most of what seeding needs (users, SKUs, consignments, items, grading,
  authentication) has no RPC at all in 002_operations.sql. It calls each RPC
  with exactly the argument names the contract uses.
- **It uses two clients, mirroring the split in item 11.** Service-role for
  direct table writes, `fn_list_card`, `fn_purchase_card` and the closing
  reads; an admin session for `fn_mint_card` and `fn_advance_consignment`,
  which 005 refuses under the service key.
- **It creates one real auth user**, `seed_admin@flexsoar.test`, because an
  admin session needs an `auth.users` row to sign in as — the other two seed
  users are plain `users` rows with fabricated `auth_id`s and never
  authenticate. Password defaults to a fixed dev credential in the file;
  override with `SEED_ADMIN_PASSWORD`. To remove it: delete the user in
  Authentication -> Users, then its `users` row.
- **Node runs it with `--experimental-strip-types`,** which prints a
  `MODULE_TYPELESS_PACKAGE_JSON` warning on every run. Harmless. It goes away
  with `"type": "module"` in `package.json`, or by renaming the file to
  `scripts/seed.mts` — both are outside my paths, and the file name was
  specified.

Since 008 the seed grades through `fn_grade_item` and `fn_authenticate_item`
on the admin session, with six real rubric scores, instead of writing `items`
directly under service-role. It prints the weighting arithmetic per component.

Current state after seven completed runs: 7 cards (mints #1–#7), 7 settled
orders (`seed_pi_001`–`007`), 7 consignments, 7 items all minted, and the
`seed_admin` auth user. No strays.

The orphan an interrupted run once left behind is gone, and I confirmed the
project is clean: every item is minted and every consignment completed. If a
`completed` consignment with a `pending_intake` item reappears, a run was
interrupted — the pipeline cannot otherwise produce that shape.

---

### Design track → data track — fixture palettes need re-keying

`lib/sprites` now ships the 40-wide maps with 9-key palettes
(`D C c B b W I i G`). The `skus.palette` JSON in `lib/mock/fixtures.ts` still
holds the old 3-key A/B/C format, so `paletteFromJson` resolves only `C` and
`B` against the new maps and every fixture-driven sprite (CardTile, CardDetail,
styleguide rarity frames) renders mostly transparent. Re-key the six fixture
palettes to the 9-key format — the four shipped palettes are the reference, see
`PALETTES` in `lib/sprites/maps.ts`.

---

#### 13. I edited `lib/mock/fixtures.ts`, which is not one of my paths

Flagging it because AGENT_RULES.md says not to, and you should know it happened
rather than find it in a merge.

You asked for it directly, `track/design` had already merged into this branch
(so `lib/sprites/` is present and the concurrent-edit risk the rule guards
against was largely gone), and no track lists `lib/mock/**` as its own — it is
a Phase 0 artifact. I treated the instruction as extending my paths the way
`scripts/**` was extended. If that was not the intent, revert the single commit
and hand it to `track/design`, who own the sprite format.

**What changed:** all six `skus.palette` values re-keyed from the old 3-key
`A/B/C` format to the 9-key `D C c B b W I i G` format, using `PALETTES` in
`lib/sprites/maps.ts` as the reference. The Jordan Chicago fixture is set to
exactly `PALETTE_CHICAGO`, since it is literally the same colourway — fixture
and styleguide now render that shoe identically.

Roles were reassigned, not renamed: the old `C` was usually the lightest
colour, while the new `C` is the upper regardless of lightness (black canvas on
the Vans, cream leather on the Chicago). A mechanical `A->C, B->B, C->W` rename
would have looked plausible and been wrong on four of the six.

Verified: both base maps use all nine glyphs, and all six palettes now resolve
100% of painted cells. Before the change each palette covered 1 of the 9 keys
in use, so roughly 96% of every fixture sprite was transparent.

**The gap that let this drift is now closed.** `tests/invariants.test.ts` had
no assertion about `palette` or `sprite_key`, so the format change landed
green. On a further extension of my lane to `tests/**`, it now has a `SPRITES`
section: per SKU, `sprite_key` must name a real map, and every glyph that map
draws must resolve in the palette. 65 tests -> 77.

Those assertions go through `spriteMapForKey()` and `paletteFromJson()` rather
than reading `sku.palette` directly, because those are the functions the UI
uses and they are stricter than a key check — `paletteFromJson` drops any value
that is not a `#`-prefixed string, so `{ D: 'red' }` resolves to nothing. A
raw `'D' in palette` test would pass it and the sprite would still be missing
its outline.

Verified by breaking the fixtures three ways and confirming each is caught:
the old `A/B/C` palette (7 glyphs unresolved), an unknown `sprite_key`, and a
non-hex palette value. All three restored afterwards.

---

#### 14. 006 put RLS on `users` — embedded profiles are now partly placeholder

**Every embedded user now comes from the `public_profiles` view.** Card owners,
listing sellers, consignors and every hop on a provenance chain. Reading
`users` for someone else does not error under a session, it silently yields
null — which an `!inner` embed turns into a listing that vanishes from the
market grid, and a plain embed turns into a `NOT_FOUND` out of
`requireEmbed()`. Verified against the live project before and after.

**THE PART THAT WILL BITE YOU.** `UserSummary` declares eight fields; the view
exposes five. These three are placeholders on any *embedded* user:

| field                   | real value | what you get |
| ----------------------- | ---------- | ------------ |
| `portfolio_value_cents` | in `users` | always `0`     |
| `is_admin`              | in `users` | always `false` |
| `is_consignor`          | in `users` | always `false` |

The contract is frozen, so `UserSummary` cannot be narrowed to say so in the
type. Do not render a portfolio total from an embedded user, and never treat
`is_admin` there as a permission check — a real admin reads as `false`. The
substitution lives in one function, `toUserSummary()`, rather than scattered
across the six call sites.

**Ask me to widen this if you need it.** `portfolio_value_cents` is the one
with a genuine display use (`/u/[handle]`), and it is not really a secret: it
is derivable from a user's public cards, since `cards_public_read` is
`using (true)` and `fn_card_value_cents` is callable. Adding it to the view in
a 007 would be defensible. `is_admin` and `is_consignor` arguably should stay
off a public view regardless.

**`getUser()` no longer finds strangers, and this blocks
`app/(market)/u/[handle]`.** It returns `User`, which includes `email`, so it
cannot move to the view — that would mean either leaking email or fabricating
one. It now returns your own row, or any row if you are an admin, and `null`
otherwise. That is correct behaviour, but it leaves track/market with no way to
turn a handle into a profile, and no contract read covers it:
`getCards({ ownerId })` needs an id.

Three ways out, your call — I have not picked one:
1. Unfreeze the contract for one addition, `getPublicProfile(handle)`.
2. Let me export a `lib/db/profiles.ts` helper (my path) that track/market
   imports directly, accepting that it is a read outside the contract.
3. Route the page by user id instead of handle, so `getCards({ ownerId })` is
   enough — cheapest, but the URL stops being human-readable.

**`lib/db/provision.ts` now provisions on the caller's session, not the service
key.** 006's `users_self_insert` pins `auth_id = auth.uid()`, `id = auth.uid()`
and `is_admin = false`, so running as the user makes the database enforce all
three; under service-role they are bypassed and a bug here could mint an admin
that 005's `fn_require_admin()` would then honour. Verified on a throwaway
account: a self-insert carrying `is_admin: true` is refused with `42501`
(mapped to `FORBIDDEN`), the normal insert is accepted and readable back, and
the account was deleted afterwards.

One branch still needs the service key and cannot move: adopting a
pre-existing row seeded with `auth_id = null`. That row is invisible to
`users_self_read`, and 006 ships no UPDATE policy at all. It is marked in the
file.

While there, that branch had a latent bug 004 introduced: it used to
`console.warn` and carry on when the existing row's `id` did not match the auth
id, but the `users_id_matches_auth` trigger now rejects that UPDATE outright.
It raises a clear error naming the mismatch instead of letting a trigger
message surface from three frames down.

**Still no UPDATE policy on `users`.** Nobody can change their own handle. 006
calls this out deliberately; it needs a column-scoped policy in a later
migration before any profile-editing UI is possible.

---

#### 15. 008 grading — new contract surface, and a numbering correction

**Numbering note, corrected.** When 008 landed, this track reported that "item
15" did not exist on any branch — true of the branches visible at the time, but
wrong: items 13–15 were the **admin track's** numbering, filed in what is now
`docs/handoff/admin.md`, which had not yet reached this branch. That file
records them resolved by 008. The entry below stands as the data-track record
of the same work.

**What 008 closed, whether or not it was written down:** the grading queue had
no write path at all. `scripts/seed.ts` wrote `items` directly under
service-role, which is not something an admin UI can or should do, and the six
rubric components had nowhere to live but JSON inside `grading_notes`.

**New contract surface (additive — the original 16 are untouched):**

| function | notes |
| --- | --- |
| `gradeItem(itemId, float, notes?, components?)` | session client, admin-guarded |
| `authenticateItem(itemId, location?)` | session client, admin-guarded |
| `rejectItem(itemId, reason)` | session client, admin-guarded |
| `getItems(query)` | items across all consignments — the grading queue |

Plus `ItemsQuery`, `GradeComponents`, `GRADE_WEIGHTS`,
`gradeFloatFromComponents()`, and two `ContractErrorCode` members. The
extension was explicitly authorised for 008 and is not standing permission to
add a fifth; the file header says so.

**For track/admin, the three things that will save you time:**

1. **Do not ask the grader for a float.** Score the six components, then call
   `gradeFloatFromComponents()` and send the result. `items_grade_components_sum`
   rejects any other combination, and the rubric is explicit that deciding the
   total first is the failure mode it exists to prevent. Verified live: a float
   of 0.500 with components summing to 0.062 is refused.
2. **The two new error codes tell you which constraint failed.**
   `GRADE_COMPONENTS_MISMATCH` — float is not the weighted sum; show the
   computed value and let them accept it. `GRADE_COMPONENTS_INCOMPLETE` — some
   but not all six; it is all or none. Both arrive as SQLSTATE 23514, which on
   its own says only "a check failed", so the mapping is by constraint name.
   Both verified firing against the live project.
3. **`ItemSummary.grade` is null for anything graded before 008**, and null as
   a set rather than field by field. Your UI needs that path regardless — and
   the fixtures are all in it (see below).

**`graded` / `authenticated` on `ItemsQuery` filter on the timestamp, not the
status,** because the two are independent: an item can be authenticated before
it is graded or after, and only when both have happened does it reach
`in_custody` and become mintable. The queue you most likely want is
`getItems({ graded: false })`.

**`getItems` returns what your session may see.** An admin sees everything, a
consignor their own, anyone else only minted/redemption_hold/shipped. An empty
array means "none you may see", not "none exist".

**The fixtures carry null components.** Extending `Item` with the six columns
forced a change to `lib/mock/fixtures.ts` (not my path — it would not compile
otherwise), and I kept it minimal: six nulls in the one `.map()`. Populating
them means choosing six scores whose weighted sum is each seed float to 3dp, or
the fixtures would describe rows the database would reject. Say the word if you
want the populated path to render and I will do the arithmetic.

---

#### 16. admin.md items 3, 4, 5 — landed (getItem, link columns, tie-rounding fix)

Filed on `track/admin` (`docs/handoff/admin.md` there; that branch renumbered
the file, so this note lives here to avoid a manufactured merge conflict).

- **Item 5, the real bug: `gradeFloatFromComponents()` rewritten in integer
  arithmetic.** The FP version rounded every exact half-milli tie down while
  `items_grade_components_sum` recomputes in `numeric` and rounds half away
  from zero — ~3% of valid 2dp grades produced a float the constraint then
  rejected. Now: components to exact hundredths, weights as whole percents,
  products summed in ten-thousandths, one half-up rounding at the end. The
  helper moved to `lib/db/grading.ts` (pure, testable — the contract module
  graph reaches `next/headers`); `lib/api/contract.ts` re-exports it, so no
  import changes anywhere. Verified against the live database on the
  counterexample: accessories 0.29 alone — 0.014 (old answer) rejected 23514,
  0.015 (new answer) accepted. `scripts/seed.ts` had the same formula inlined
  and got the same rewrite. **`floatForSave()` in
  `app/admin/grading/actions.ts` is now a no-op and can be deleted.**
- **Tests: 77 -> 87.** A sweep of every component at 0.00–1.00 in 0.01 steps,
  all six moving together, and a 101×101 heel×accessories plane (where the
  ties are dense — 240 failing cases under the old code), all asserted against
  integer-exact arithmetic. The suite was run against the buggy implementation
  first to prove it fails.
- **Item 3: `getItem(itemId)`** — one item with SKU embed and card_id lookup,
  RLS-scoped like `getItems()`. Retires `getAdminItem()`.
- **Item 4: `consignment_id` and `consignor_id` on `ItemSummary`** (and in the
  projection). Retires `getItemOwners()` — the mint action can take the owner
  straight off the item.
- `getAdminRedemptions()` was already covered by 009's `getRedemptions()`.
  **All three local adapters in `components/admin/db-reads.ts` can be
  deleted.** One rename to note: the contract calls the requester embed
  `user`, the adapter called it `requester`.
