# FlexSoar — project handover

Paste this at the start of a new chat to pick up where we left off.

---

## What I'm building

**FlexSoar** — a marketplace where a physical sneaker becomes a tradeable
digital card. Solo founder, Malaysia, working on Windows, building with
parallel AI coding agents. Domain is `flexsoar.net`. Not deployed; still
localhost.

Each card is a 1:1 claim on one physical shoe. Cards trade on-platform and
burn back into physical delivery. A card is a claim, not a JPEG — burn-to-redeem
is what keeps it tethered to a real object.

**Supply is consignor-only.** I recruit Malaysian consignors directly, meet
them online or in person, and agree terms: roughly 5–10% commission per sale,
they keep the shoe at home, and they must not wear it once listed. This
replaced an earlier self-serve model where anonymous strangers listed their
own shoes — vetted counterparties under contract beat trust-by-collateral at
launch scale. **I have no consignors signed yet. That is the critical path,
not code.**

**Condition is categorical, not numeric.** The lister answers six weighted
questions; the system still computes a `numeric(4,3)` float internally and
still prices off it, but publishes only a CS2-style named grade — Factory New,
Minimal Wear, Field-Tested, Well-Worn, Battle-Scarred. Three decimals on a
seller's self-assessment is false precision and indefensible in a dispute. The
stored floats are the calibration set for building a real point system once
FlexSoar grades physical inventory.

**Redemption friction is deliberate.** The redeeming card holder pays shipping
at cost. MY→US/JP on a sneaker is $40–80 plus customs, which pushes behaviour
toward trading. Cost pass-through only — no artificial friction on top, or the
physical backing becomes decorative.

**Prices display in USD only.** No local-currency approximations; comparability
across the market matters more, because the whole product is people judging
whether a trade is fair.

---

## The money model — read this first, it drives everything

### The Stripe constraint

A Stripe **Malaysia** platform can only pay out to **Malaysian** connected
accounts, and is *not permitted to collect application fees* on non-Malaysian
ones. Cross-border payouts are only supported for platforms in the US, UK,
EEA, Canada, and Switzerland. Malaysia is not on that list.

So: anyone worldwide can **buy**. Only a Malaysian can be paid **cash**. That
is a corridor limitation, not a design choice, and no code changes it. It
resolves if I incorporate in the US/UK/SG, which is a later decision.

### FSC — earned, never bought

FSC is store credit at 1 FSC = 1 USD. **There is no top-up.** Nobody hands the
platform cash in advance. FSC is issued only to a seller whose country Stripe
cannot pay out to, against a completed card transfer.

This matters: an earlier design had users buying FSC with cash, which makes it
prepaid stored value, creates a pool of customer funds held in advance, and
produces top-up charges that are near-indefensible in a chargeback. Deleting
the top-up removes all three problems at once. `fn_purchase_credit` is now
revoked from every role including `service_role`, and the contract export and
webhook branch are deleted.

### Two independent axes

Buyer settlement and seller payout are **separate**:

|  | seller receives CASH (Malaysian) | seller receives FSC (everyone else) |
|---|---|---|
| **buyer pays CASH** | money passes through | pool grows, FSC issued |
| **buyer pays FSC** | pool drains, FSC burned | FSC changes hands |
| **buyer pays BOTH** | partial of the above | partial of the above |

All six cells are valid, handled by one function taking `p_credit_cents`.
Cash-only is a split with zero credit; FSC-only is a split with zero cash.
Treating these as one axis is what produced a guard that refused to sell any
non-Malaysian seller's listing to *anyone*.

### The identity that makes it safe

Per transaction, with price P, fee F, net N = P − F, buyer credit C, cash H:

```
platform currency = H - (N if seller takes cash else 0)
platform credit   = C - (N if seller takes FSC  else 0)
```

In every quadrant, **platform currency balance − FSC liability = the commission,
exactly**. That identity is what the sweep view is built on. Commission is
charged on every ownership transfer regardless of what either side settles in.

### Sweeps

Buyer cash and earned commission share one Stripe balance, and Stripe can't
partition a balance. So `fn_platform_position()` derives it:
`sweepable_cents` is commission earned, minus what's already swept, minus a
chargeback reserve (15% of liability, $500 floor), floored at zero. Two bank
accounts — the Stripe payout destination is the pool, the other is where I
spend from. A trigger refuses any sweep larger than unswept commission, so I
cannot spend the pool by accident. Sweeps are append-only.

**The pool is not revenue.** Cash held against outstanding FSC is not mine.

### FSC holds

FSC is **reserved** at checkout intent by the session client, not spent at
settlement, because settlement happens in the webhook minutes later and the
same FSC could be spent elsewhere in between. Spendable balance is
`fn_credit_available()` (balance minus active holds), never
`fn_credit_balance()`. Spending FSC requires either a session matching the
buyer or a hold created by one — which is also how the service-role settlement
path is stopped from spending anyone's FSC.

---

## Operating structure

Five directories. Four are agent workspaces; one is mine.

