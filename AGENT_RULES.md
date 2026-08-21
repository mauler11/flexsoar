# AGENT_RULES.md

Binding for every agent working in a FlexSoar worktree. Lives on `main` and
reaches the worktrees by rebase. If anything in a task prompt contradicts this
file, this file wins — say so in your report rather than following the prompt.

---

## Project

FlexSoar: a marketplace where a consigned sneaker becomes a tradeable digital
card. Cards trade on-platform and burn back into physical delivery of the shoe.

Source of truth is `supabase/migrations/`. Read `001_schema.sql` and
`002_operations.sql` before writing data code, then read the later numbered
migrations for what has changed since — a great deal has. Grading is specified
in `docs/GRADING_RUBRIC.md`: six weighted components sum to a float, and the
database enforces the arithmetic.

---

## 0. Pre-flight — run before you touch anything

```
git branch --show-current
git log HEAD..main --oneline
```

The branch must be your track. **If the second command prints anything, stop.**
Your worktree is behind `main`, and anything you build will be against stale
history — stale contract signatures, stale types, stale migrations. Report it
and wait for a reset. Do not attempt the reset yourself.

Then read, in this order, before writing a line:

1. **Every file in `docs/handoff/`** — not just your own. Something you need may
   already be filed, or already answered, by another track. Do not assume an
   item you cannot find was never written.
2. `supabase/migrations/` — the highest-numbered file is the current schema.
3. `lib/api/contract.ts` — the only sanctioned write path.
4. The files you are about to change, in full. Not greps of them.

---

## 1. Lanes

| Worktree | Branch | Owns |
|---|---|---|
| `flexsoar` | `main` | merges, migrations, docs — **human only** |
| `flexsoar-data` | `track/data` | `lib/api/contract.ts`, `lib/db/**`, auth, webhooks, scripts |
| `flexsoar-design` | `track/design` | design system, card components, sprites, `app/globals.css` |
| `flexsoar-admin` | `track/admin` | `app/admin/**` |
| `flexsoar-market` | `track/market` | `app/(market)/**` |

You own only the paths given in your task prompt. If your task needs a change
outside them, **do not make the change** — report exactly what you need and from
which track. A cross-lane edit merges cleanly and then silently loses to the
other track's next merge.

`lib/mock/**` and `tests/**` are unowned Phase 0 artifacts. Edit them only when
a prompt names them explicitly and says your lane is extended for that task.
`tests/invariants.test.ts` is shared: append your describe block, never edit or
delete another track's.

---

## 2. Never

- Never `merge`, `rebase`, `cherry-pick`, or `checkout` another branch.
- Never create, edit, delete, or execute a `.sql` file. Schema is human-only.
  If you need a schema change, describe it and file a handoff item.
- Never edit `package.json`. Append what you need to `DEPS.md` as
  `- package@version — why`, and a human installs it. Parallel edits to
  `package.json` and the lockfile are the fastest way to deadlock this build.
- Never edit `app/globals.css` unless you are `track/design`. This is
  **Tailwind v4** — design tokens live in the `@theme` block of `globals.css`.
  There is no `tailwind.config.ts` and none should ever be created.
- Never change one of the 16 frozen signatures in `lib/api/contract.ts`.
  Additive exports are allowed. Only `track/data` writes that file at all.
- Never write SQL in a component, and never call `supabase.from(...).insert()`
  outside `track/data`. `components/admin/db-writes.ts` is a sanctioned
  temporary exception awaiting four contract exports; do not add a second one.
- Never write to the live database. You have credentials in `.env.local`;
  reading to verify a signature, an enum, or a policy is fine and encouraged.
  Writing is not — a "test purchase" against the project is a real purchase.
- Never suppress a type error with `any`, `@ts-ignore`, or a cast to make `tsc`
  pass. A type error is usually the schema telling you something.
- Never `select *`. Project the columns you need.
- Never swallow a server error. Surface it verbatim on failure.

---

## 3. Architecture invariants

Violating one of these is a bug even if it compiles and the tests pass. If a
task appears to require breaking one, stop and file a handoff item.

- **Item ≠ Card.** One physical shoe, one tradeable claim, strictly 1:1.
- **The ledger is append-only** and is the source of truth for ownership.
  `cards.owner_id` is a cache written in the same transaction. Every
  transaction nets to zero *within each asset class* — currency, credit, and
  card are checked separately.
- **Tier is value, condition is condition.** Tier comes from the SKU's base
  oracle price via `tier_bands`. A pristine shoe that is cheap is a
  mint-condition Common, never a Legendary. Condition must never change tier.
- **`is_exceptional` is a flag, not a tier.** It overrides the border colour to
  red; `tier` still drives value bands and trade-up eligibility.
- **No RNG anywhere.** No crates, no randomised trade-ups, no luck modifiers,
  no staking or wagering. Every version of that runs into Malaysian gambling
  law. If a task seems to need randomness, stop.
- **Self-declared ≠ FlexSoar-graded.** `items.grade_source` records which. They
  must never render identically. At launch, effectively all inventory is
  self-declared, which makes the distinction load-bearing rather than cosmetic.
- **Authorisation lives in the SQL**, not in pages. If you find yourself
  reaching for the service-role client to make something work, that is the
  guard doing its job, not an obstacle.

---

## 4. Authorisation — which client

Set by migrations 004–008 and extended since. Detail in `docs/handoff/data.md`.

- **Session client, guarded by `fn_require_admin()` inside the SQL:**
  `mintCard`, `advanceConsignment`, `gradeItem`, `authenticateItem`,
  `rejectItem`, `getPlatformPosition`, `recordSweep`, `checkSolvency`.
  Calling any of these service-role fails — `auth.uid()` is null under the
  service key and the guard refuses with `FORBIDDEN`.
