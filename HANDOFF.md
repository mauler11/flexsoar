# FlexSoar — project handover

Paste this at the start of a new chat to pick up where we left off.
Supersedes the previous handover (Aug 2026). Current as of **2026-08-25**.

---

## What I'm building

**FlexSoar** — a marketplace where a physical sneaker becomes a tradeable
digital card. Solo founder, Malaysia, Windows, building with parallel AI coding
agents. Domain is `flexsoar.net`. **Not deployed yet**; still localhost, but the
whole V1 code path is built and verified.

Each card is a 1:1 claim on one physical shoe. Cards trade on-platform and burn
back into physical delivery. A card is a claim, not a JPEG — burn-to-redeem is
what keeps it tethered to a real object.

**Prices display in USD only.** No local-currency approximations; comparability
across the market matters more than familiarity.

---

## The custody model — this changed, read it carefully

Supply used to be "consignor keeps the shoe at home forever." It is now
**vault-on-first-sale**, and any Malaysian can become a consignor after KYC
rather than being individually recruited:

1. Consignor lists a shoe that is at their house.
2. Buyer A buys it. **Digital ownership transfers immediately, but the card is
   frozen** (`card_status = 'pending_vault'`).
3. The consignor is contractually obliged to ship the physical shoe to my
   central location **within 48 hours**.
4. I receive it, verify it, box it with a QR/barcode. Item goes to
   `custody = 'warehouse'`, card goes `active`. Now it can be resold and traded
   indefinitely.
5. Final holder redeems; I ship from my own storage.
6. **If the consignor doesn't ship**: cancel, refund buyer A in full and in
   kind, burn the card, ban the consignor, pull their other live listings.

Why: without the freeze, a card changes hands a hundred times while the shoe
sits in a stranger's house, so every holder after the first trusts someone they
never dealt with. Freezing bounds that trust to one 48-hour window with one
KYC'd person.

Consequences I've accepted: the pitch is no longer "the shoe never leaves your
house" (it's "it stays with you until it sells"); I pay inbound MY-domestic
shipping on every first sale; I'm a bailee for buyers, not a broker between
users; storage becomes a real constraint at volume.

**Load-bearing detail:** `payout_hold_days` is 7 and the vault window is 48h, so
a cancellation always lands while the consignor's cash is still held — nothing
is ever clawed back. Shortening the payout hold below the vault window breaks
the unwind silently.

**Redemption friction is deliberate.** The redeeming holder pays shipping at
cost (MY→US/JP is $40–80 plus customs), which pushes behaviour toward trading.
Cost pass-through only.

---

## The money model — read this before touching anything financial

### The Stripe constraint

A Stripe **Malaysia** platform can only pay out to **Malaysian** connected
accounts and cannot collect application fees on non-Malaysian ones. Cross-border
payouts are only supported for platforms in the US, UK, EEA, Canada and
Switzerland. Malaysia is not on that list.

So: anyone worldwide can **buy**. Only a Malaysian can be paid **cash**. That's a
corridor limitation, not a design choice. It resolves only by incorporating in
US/UK/SG — a later decision.

### FSC — earned, never bought

FSC is store credit at 1 FSC = 1 USD. **There is no top-up.** FSC is issued only
to a seller whose country Stripe cannot pay out to, against a completed card
transfer. An earlier design had users buying FSC with cash — that made it
prepaid stored value, created a pool of customer funds held in advance, and
produced chargeback-indefensible top-up charges. `fn_purchase_credit` is revoked
from every role including `service_role`.

### Two independent axes

Buyer settlement and seller payout are **separate**:

|  | seller receives CASH (Malaysian) | seller receives FSC (everyone else) |
|---|---|---|
| **buyer pays CASH** | money passes through | pool grows, FSC issued |
| **buyer pays FSC** | pool drains, FSC burned | FSC changes hands |
| **buyer pays BOTH** | partial of the above | partial of the above |

All six cells valid, one function taking `p_credit_cents`. Treating these as one
axis is what once produced a guard that refused to sell any non-Malaysian
seller's listing to anyone.

### The identity that makes it safe

Per transaction with price P, fee F, net N = P − F, buyer credit C, cash H:

```
platform currency = H - (N if seller takes cash else 0)
platform credit   = C - (N if seller takes FSC  else 0)
```