| Directory | Branch | Agent |
|---|---|---|
| `C:\Users\Family\flexsoar` | `main` | **me only** — merges, migrations, docs |
| `flexsoar-data` | `track/data` | contract, `lib/db/**`, auth, webhooks, scripts |
| `flexsoar-design` | `track/design` | design system, card components, sprites, `globals.css` |
| `flexsoar-admin` | `track/admin` | `app/admin/**` |
| `flexsoar-market` | `track/market` | `app/(market)/**` |

`AGENT_RULES.md` on main is binding and reaches the worktrees by rebase. It
was rewritten and then re-merged after the rewrite dropped several still-valid
rules — worth reading before writing agent prompts.

**The loop when an agent finishes:** read its output → check `git log
main..track/<name>` → merge → `npm i && npm test && npm run build` → reset each
worktree to main.

**Before any `git reset --hard main` on a worktree**, check `git log
main..track/<name> --oneline` is empty. Also check `git log track/<name>..main`
— non-empty there means the worktree is *behind*, which is silent and produces
work built against stale history.

**After every merge, confirm the test count went up.** "Tests pass" is not the
same signal as "the new tests are in there." An agent that finishes without
committing produces a merge that reports "Already up to date" and looks like
success.

**Schema changes are mine alone.** Claude writes the migration, I save it to
`supabase/migrations/`, run it in the Supabase SQL editor ("Run without RLS"),
and commit. Agents never touch `.sql`.

---

## Architecture invariants

- **Item ≠ Card.** Strictly 1:1.
- **Ledger is append-only** and is the source of truth for ownership. Each
  transaction nets to zero *within each asset class* — currency, credit, card
  checked separately.
- **Tier is value, condition is condition.** Tier from the SKU oracle price. A
  pristine cheap shoe is a mint-condition Common, never a Legendary.
  `is_exceptional` is a flag with a red border, not a tier.
- **No RNG anywhere.** No crates, no randomised trade-ups, no wagering —
  Malaysian gambling law (CGHA 1953, where *keeping* the venue is the offence).
- **Self-declared ≠ FlexSoar-graded.** `items.grade_source` records which. At
  launch effectively all inventory is self-declared, so this is load-bearing.
- **All writes go through `lib/api/contract.ts`.** Original 16 signatures
  frozen; additive exports allowed; only track/data writes it.
- **Authorisation lives in the SQL.** Admin functions call `fn_require_admin()`
  internally and run on the *session* client — service-role has no `auth.uid()`
  and gets refused.

---

## Stack

Next.js 16 (Turbopack, App Router) · Supabase (Postgres + auth, RLS on every
table) · Cloudflare R2 · Stripe (test mode) · Tailwind v4 (tokens in the
`@theme` block of `globals.css`; no `tailwind.config.ts`, ever) · vitest
(107 tests).

---

## Migrations 001–022, all applied and committed

001 schema · 002 core operations · 003 retier to USD cents · 004 RLS and grants
· 005 admin guards in SQL · 006 users RLS + `public_profiles` · 007 profile
updates · 008 grading write path + six rubric columns · 009 RLS sweep · 010 item
photos · 011 credit ledger + `platform_config` · 012 `art_url` + payout guard ·
013 seller custody, self-serve submission, default tracking · 014 fixes ·
015 SKU art guard · 016 credit ledger fix · 017 purchase-card idempotency

**018** condition grades — `condition_grade` enum, `condition_bands` table
(boundaries in data so they can be retuned), trigger-derived from `float_value`,
`show_numeric_float` flag.

**019a** ledger entry types (own file — `ALTER TYPE ADD VALUE` can't be used in
the same transaction).
**019b** payout routing — `cash_payout_countries`, `fn_payout_method_for_user`,
premium to 0, custody default to `seller`, top-up revoked from anon/authenticated.
**019c** unified settlement — one path taking `p_credit_cents`, replacing the
two mutually-exclusive cash and credit paths.

**020** platform earnings — `fn_platform_position`, `sweeps` with over-sweep
trigger, `fn_check_solvency`.

**021** credit holds — reservation, identity guard on the FSC leg, top-up
revoked from `service_role`, `fn_payout_method_for_user` made self-or-admin.

**022** dropped the pre-019c three-argument settlement overloads. Postgres
prefers an exact-arity match over default-filling, so those old bodies had been
silently serving every three-argument caller — including the webhook.

---

## Lessons that cost real time, keep them

- **Changing a Postgres function's arity creates an overload, not a
  replacement.** Any arity change must drop the previous arity in the same
  migration and assert the surviving count. Check periodically:
  `select proname, count(*) from pg_proc ... group by proname having count(*) > 1`
  should return zero rows.
- **`ALTER TYPE ... ADD VALUE`** can't be used by a statement in the same
  transaction. Enum additions get their own file.
- **An uncommitted agent branch merges as "Already up to date."** Watch the
  test count, not the merge output.
- A passing invariant over an empty table proves nothing.

---

## Where things actually stand

The **data layer is complete through 022** and merged to main. The **app layer
is not built against it.** Nothing calls `p_credit_cents`, nothing reserves
FSC, checkout is cash-only, and the UI still renders the numeric float.

