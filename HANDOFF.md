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

Current state after five completed runs: 5 cards (mints #1–#5), 5 settled
orders (`seed_pi_001`–`005`), 6 consignments, and the `seed_admin` auth user.

An earlier run was killed mid-flight and left an orphan — a `completed`
consignment whose item was still `pending_intake`, ungraded, with no card.
Those two rows have since been deleted from the live project. Not a shape the
pipeline can otherwise produce; if it reappears, a run was interrupted.

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

**The gap that let this drift:** `tests/invariants.test.ts` pins the fixtures
hard against the SQL functions but asserts nothing about `palette` or
`sprite_key`, so the format change landed green. `tests/**` is not my path, but
it is about eight lines to close — for each SKU, every non-`.` glyph in
`SPRITE_MAPS[sku.sprite_key]` must have a palette entry, and `sprite_key` must
name a real map. Worth adding before another track re-keys anything.