In every quadrant, **platform currency balance − FSC liability = the commission,
exactly**. Verified live across 10 purchases, 2 trades and 2 unwinds.

### Sweeps

`fn_platform_position()` derives `sweepable_cents` = commission earned − already
swept − chargeback reserve (`sweep_reserve_bps` 1500, `sweep_reserve_min_cents`
50000), floored at zero. `earned_gross_cents` is `currency − liability` — the
identity itself, **not** a fee subtotal. A trigger refuses any sweep larger than
unswept commission. Sweeps are append-only. **The pool is not revenue.**

### FSC holds

FSC is **reserved** at checkout intent by the session client, not spent at
settlement (settlement happens in the webhook minutes later). Spendable balance
is `fn_credit_available()` (balance minus active holds), never
`fn_credit_balance()`. Spending FSC requires a session matching the buyer **or a
hold created by one** — that hold is what makes the service-role settlement path
safe, not the session.

---

## Where things actually stand

**The data layer is complete through 026b and verified against live SQL.**
**The app layer is built against it and works end to end in a browser.**

- 172 tests passing (`npm test`), `npm run build` clean
- `scripts/smoke_settlement.sql` — 14 sections, all passing: six settlement
  quadrants, idempotency replay, V1–V4 vault custody and unwind, T1–T4 trades,
  solvency and sweep ceiling
- Signup, listing, submission, dashboard all exercised in a real browser
- Market grid renders correctly signed out

**Not done:** Stripe Connect (money still routes through my personal account),
deployment, and consignors.

---

## Operating structure

Five directories. Four are agent workspaces; one is mine.

| Directory | Branch | Agent scope |
|---|---|---|
| `C:\Users\Family\flexsoar` | `main` | **me only** — merges, migrations, docs |
| `flexsoar-data` | `track/data` | contract, `lib/db/**`, auth, webhooks, scripts |
| `flexsoar-design` | `track/design` | design system, card components, sprites, `globals.css` |
| `flexsoar-admin` | `track/admin` | `app/admin/**` |
| `flexsoar-market` | `track/market` | `app/(market)/**` |

`AGENT_RULES.md` on main is binding and reaches the worktrees by rebase.

### Two scripts on main — use these

**`merge-track.bat <data|design|admin|market>`** — shows incoming commits, then
merges, then `npm i && npm test && npm run build`. The `&&` chain stops at the
first failure.

**`reset-worktrees.bat`** — lists any unmerged commits per worktree, warns,
pauses, then resets all four to main. **Ctrl+C at the pause if anything
printed.** Run this after every merge.

### Hard-won rules

- **Check `git log main..track/<name>` before any reset.** A blanket reset once
  destroyed an unmerged commit (`39f0efa`, the first `setCountry` work) that had
  to be rebuilt from scratch. The check exists for exactly this.
- **After every merge, confirm the test count went up.** An agent that finishes
  without committing produces "Already up to date," which looks like success.
- **Two agents appending `describe` blocks to `tests/invariants.test.ts` conflict
  every time.** The conflict cuts mid-block, so deleting the marker lines alone
  leaves unbalanced braces.
- **`git commit` does not read your files.** A conflict-markered file committed
  clean three times before `npm test` caught it. Test before committing.
- Windows `copy a + b` in text mode inserts a `0x1A` EOF byte between files.
  Use `/b`.
- Schema changes are mine alone: Claude writes the migration, I run it in the
  Supabase SQL editor ("Run without RLS"), save to `supabase/migrations/`, and
  commit. **Agents never touch `.sql`.**

---

## Architecture invariants

- **Item ≠ Card.** Strictly 1:1.
- **Ledger is append-only** and is the source of truth for ownership. Each
  transaction nets to zero *within each asset class* — currency, credit, card
  checked separately. `ledger_no_update` blocks updates and deletes; corrections
  are new offsetting transactions.
- **Tier is value, condition is condition.** Tier from `skus.market_price_cents`.
  A pristine cheap shoe is a mint Common, never a Legendary. `is_exceptional` is
  a flag with a red border, not a tier.
- **No RNG anywhere.** No crates, no randomised trade-ups, no wagering —
  Malaysian gambling law (CGHA 1953, where *keeping* the venue is the offence).
