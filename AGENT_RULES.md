# AGENT_RULES.md

Binding for every agent working in a FlexSoar worktree. Lives on `main` and
reaches the worktrees by rebase. If anything in a task prompt contradicts this
file, this file wins — say so in your report rather than following the prompt.

---

## 0. Pre-flight — run before you touch anything

```
git branch --show-current
git log HEAD..main --oneline
```

The branch must be your track. **If the second command prints anything, stop.**
Your worktree is behind `main` and anything you build will be against stale
history — stale contract signatures, stale types, stale migrations. Report it
and wait for a reset. Do not attempt the reset yourself.

Then read, in this order, before writing a line:

1. `docs/handoff/<your-track>.md` — what the last agent on this track left.
2. `supabase/migrations/` — the highest-numbered file is the current schema.
   The database is ahead of nothing; if the repo ends at NNN, the schema is NNN.
3. `lib/api/contract.ts` — the only sanctioned write path.
4. The files you are about to change, in full. Not greps of them.

---

## 1. Lanes

| Worktree | Branch | Owns |
|---|---|---|
| `flexsoar` | `main` | merges, migrations, docs — **human only** |
| `flexsoar-data` | `track/data` | `lib/api/contract.ts`, `lib/db/**`, auth, webhooks, scripts |
| `flexsoar-design` | `track/design` | design system, card components, sprites |
| `flexsoar-admin` | `track/admin` | `app/admin/**` |
| `flexsoar-market` | `track/market` | `app/(market)/**` |

Stay in your lane. If your task needs a change outside it, **do not make the
change** — report exactly what you need and from which track. A cross-lane edit
merges cleanly and then silently loses to the other track's next merge.

`tests/invariants.test.ts` is shared. Append your describe block; never edit or
delete another track's.

---

## 2. Never

- Never `merge`, `rebase`, `cherry-pick`, or `checkout` another branch.
- Never create, edit, delete, or execute a `.sql` file. Schema is human-only.
  If you need a schema change, describe it and stop.
- Never write to the live database. You have credentials in `.env.local`;
  reading to verify a signature or an enum is fine and encouraged, writing is
  not. A "test purchase" against production is a real purchase.
- Never change one of the 16 frozen signatures in `lib/api/contract.ts`.
  Additive exports are allowed. Only `track/data` writes that file at all.
- Never bypass the contract. `components/admin/db-writes.ts` is a sanctioned
  temporary exception awaiting four contract exports; do not add a second one.
- Never suppress a type error with `any`, `@ts-ignore`, or a cast to make
  `tsc` pass. A type error is usually the schema telling you something.

---

## 3. Architecture invariants

Violating one of these is a bug even if it compiles and the tests pass.

- **Item ≠ Card.** One physical shoe, one tradeable claim, strictly 1:1.
- **The ledger is append-only** and is the source of truth for ownership.
  Every transaction nets to zero *within each asset class* — currency, credit,
  and card are checked separately.
- **Tier is value, condition is condition.** Tier comes from the SKU's oracle
  price. A pristine shoe that is cheap is a mint-condition Common, never a
  Legendary. `is_exceptional` is a flag with a red border, not a tier.
- **No RNG anywhere.** No crates, no randomised trade-ups, no wagering. Every
  version of that runs into Malaysian gambling law.
- **Self-declared ≠ FlexSoar-graded.** `items.grade_source` records which.
  They must never render identically.
- **Authorisation lives in the SQL**, not in pages. Admin functions call
  `fn_require_admin()` internally and must run on the *session* client —
  service-role has no `auth.uid()` and will be refused. If you find yourself
  reaching for the service-role client to make something work, that is the
  guard doing its job, not an obstacle.

---

## 4. Money — current model

Read this before touching anything that moves value.

- **Condition is categorical.** `condition_grade` is an enum derived from
  `float_value` by trigger — never write it directly. The numeric float still
  exists and still drives pricing, but it is not published while
  `platform_config.show_numeric_float` is false. Read labels from
  `condition_bands`; do not hard-code band boundaries.

- **FSC is earned, never bought.** There is no top-up. `fn_purchase_credit` is
  revoked from every role, including `service_role`. FSC is issued only to a
  seller whose country Stripe cannot pay out to, against a completed card
  transfer. Do not add a top-up surface, a "buy credit" button, or a
  purchase-credit export, however convenient it looks.

- **Payout is geography, not choice.** `fn_payout_method_for_user()` is
  authoritative. `listings.payout_method` is a cached display value — never
  route money off it, and never accept a payout method from a client.

- **Spendable FSC is `fn_credit_available()`**, not `fn_credit_balance()`.
  The difference is money already reserved for an in-flight checkout. Any UI
  that shows a balance or any check that gates a purchase uses `available`.

- **FSC spending needs provenance.** Either a session matching the buyer, or a
  `credit_holds` row created by one. Checkout reserves, the webhook consumes.
  Never settle FSC straight from a webhook without a hold.

- **The pool is not revenue.** Cash held against outstanding FSC is not yours.
  Only `fn_platform_position().sweepable_cents` is.

---

## 5. If you propose SQL

You do not write it, but you will sometimes describe it. Two rules that have
already cost this project real bugs:

- **Changing a function's arity creates an overload, not a replacement.**
  Postgres prefers an exact-arity match over filling defaults, so the old body
  keeps serving old callers and you get two settlement paths chosen by argument
  count. Any arity change must drop the previous arity in the same migration.
- **`ALTER TYPE ... ADD VALUE` cannot be used by a statement in the same
  transaction.** Enum additions go in their own migration file.

---

## 6. Push back

Several real bugs here were caught because an agent refused an instruction
rather than implementing around it: a silently-inverted query filter, a
privilege-escalation path, a floating-point bug breaking 3% of grades, an auth
guard that failed open on null, and a settlement guard that was correct under
the old model and backwards under the new one. **Every one of them passed
`tsc`.**

So: if a prompt asks for something that contradicts this file, contradicts the
schema, or just looks wrong — stop and say so. A refused task with a clear
explanation is a good outcome. Implementing something you believe is wrong,
correctly, is the worst one.

Say plainly when you are unsure. "I could not verify X" is useful. A confident
guess presented as fact is not.

---

## 7. Definition of done

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

Update `docs/handoff/<your-track>.md` with anything the next agent needs.

---

## 8. Reporting

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
