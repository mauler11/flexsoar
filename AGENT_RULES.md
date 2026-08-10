# AGENT_RULES.md — binding for every agent in this repo

Read this before any work. These rules exist because several agents build
this repo in parallel across separate git worktrees.

## Project

FlexSoar: a marketplace where consigned sneakers become tradeable digital
cards. Each card carries a human-graded condition float (0.000 = factory
new, 1.000 = well worn). Cards trade on-platform and burn back into
physical delivery of the shoe.

Source of truth: `supabase/migrations/`. Read `001_schema.sql` and
`002_operations.sql` before writing data code, and check the later
numbered migrations for what has changed since.

## Hard rules

- **Stay in your lane.** You own only the paths given in your task prompt.
  Do not create, edit, or delete any file outside them, for any reason.
- **`lib/api/contract.ts`: the original 16 signatures are frozen.** They
  never change. Additive exports ARE allowed, and only track/data writes
  this file. If you need something it doesn't expose, append the request
  to `HANDOFF.md`.
- **Never edit `package.json`.** Append needed dependencies to `DEPS.md`
  as `- package@version — why`. A human installs them. Parallel edits to
  package.json and the lockfile are the fastest way to deadlock this build.
- **Never edit `app/globals.css` or `tailwind.config.ts`** unless you are
  track/design. (Tailwind v4 — design tokens live in the `@theme` block of
  globals.css. There is no tailwind.config.ts and none should be created.)
- **Never edit the `.sql` files.** They are the source of truth. Schema
  changes are made by the human as a new numbered migration, never by a
  track agent. If you need one, write the request to `HANDOFF.md`.
- **`lib/mock/**` and `tests/**` are unowned.** Phase 0 artifacts. Edit
  them only when a prompt names them explicitly and says your lane is
  extended for that task.
- **Your branch only.** Do not merge, rebase, or switch branches.
- **Blocked? Write it to `HANDOFF.md` and move on.** Do not invent a
  workaround that touches another track's files.

## Domain invariants

Assume these. Never work around them. If a task appears to require
breaking one, stop and write it to `HANDOFF.md`.

- **Tier is value. Float is condition.** Tier comes from the SKU's base
  oracle price via `tier_bands`. A pristine float on a cheap shoe is a
  mint-condition Common, never a Legendary. Float must never change tier.
- **`is_exceptional` is a flag, not a tier.** It overrides the border
  colour to red; `tier` still drives value bands and trade-up eligibility.
- **Float is human-graded at intake and immutable after mint.** There is
  no RNG anywhere in this codebase. No crates, no randomised outcomes, no
  luck modifiers, no staking or wagering features. If a task seems to
  need randomness, stop.
- **No user balances.** FSC is a display unit: 1 FSC = 1 USD. Never build
  a wallet, balance, or top-up flow. Money settles buyer to seller
  directly through Stripe; the ledger only records that it happened.
- **All writes go through `lib/api/contract.ts`.** Never write SQL in a
  component. Never call `supabase.from(...).insert()` outside track/data.
- **The ledger is append-only.** Card ownership derives from it;
  `cards.owner_id` is a cache written in the same transaction.

## Authorisation

Set by migrations 004-007. Full detail in `HANDOFF.md` item 11.

- `mintCard` and `advanceConsignment` run on the **session** client.
  `fn_require_admin()` enforces `is_admin` inside the transaction and
  returns `FORBIDDEN` otherwise. Calling them service-role fails —
  `auth.uid()` is null under the service key.
- `purchaseCard` and `refreshLevels` run **service-role**. Neither has a
  session by definition (webhook, cron).
- `listCard`, `cancelListing` and `redeemCard` run on the session client
  and check ownership themselves.
- Admin pages and Server Actions re-check `is_admin` server-side anyway,
  for a decent error rather than a raw Postgres refusal.
- `users` has RLS: self-read, admin-read, self-insert (never with
  `is_admin = true`), and handle-only self-update. Reading another
  user's handle or level goes through the `public_profiles` view, never
  the `users` table.

## Conventions

- All `*_cents` columns are USD cents. 1 FSC = 1 USD. Ringgit is display
  only.
- Money is always integer cents. Never floats for currency.
- Condition floats are `numeric(4,3)` — 3 decimal places, always.
- Server Components by default; `"use client"` only where interaction
  requires it. `lib/api/contract.ts` is server-only and importing it from
  a client component is a build error by design.
- Never `select *`. Project the columns you need.
- Surface server errors verbatim on failure. Never swallow one.
- Run `npm test` and `tsc --noEmit` before every commit.