**No purchase has ever executed through 019c or 021.** All 107 tests are
model-level checks against in-memory fixtures — correct, since agents must not
write to the live project, but they cannot prove the SQL runs. A `BEGIN ...
ROLLBACK` smoke script putting one purchase through each of the four quadrants
plus a hold-expiry case is the first real test this code will get, and it
hasn't been written.

---

## Open — technical

- **023 trades** — offer/counter/accept, four-entry card settlement, and a flat
  `trade_fee` charged to the side receiving the higher-valued card. Without it,
  trading generates no revenue and income decays to zero as the product
  succeeds. Fold in a self-or-admin guard on `fn_credit_available`,
  `fn_credit_held`, and `fn_credit_balance` — all are `security definer`, take
  a `uuid`, and are granted to `authenticated`, so any signed-in user can read
  anyone's FSC balance by calling the RPC directly.
- **track/market** — checkout calls `reserveCredit()` before creating the
  Stripe session and carries hold id + FSC amount through
  `payment_intent_data.metadata`; then a track/data pass switches the webhook to
  `purchaseCardSplit()`. Also the FSC-applied line at checkout (partial payment
  is close to mandatory — stranded credit is the most predictable source of
  resentment in this design) and the payout disclosure on the listing screen,
  which is where a non-Malaysian must learn how they'll be paid.
- **track/design** — grade badge replacing the float bar; render FSC as
  "465 FSC", never with a dollar sign.
- **track/admin** — sweep and solvency panel.
- **Stripe Connect is not built.** Money still routes through my account. Top
  blocker for real money.
- **Not deployed.** Netlify + `flexsoar.net` + production env + Supabase
  redirect URLs + R2 CORS. Webhook redelivery and CORS cannot be tested locally.
- `fn_refresh_levels` has no cron.
- `redemption_handling_fee_cents` is 1500 — far below real MY→US/JP shipping.
  Needs a quote step: quote and lock the cost *before* the burn, generate the
  label myself so I hold the tracking.
- `docs/GRADING_RUBRIC.md` still says 8 photos; the path is 4 photos and a
  3-option accessories question.
- `components/admin/db-writes.ts` — sanctioned contract bypass awaiting four
  exports.
- No per-user upload cap on R2.
- Nothing on `/` tells a visitor about consigning.
- `credit_purchase` survives as a dead enum tombstone (Postgres can't drop enum
  values). One test is still named for a credit-topup txn — rename it, or it
  reads as evidence the path is supported.

---

## Open — business, and mostly more urgent than the code

- **No consignors.** Recruit people already selling on Carousell / Instagram /
  Shopee — they have unsold inventory and FlexSoar is a free extra shelf. Lead
  with "the shoe never leaves your house." Be consignor zero with my own pairs
  so the site isn't empty.
- **Recruit boring, duplicated inventory.** Ten consignors with ten unique
  grails is a gallery, not a market. The metric is *SKUs with more than one
  card*.
- **Set a value floor.** MY→US shipping makes redemption irrational on a cheap
  shoe, which hollows out the physical backing.
- **Register a sole proprietorship, apply to Stripe Malaysia.** I've onboarded
  before with an IC number rather than an SSM number and it worked. Also email
  Stripe about the platform-collects-fees Connect preview (the platform-owns-
  liability config is in preview for Malaysian businesses) and Express account
  availability. Sole prop means unlimited personal liability — set a tripwire
  now for when total on-platform card value exceeds what I could personally
  cover, and incorporate then.
- **No lawyer.** Writing the FlexSoar–consignor agreement myself, covering
  liabilities and risks. Needs: no-wear clause, shipping SLA, who pays for loss
  in transit, whether a consignor can pull an unsold item (yes) versus one
  whose card has sold (no), what happens if they go dark. A contract deters and
  clarifies; it does not help against someone who disappears, since enforcement
  means suing over a RM2,000 shoe. The operational controls do the real work.
- **Proof of possession is event-triggered, not scheduled.** On listing, on
  first sale, on redemption request, plus low-frequency random spot-checks
  weighted to high-value items and new consignors. 7-day response window on
  spot-checks, 48 hours on redemption requests. A weekly photo of every pair
  would end the consignor relationship and catch nothing.
- **ToS not written** — title passes on purchase, consignor holds as bailee,
  ships within 7 days on demand, whether a re-grade can move a published
  category, the funds-holding window, and who bears loss if a consignor's house
  floods.

---

## How I want you to work with me

- Give me exact commands to paste. Windows `cmd`, Windows-style paths, one
  command per line when it might prompt. SQL migrations get a
  `copy "%USERPROFILE%\Downloads\NNN_name.sql" supabase\migrations\` line.
- SQL goes in the Supabase editor; migrations get downloaded to
  `supabase/migrations/` and committed.
- Write agent prompts as complete copy-paste blocks, and say which worktree.
- **Push back when something's wrong.** Real bugs here were caught because an
  agent refused an instruction rather than implementing around it: a
  silently-inverted query filter, a privilege-escalation path, a floating-point
  bug breaking 3% of grades, an auth guard that failed open on null, an error
  regex that never matched its raise, and a settlement guard that was correct
  under the old model and backwards under the new one. Every one passed `tsc`.