- **Self-declared ≠ FlexSoar-graded.** `items.grade_source` records which.
- **All writes go through `lib/api/contract.ts`.** Original 16 signatures frozen;
  additive exports allowed; only track/data writes it.
- **Authorisation lives in the SQL.** Admin functions call `fn_require_admin()`
  internally and run on the *session* client.
- **A user id in a function signature is a CLAIM, not a fact.** Anything taking
  one and comparing it to a row needs `fn_require_actor()`. This came from a real
  vulnerability (see 026).
- **Guarded readers are the public surface; unguarded ones are internal and must
  never be granted to any role.** Granting `fn_credit_available_unchecked` to
  anything undoes 022b.

---

## Stack

Next.js 16 (Turbopack, App Router) · Supabase (Postgres + auth, RLS on every
table) · Cloudflare R2 · Stripe **test mode** · Tailwind v4 (tokens in the
`@theme` block of `globals.css`; **no `tailwind.config.ts`, ever**) · vitest
(172 tests) · **deploying to Vercel** (changed from Netlify — first-party Next 16
support, Server Actions with no adapter).

---

## Migrations — all applied, committed and verified

001–017 schema, operations, RLS, admin guards, grading, credit ledger, seller
custody, SKU art guard, purchase idempotency.

**018** condition grades — `condition_grade` enum, `condition_bands` table,
trigger-derived from `float_value`, `show_numeric_float` flag.

**019a** ledger entry types (own file — `ALTER TYPE ADD VALUE` can't be used in
the same transaction).
**019b** payout routing — `cash_payout_countries`, `fn_payout_method_for_user`,
credit premium to 0, custody default `seller`.
**019c** unified settlement — one path taking `p_credit_cents`.

**020** platform earnings — `fn_platform_position`, `sweeps`, `fn_check_solvency`.

**021** credit holds — reservation, identity guard on the FSC leg.

**022** dropped the pre-019c three-argument settlement overloads. Postgres prefers
exact-arity over default-filling, so those old bodies had been silently serving
every three-argument caller including the webhook.

**022b** permissions lockdown — `fn_require_self_or_admin(uuid)` keyed on the JWT
role claim (**not** `current_user`, which is already the owner inside a
`security definer` body), guards on `fn_credit_available`/`fn_credit_held`,
dropped `fn_purchase_card_with_credit`, revoked default PUBLIC grants.

**022c** fixed 022b — `current_setting('request.jwt.claims', true)` returns NULL
when never set but an **empty string** when cleared, and `''::jsonb` raises
22P02. Uses `nullif`, and **fails closed** on unparseable claims (absent passes,
garbage is refused).

**023a** `card_status.pending_vault`.
**023b** `sale_reversal_gross/fee/net`, `vault_default_burn`.
**023c** vault state machine — `vault_intakes` table with the 48h clock, an
AFTER INSERT trigger on `orders` opening an intake on first sale, a **BEFORE
UPDATE trigger on `cards`** forcing `pending_vault`, plus `fn_vault_mark_shipped`
/ `fn_vault_receive` / `fn_vault_mark_defaulted` / `fn_confirm_sale_cancellation`
and the long-missing card-leg constraint trigger.

**024a** `trade_credit_gross`, `trade_credit_net`.
**024b** trades — `trade_offers` with terms **locked at offer time**,
`fn_trade_quote`, create/accept/resolve/expire, `credit_holds` extended to hold
against an offer as well as a listing.
**024c** `fn_credit_available_unchecked` — the accept path runs as the recipient
but must read the payer's balance, which the 022b guard refused.
**024d/024e** pinned every ledger entry type to exactly one asset class
(`ledger_asset_type_partition`), replacing the old `ledger_credit_closed_loop`
biconditional.
**024f** the webhook could not release an abandoned hold — 022b had revoked it
from `service_role` *and* the body compared against `fn_current_user_id()`.

**025** `fn_set_country(text)` self-service, and `fn_payout_method_for_user` now
**raises** on a null/blank country instead of defaulting to `'credit'`.

**026** caller-identity fix + anon revoke (see below).
**026b** restored grants 026 over-revoked (see below).

---

## Two incidents worth carrying forward

### 026 — functions trusted a caller-supplied identity

