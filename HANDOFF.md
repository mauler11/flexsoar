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

  Note that `package.json` on `main` has them but this branch's does not, so
  this worktree's `node_modules` was synced with `npm i --no-save` rather than
  by editing `package.json`. Nothing to do: the two converge when track/data
  merges into `main`.

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

Next 16 renamed the convention to `proxy.ts`
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
`middleware.ts` still works and is the path this track was scoped to own, so
the rename was left alone — `proxy.ts` is not one of my paths. Run when
convenient:

```bash
npx @next/codemod@canary middleware-to-proxy .
```

---

#### 7. For track/admin — the `/admin` gate is optimistic, not authoritative

`middleware.ts` redirects non-admins away from `/admin`, and it fails closed.
But the Next docs are explicit that proxy/middleware is for optimistic checks,
not authorisation, and it does not run on Server Action invocations reached
from an already-loaded page. **Every admin page and action must re-check
`is_admin` server-side**, e.g.:

```ts
const user = await getUser({ authId: authUserId });
if (!user?.is_admin) notFound();
```

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

#### 11. Three more RPCs are now service-role, and one is effectively internal

004_rls_and_grants.sql revoked execute from `anon` and `authenticated` on five
functions. Four of them are reachable through the contract, so those calls
moved to the service-role client or they would fail with `permission denied
for function ...`:

| contract function      | client        | note                                   |
| ---------------------- | ------------- | -------------------------------------- |
| `mintCard`             | service-role  | **admin only** — gate it yourself       |
| `advanceConsignment`   | service-role  | **admin only** — gate it yourself       |
| `purchaseCard`         | service-role  | webhook only, unchanged                |
| `refreshLevels`        | service-role  | nightly job, unchanged                 |
| `awardXp`              | service-role  | internal; see below                    |
| `listCard`             | user session  | unchanged — checks ownership itself   |
| `cancelListing`        | user session  | unchanged — checks ownership itself   |
| `redeemCard`           | user session  | unchanged — checks ownership itself   |

**For track/admin, the important part:** the revoke closed the PostgREST
surface, it did **not** add a caller check. Nothing inside `fn_mint_card` or
`fn_advance_consignment` asks who is calling, and the contract now calls them
with a key that bypasses RLS entirely. So an admin page that invokes either
without first checking `users.is_admin` server-side is an unauthenticated mint
button. The middleware gate is not enough — see item 7.

`advanceConsignment(id, to, actorId, note)` also only *records* `actorId` onto
`consignment_events`; it is not verified. Pass the real signed-in user or the
audit trail lies.

**`awardXp` is now effectively internal.** 004 classifies `fn_award_xp` as a
helper — mint, purchase and redemption already award their own XP inside the
same transaction, and an unguarded award is a self-service fee discount
(XP → rank_score → level → seller_fee_bps). It stays exported because the
contract is frozen, but if you are reaching for it, the XP probably belongs
inside a SQL function instead. Say so here and it can go into 005.

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
  preferences: the contract's reads and three of its mutations call `cookies()`
  from `next/headers`, which only resolves inside a Next request; and most of
  what seeding needs (users, SKUs, consignments, items, grading,
  authentication) has no RPC at all in 002_operations.sql. It uses the
  service-role client directly, calling each RPC with exactly the argument
  names the contract uses.
- **Node runs it with `--experimental-strip-types`,** which prints a
  `MODULE_TYPELESS_PACKAGE_JSON` warning on every run. Harmless. It goes away
  with `"type": "module"` in `package.json`, or by renaming the file to
  `scripts/seed.mts` — both are outside my paths, and the file name was
  specified.

**One piece of stray data on the live project, from me.** An early run was
killed mid-flight (I piped its output to `head`, which closed the pipe). It
left one orphan: a `completed` consignment whose item is still
`pending_intake`, ungraded, with no card. Harmless and self-consistent, but it
is not a shape the pipeline would otherwise produce. Say the word and I will
delete those two rows — I have not, because deleting from the live project is
not reversible and you did not ask for it.

Current state after three completed runs: 3 cards (mints #1–#3), 3 settled
orders (`seed_pi_001`–`003`), 4 consignments (one of them the orphan above).
### Design track → data track — fixture palettes need re-keying

`lib/sprites` now ships the 40-wide maps with 9-key palettes
(`D C c B b W I i G`). The `skus.palette` JSON in `lib/mock/fixtures.ts` still
holds the old 3-key A/B/C format, so `paletteFromJson` resolves only `C` and
`B` against the new maps and every fixture-driven sprite (CardTile, CardDetail,
styleguide rarity frames) renders mostly transparent. Re-key the six fixture
palettes to the 9-key format — the four shipped palettes are the reference, see
`PALETTES` in `lib/sprites/maps.ts`.