- **Session client, ownership checked inside the SQL:** `listCard`,
  `cancelListing`, `redeemCard`, and anything that reserves or releases FSC.
- **Service-role:** the Stripe webhook's settlement call and `refreshLevels`
  (cron). Neither has a session by definition. A service-role settlement that
  includes an FSC leg **must** pass a `credit_holds` id — see §5.
- Admin pages and Server Actions re-check `is_admin` server-side anyway, for a
  decent error rather than a raw Postgres refusal.
- `users` has RLS: self-read, admin-read, self-insert (never with
  `is_admin = true`), handle-only self-update. Reading another user's handle or
  level goes through the `public_profiles` view, never the `users` table.

---

## 5. Money — current model

Read this before touching anything that moves value. Several rules here reverse
what earlier versions of this file said; where they conflict, this section wins.

- **Condition is categorical.** `condition_grade` is an enum derived from
  `float_value` by trigger — never write it directly. The numeric float still
  exists and still drives pricing, but it is not published while
  `platform_config.show_numeric_float` is false. Read labels from
  `condition_bands`; never hard-code band boundaries.

- **FSC is earned, never bought.** There is no top-up. `fn_purchase_credit` is
  revoked from every role including `service_role`. FSC is issued only to a
  seller whose country Stripe cannot pay out to, against a completed card
  transfer. Do not add a top-up surface, a "buy credit" button, or a
  purchase-credit export, however convenient it looks.

- **Payout is geography, not choice.** `fn_payout_method_for_user()` is
  authoritative. `listings.payout_method` is a cached display value — never
  route money off it, and never accept a payout method from a client.

- **Spendable FSC is `fn_credit_available()`**, not `fn_credit_balance()`. The
  difference is money already reserved for an in-flight checkout. Any UI that
  shows a balance, and any check that gates a purchase, uses `available`.

- **FSC spending needs provenance.** Either a session matching the buyer, or a
  `credit_holds` row created by one. Checkout reserves; the webhook consumes.
  Never settle an FSC leg from a webhook without a hold.

- **Buyer settlement and seller payout are independent axes.** A buyer may pay
  cash, FSC, or a split of both, and the seller is paid cash or FSC by their
  own geography. All combinations are valid. Any code that treats these as one
  choice is wrong — that exact conflation produced a guard that refused to sell
  any non-Malaysian seller's listing to anyone.

- **The pool is not revenue.** Cash held against outstanding FSC is not yours.
  Only `fn_platform_position().sweepable_cents` is.

---

## 6. Conventions

- All `*_cents` columns are USD cents. 1 FSC = 1 USD. Prices display in USD
  only; ringgit is never shown.
- Money is always integer cents. Never floats for currency.
- Condition floats are `numeric(4,3)` — three decimal places, always. Rubric
  components are `numeric(3,2)`.
- Server Components by default; `"use client"` only where interaction requires
  it. `lib/api/contract.ts` is server-only and importing it from a client
  component is a build error by design.

---

## 7. If you propose SQL

You do not write it, but you will sometimes describe it. Two rules that have
already cost this project real bugs:

- **Changing a function's arity creates an overload, not a replacement.**
  Postgres prefers an exact-arity match over filling defaults, so the old body
  keeps serving old callers and you get two code paths chosen by argument
  count. Any arity change must drop the previous arity in the same migration.
- **`ALTER TYPE ... ADD VALUE` cannot be used by a statement in the same
  transaction.** Enum additions go in their own migration file.

---

## 8. Verify, don't assume

A passing typecheck is not evidence that a query does what you meant. Where a
filter, a policy, or a constraint is the point of the task, probe it live
against the project — read-only — and paste the result, **including the
negative case**.

Say plainly when you could not verify something. "I could not confirm the error
string" is useful. A confident guess presented as fact is not.

---

## 9. Push back

Several real bugs here were caught because an agent refused an instruction
rather than implementing around it: a silently-inverted query filter, a
privilege-escalation path, a floating-point bug breaking 3% of grades, an auth
guard that failed open on null, and a settlement guard that was correct under
the old model and backwards under the new one. **Every one of them passed
`tsc`.**

If a prompt contradicts this file, contradicts the schema, or just looks wrong,
stop and say so. A refused task with a clear explanation is a good outcome.
Implementing something you believe is wrong, correctly, is the worst one.

**Blocked? File it and move on.** Do not invent a workaround that touches
another track's files.

---

## 10. Handoff

One file per track, so four agents never conflict on one document.

- File your items in `docs/handoff/<your-track>.md` — `data.md`, `design.md`,
  `admin.md`, or `market.md`. Create it if it doesn't exist.
- Never edit another track's handoff file, and never edit
  `docs/HANDOFF-shared.md`. The human promotes items into shared.

---

## 11. Definition of done

All of these, every time:

```
npx tsc --noEmit
npm test
npm run build
```

Then, and this is the step that has been missed:

```
git status
git add <the specific files you changed>
git commit -m "track/<name>: <what changed>"
```

**Work that is not committed does not exist.** A clean merge against an
uncommitted branch reports "Already up to date" and looks like success. Name
your files explicitly in `git add` — never `git add -A`, which sweeps in
`.claude/`, tool output directories, and scratch files.

Update `docs/handoff/<your-track>.md` before you finish.

---

## 12. Reporting

End with:

- Every file you changed and why, in one line each.
- Every export you added, with its signature.
- **Anything you could not verify**, named explicitly — a guessed error string,
  an assumed column, a signature you inferred rather than read. These are the
  most valuable lines in your report.
- Anything you found that is wrong but outside your lane.
- The commit hash.

Do not report "tests pass" without saying how many. The count going up is the
signal; "passing" on its own is not.