`fn_redeem_card(p_card_id, p_user_id, ...)`, `fn_list_card(p_card_id,
p_seller_id, ...)` and `fn_cancel_listing(p_listing_id, p_actor)` each compared a
row's owner against **an argument the caller chose**. Pass the real owner's id
and the check passes. All three are `security definer`.

Worst case: **any signed-in user could burn someone else's card and create a
redemption carrying their own shipping address** — a physical shoe redirected to
an attacker, handling fee charged to the victim.

Fixed with `fn_require_actor(uuid)`, plus a revoke of PUBLIC/anon across every
`fn_*` and of trigger functions from `authenticated`.

### 026b — the revoke broke the signed-out site

026's blanket revoke removed EXECUTE from helpers that **RLS policies** call. A
policy expression is evaluated *as the querying role*, so
`using (owner_id = fn_current_user_id())` needs anon to hold EXECUTE on that
function. The signed-out home page 500'd with `permission denied for function
fn_current_user_id`.

**Why nothing caught it:** `smoke_settlement.sql` runs as `postgres` and
impersonates authenticated users. **Nothing ever loads a page as anon.** 026b
adds a self-maintaining sweep that grants any policy-referenced `fn_*` and
asserts none is missing.

**Checklist before any future grant change:**
1. run `scripts/smoke_settlement.sql`
2. load `/` signed out, in a private window
3. load `/card/<id>` signed out

Step 1 alone would have shipped this bug.

---

## Lessons that cost real time

- **Changing a Postgres function's arity creates an overload, not a
  replacement.** Any arity change must drop the previous arity in the same
  migration and assert the surviving count. Periodic check:
  `select proname, count(*) from pg_proc ... group by proname having count(*) > 1`
  should return zero rows.
- **`ALTER TYPE ... ADD VALUE`** can't be used by a statement in the same
  transaction. Enum additions get their own file.
- **An entry type is not a revenue column.** `sale_fee` is used for the
  platform's currency leg even when that leg is a pool *outflow* — it once summed
  to 36800 against real commission of 12240. Commission is only recoverable as
  platform currency minus liability.
- **`orders.fee_cents` records the nominal fee, not realised commission.** A
  historical credit-payout sale booked 1440 while the platform actually kept 540,
  because of the old 500bps payout premium.
- **Any ledger measurement taken inside a `set_config('role','authenticated')`
  block is RLS-filtered** and is not comparable to one taken outside it.
  Comparing across the boundary made untouched money look like it had moved.
- **A partial unique index with a nullable column silently stops working.**
  `credit_holds_active_uidx` was UNIQUE on `(user_id, listing_id)`; making
  `listing_id` nullable for trade holds would have let one user stack unlimited
  holds against the same FSC, since NULLs never collide.
- **A passing invariant over an empty table proves nothing.**
- **An error regex that never matches its raise has happened three times on this
  project.** Verify against the migration file, never from memory.

---

## Where we were mid-conversation — PICK UP HERE

We were designing **seller-created SKUs**, and had just settled two things and
opened one question.

### The problem

Only **one priced SKU exists** (Nike Air Max 1 / Seed Grey). A consignor with a
Jordan 1 can't list it, and the "request a SKU" escape hatch is dead — it shows
"The SKU request ledger isn't wired yet (handoff M2) — nothing was recorded."
There are millions of shoe models; I can't pre-populate a catalog and hope.

### Settled: two prices, only one is mine

- `skus.market_price_cents` is the **oracle** — it sets tier via
  `fn_tier_for_price`, drives `fn_card_value_cents`, and decides which side owes
  the imbalance in `fn_trade_quote`. **Sellers must never set this** — a
  seller-set oracle lets someone mint a Legendary from nothing and trade it for
  real inventory. It is *not* a display price.
- `listings.price_cents` is the **ask**, and it is entirely the seller's.

So a seller wanting $200 for a shoe oracled at $180 lists at $200 and gets $200
minus commission. I confirmed `fn_approve_submission` already does the right
thing: `coalesce(p_price_cents, v_item.asking_price_cents)` — the seller's ask is
the default, my argument is an optional override. **No confirm-before-publish
step is needed** (we discussed adding one and dropped it once this was clear).

### Settled: the shape

`/list` stops being "pick from a catalog." Seller types their shoe, gets fuzzy
matches against existing SKUs, and creates one inline if nothing fits. The
submission proceeds either way.

- SKU already priced → fast path, review is grading only
- SKU new → also needs pricing before mint

**No new gate is needed** — `fn_mint_card` already raises when
`sku.market_price_cents is null`, so an unpriced SKU physically cannot become a
card.

This makes review burden *fall* over time: every priced SKU is permanent
infrastructure, and the tenth person listing AJ1 Chicago only waits on grading.

### On review latency (3AM submissions)

Decided this is smaller than it feels. The seller's work finishes at submission;
what waits is the card appearing on the market, and nobody is refreshing at 3AM
for one specific shoe. Fix with expectation-setting — "reviewed within 24 hours,
we'll email you" — not architecture. Silence is what reads as broken, not delay.
Review is also my **only defence against counterfeits**, so auto-approval is not
something to want. Worth building: a clear SLA, an email on approval, batched
review sittings, and **auto-approve for relists of already-vaulted cards** (my
own inventory, already inspected).

### THE OPEN QUESTION — answer this first

**Is size part of SKU identity, or a variant underneath it?**

Today it *is* identity — `skus.size_us` is a column on the SKU, so
"AJ1 Chicago US9" and "US10" are two rows, two prices, two art assets.

- Economically correct (a US9 and a US13 genuinely price differently)
- Structurally expensive: my own success metric is **SKUs with more than one
  card**, and ten people listing AJ1 Chicago in ten sizes gives ten SKUs with one
  card each. By my own definition that's a gallery, not a market — despite
  obviously being a real market for that shoe. It also means fifteen pricing
  decisions and fifteen art assets for one popular shoe, and trades between sizes
  compare across two independently-set oracles.

The alternative: a **model** (brand + model + colourway — one art asset, one base
price) with **size as a variant/multiplier underneath**. Art drawn once, one base
price plus a size curve, and the duplicate metric measures something real.

That's a bigger schema change — `skus` splits into model and variant — and it is
**far cheaper now, with 12 cards in the database, than after launch.**

Everything about duplicate-matching design follows from this answer.

### Also queued from the same discussion

- **Duplicate prevention** is the real engineering work, not the form. Free text
  gives "AJ1 Chicago" / "Jordan 1 Chicago" / "Air Jordan 1 Retro High OG Chicago"
  as three SKUs. Needs fuzzy matching at entry ("did you mean…?") and a merge
  tool at review.
- **Art placeholder.** Every new SKU needs pixel art via a manual Perchance
  workflow. A tier-coloured placeholder should ship so minting never waits on art.
- **`fn_approve_submission` uses a stale payout snapshot** — it lists with
  `v_item.submitted_payout` (frozen at submission) while
  `fn_purchase_card_core` reads `fn_payout_method_for_user` fresh at settlement.
  If country changes in between, the listing and the settlement disagree. Should
  call `fn_payout_method_for_user(v_item.consignor_id)` like `fn_list_card` does.
- **A price override leaves no trace.** Passing `p_price_cents` replaces the
  seller's ask with nothing recorded — no note, no history, and their dashboard
  shows a price they didn't set.

---

## Open — technical

- **"Held items" on the seller dashboard is silently empty**, same root cause as
  the Submissions bug just fixed: it reads `getConsignments()`, and **nothing in
  any migration has ever written the `consignments` table**. Self-serve items
  never get a `consignment_id`.
- **Stripe Connect is not built.** Money still routes through my personal
  account. Top blocker for real money. Needs the sole proprietorship registered
  first.
- **Not deployed.** Vercel + `flexsoar.net` + production env + Supabase redirect
  URLs + R2 CORS. Webhook redelivery and CORS cannot be tested locally.
- **The legacy FSC hole.** 21,960 cents of uncollateralised FSC from the dead
  top-up path, against 13,540 of platform currency. `fn_check_solvency` correctly
  reports insolvent. `scripts/reset_fsc_and_seed_test_balance.sql` reverses it
  (append-only, via `platform_credit_settle`) and issues a test grant so the FSC
  checkout path can be exercised — **the test grant must itself be reversed
  before live keys**; the reversal is section 3 of that script, commented.
- The 17 admin `security definer` functions are *believed* to call
  `fn_require_admin()` internally — anon is refused in practice — but their
  bodies have not been read. That's inference, not verification.
- `fn_refresh_levels` has no cron. `fn_expire_credit_holds` is only invoked
  incidentally by `fn_reserve_credit`.
- `redemption_handling_fee_cents` is 1500 against real MY→US/JP shipping of
  4000–8000. A redemption today loses money. Needs a quote step that locks cost
  *before* the burn, with me generating the label so I hold the tracking.
- Stale PKCE verifier cookies accumulate on every sign-in with no cleanup;
  cookies share one header with a hard size limit. The callback already handles
  the stateless `?token_hash=` shape — switching the Supabase email template to
  `{{ .SiteURL }}/callback?token_hash={{ .TokenHash }}&type=magiclink&next=/`
  sidesteps the whole class of problem.
- The smoke script's summary grid filters on `settlement_ref like 'smoke_%'` or a
  smoke order's txn, so **trade and reversal transactions are invisible in that
  grid** even though the assertions cover them.
- `docs/GRADING_RUBRIC.md` still says 8 photos; the real path is 4 photos and a
  3-option accessories question. `components/admin/db-writes.ts` is a sanctioned
  contract bypass. No per-user upload cap on R2. **Nothing on `/` tells a visitor
  they can consign.**

---

## Open — business, and mostly more urgent than the code

- **No consignors.** Still the critical path. Recruit people already selling on
  Carousell / Instagram / Shopee — they have unsold inventory and FlexSoar is a
  free extra shelf. **The pitch needs rewriting for the vault model** before I
  send it to anyone.
- **Recruit boring, duplicated inventory.** Ten consignors with ten unique grails
  is a gallery, not a market. The metric is *SKUs with more than one card* —
  which is exactly why the size-as-identity question above matters.
- **Set a value floor.** MY→US shipping makes redemption irrational on a cheap
  shoe, which hollows out the physical backing. Decide the number *before*
  consignor one — raising it later means delisting real people's inventory.
- **Register a sole proprietorship, apply to Stripe Malaysia.** I've onboarded
  before with an IC number rather than an SSM number and it worked. Also email
  Stripe about the platform-collects-fees Connect preview and Express account
  availability. Sole prop means unlimited personal liability — set a tripwire for
  when total on-platform card value exceeds what I could personally cover.
- **No lawyer.** Writing the FlexSoar–consignor agreement myself: no-wear clause,
  48h vault shipping SLA, who pays for loss in transit, whether a consignor can
  pull an unsold item (yes) versus one whose card has sold (no), what happens if
  they go dark. A contract deters and clarifies; it doesn't help against someone
  who disappears, since enforcement means suing over a RM2,000 shoe. The
  operational controls do the real work.
- **Proof of possession is event-triggered, not scheduled.** On listing, on first
  sale, on redemption request, plus low-frequency random spot-checks weighted to
  high-value items and new consignors. 7-day response window on spot-checks, 48
  hours on redemption requests.
- **ToS not written** — title passes on purchase, consignor holds as bailee,
  ships within 7 days on demand, whether a re-grade can move a published
  category, the funds-holding window, who bears loss if a consignor's house
  floods.
- Self-declared `country_code` is a **routing hint, not a fact** — anyone can
  select Malaysia. The lie fails at Connect onboarding, so the damage is a failed
  payout rather than a wrong one. Worth writing down before building payout UI
  that implies otherwise.

---

## How I want you to work with me

- **Give me exact commands to paste.** Windows `cmd`, Windows-style paths, one
  command per line when it might prompt. SQL migrations get a
  `copy "%USERPROFILE%\Downloads\NNN_name.sql" supabase\migrations\` line.
- SQL goes in the Supabase editor ("Run without RLS"); migrations get downloaded
  to `supabase/migrations/` and committed.
- **Write agent prompts as complete copy-paste blocks, and say which worktree.**
- **Push back when something's wrong.** Real bugs here were caught because an
  agent refused an instruction rather than implementing around it, or because a
  claim was verified against the live database rather than assumed. Every one of
  them passed `tsc`. Recent examples: a settlement guard correct under the old
  model and backwards under the new one; a fee entry type that meant two
  different things; three functions that trusted a caller-supplied user id; a
  blanket revoke that broke the signed-out homepage.
- When I say "merge track/X" I mean `merge-track.bat X`. When I say "reset the
  worktrees" I mean `reset-worktrees.bat`.
