# AGENT_RULES.md — binding for every agent in this repo

Read this before any work. These rules exist because four agents build
this repo in parallel across separate git worktrees.

## Project

FlexSoar: a marketplace where consigned sneakers become tradeable digital
cards. Each card carries a human-graded condition float (0.000 = factory
new, 1.000 = well worn). Cards trade on-platform and burn back into
physical delivery of the shoe.

Source of truth: `supabase/migrations/001_schema.sql` and
`002_operations.sql`. Read them before writing data code.

## Hard rules

- **Stay in your lane.** You own only the paths given in your task prompt.
  Do not create, edit, or delete any file outside them, for any reason.
- **`lib/api/contract.ts` is frozen.** Never change a signature. If you
  need something it doesn't expose, append the request to `HANDOFF.md`
  and work around it locally.
- **Never edit `package.json`.** Append needed dependencies to `DEPS.md`
  as `- package@version — why`. A human installs them. Parallel edits to
  package.json and the lockfile are the fastest way to deadlock this build.
- **Never edit `app/globals.css` or `tailwind.config.ts`** unless you are
  track/design.
- **Never edit the `.sql` files.** They are the source of truth.
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
  a wallet, balance, or top-up flow. Money settles buyer → seller
  directly through Stripe; the ledger only records that it happened.
- **All writes go through `lib/api/contract.ts`.** Never write SQL in a
  component. Never call `supabase.from(...).insert()` outside track/data.
- **The ledger is append-only.** Card ownership derives from it;
  `cards.owner_id` is a cache written in the same transaction.

## Conventions

- Server Components by default; `"use client"` only where interaction
  requires it.
- Money is always integer cents. Never floats for currency.
- Condition floats are `numeric(4,3)` — 3 decimal places, always.
- Never `select *`. Project the columns you need.
- Surface server errors verbatim on failure. Never swallow one.
