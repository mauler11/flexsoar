# Handoff — track/market

## 2026-08-24 — setCountry() wiring: CLOSED. Re-verified against the re-landed contract, not trusted from the earlier draft

The blocker below is cleared: `setCountry(countryCode)` is on `main` now
(`grep -n "setCountry" lib/api/contract.ts` — present at L1768, `throws
UNAUTHENTICATED, INVALID_COUNTRY_CODE`; `lib/db/errors.ts` maps both message
patterns). Re-verified the signature and error codes against the current
tree rather than trusting the draft below — the contract was rebuilt on the
re-land, not just re-applied verbatim, and one assumption in the draft
turned out to be wrong (see item 3).

**1. Persist on diff (`app/(market)/list/actions.ts`,
`submitListingIntakeAction`).** After the existing `isValidCountryCode`
gate and before `submitListing(...)`: `const onFile = await getUser({ id: me
})`; if `onFile?.country_code !== countryRaw`, call `setCountry(countryRaw)`.
Skipped when unchanged, so a returning consignor resubmitting doesn't take a
write every time.

**2. Error handling.** `setCountry`'s `try/catch` maps `ContractError` with
code `INVALID_COUNTRY_CODE` → `{ code: "COUNTRY_REQUIRED", ... }`, and
`UNAUTHENTICATED` → the same `SIGN_IN_REQUIRED` shape the top of the action
already returns for a signed-out caller. Also added a `COUNTRY_NOT_SET` case
to `submitErrorMessage()` (see item 3 — it's a real, not hypothetical, code
`submitListing` itself can throw).

**3. Ordering — re-verification changed the reasoning, not the code.** The
draft assumed `fn_submit_listing` never touches
`fn_payout_method_for_user`, so ordering only mattered for the *later*
`fn_list_card` call at relist time. **That assumption was wrong** — checked
this pass by reading `fn_submit_listing`'s actual current body
(`019c_settlement.sql:373-409`, the `create or replace` that supersedes
013's original), not by re-grepping the same narrower file
(`019b_payout_routing.sql`) the earlier blocked pass had checked. Line 408:
`v_payout := fn_payout_method_for_user(v_user);`, unconditional, before the
photo checks. So a seller with no country on file would have **this very
submission** raise `COUNTRY_NOT_SET` — not just a later relist. The drafted
code placement (`setCountry` before `submitListing`) was already correct
positionally, but for a stronger reason than originally understood. Also
confirmed `fn_list_card` itself calls `fn_payout_method_for_user` inline in
its `listings` insert (`019c_settlement.sql:360`), backing item 4 below.

Also worth flagging, found while reading `019c_settlement.sql` directly:
`submitListing`'s doc comment in `contract.ts` (L2162-2163) still says cash
settlement is "gated to proven sellers" and refuses with `UNPROVEN_SELLER`
via `platform_config.cash_payout_min_fulfilments` — `019c`'s actual
`fn_submit_listing` body has no such gate; its own comment says the gate
"is gone." Doc drift in `contract.ts`, not something in this track's lane
to fix, noted here since a future pass reading that doc comment would be
working from a stale description of what `submitListing` can throw.

**4. The relist gap — applied as drafted.** `listCardAction`
(`app/(market)/actions.ts`) had zero country capture; a card owner who never
went through `/list` (bought the card, never sold anything) would hit
`fn_list_card`'s `COUNTRY_NOT_SET` raise with no field anywhere on
`/card/[id]` to fix it. Fixed: `card/[id]/page.tsx` now reads the owner's
`getUser({ id }).country_code` (distinct from the existing
`getPayoutMethodForUser(...).catch(() => null)` read, which can't
distinguish "no country" from any other read failure) and passes it to
`ListForm` as `countryCode`. `ListForm` renders a required country `<select>`
(same `COUNTRIES` list `PricePayout` uses) exactly when
`!isValidCountryCode(countryCode)`, and includes `country_code` in the
submitted form data only then. `listCardAction` calls `setCountry()` with it
— only when present, so an owner who already has one on file never triggers
an extra write — before `listCard()`.

### Tests

**168 passing (was 164, +4).** New `describe('ListForm — country picker on
the relist path ...')`: `renderToStaticMarkup`, same convention as the
`PricePayout` country tests above — no country on file renders the picker,
an omitted `countryCode` prop behaves the same as `null`, a malformed
on-file value (`'my'`, lowercase) still counts as unset, and a valid one
(`'US'`) renders neither the picker nor its copy. Confirmed `ListForm` (which
imports `listCardAction`, a `'use server'` action pulling in
`next/headers`/`next/navigation`/`stripe`) is safe to import directly in this
test file before relying on it — `lib/api/contract.ts` is already imported
here (L57-58) with no issue, and a live run confirmed no import-time crash.

`npx tsc --noEmit` clean. `npm run build` compiles (`Compiled successfully`,
all 21 routes). `npx eslint` on every changed file: clean (the same two
pre-existing warnings in `list/actions.ts`'s unrelated `fileSkuRequestAction`
noted in the prior pass, still untouched here).

**Not verified live:** none of this was probed against the live project —
`setCountry`/`fn_set_country` and the `fn_list_card`/`fn_submit_listing`
raises were confirmed by reading the applied SQL and the rebuilt contract
directly, not by a live write (this track may not write to the live
database, AGENT_RULES.md §2).

### Files changed

`app/(market)/list/actions.ts` (persist-on-diff + error handling in
`submitListingIntakeAction`, `COUNTRY_NOT_SET` case in
`submitErrorMessage`), `app/(market)/actions.ts` (`listCardAction` accepts
and persists an optional `country_code`), `components/market/ListForm.tsx`
(required country picker, gated on a new `countryCode` prop),
`app/(market)/card/[id]/page.tsx` (reads and threads the owner's on-file
country), `tests/invariants.test.ts` (appended one `describe` block, did not
touch any existing block). No `.sql` file touched, no other edit to
`lib/api/contract.ts` or `lib/db/**`.

---

## 2026-08-24 — setCountry() wiring task: BLOCKED, the contract export the task cited does not exist on any branch (superseded above — kept for the verification trail)

Task handed to this pass: wire `setCountry(countryCode)` — described as shipped
in `lib/api/contract.ts` by track/data commit `39f0efa`, backed by
`fn_set_country` in migration 025 — into `submitListingIntakeAction`
(item 1), handle `INVALID_COUNTRY_CODE`/`UNAUTHENTICATED` (item 2), order the
write before any `fn_list_card` call (item 3), and audit every other path
that reaches `listCard()` (item 4). The task also stated the test count was
at 162.

**Verified before writing any wiring code (AGENT_RULES.md §8), and the
premise doesn't hold:**

- `grep -c "setCountry" lib/api/contract.ts` → **0**. No `setCountry`,
  `INVALID_COUNTRY_CODE`, or `COUNTRY_NOT_SET` anywhere in `lib/`, on this
  branch, right now.
- Migration `025_user_country.sql` **is** present and live in this worktree
  (`fn_set_country`, and `fn_payout_method_for_user` raising instead of
  falling through to `'credit'` on a null country) — the SQL half of this
  landed.
- `39f0efa` exists as a commit object (`git show 39f0efa` resolves it — it
  adds exactly the `setCountry()` export, `INVALID_COUNTRY_CODE`/
  `COUNTRY_NOT_SET` codes, and error-string mappings the task describes) but
  **is not reachable from any branch** — `git merge-base --is-ancestor
  39f0efa HEAD` fails, and `git branch -a --contains 39f0efa` lists nothing.
- `track/data`'s own reflog explains why: `track/data@{1}: commit: track/data:
  expose fn_set_country, map 025's new payout raise...` (that's `39f0efa`)
  is **immediately followed** by `track/data@{0}: reset: moving to main` —
  i.e. `track/data` committed this, then was reset back to `main`'s tip
  (`2387377`, the migration-only commit) before this task started.
  `git diff HEAD track/data -- lib/api/contract.ts` is empty: track/data's
  current branch tip has no `setCountry` either. Every worktree
  (`flexsoar`, `-admin`, `-data`, `-design`, `-market`) sits at `2387377`
  per `git worktree list`.
- `npm test` baseline right now: **158 passing**, not 162 — consistent with
  this file's own previous entry ("158 passing (was 152, +6)") and with
  `39f0efa`'s test additions (81 lines to `tests/invariants.test.ts`,
  per that commit's diffstat) being part of what got reset out.

Per AGENT_RULES.md §1/§2: this track does not write `lib/api/contract.ts` or
`lib/db/errors.ts` (also missing the country error-string mappings —
checked, zero `country`/`COUNTRY` hits) under any circumstances, "additive
exports" included — "only track/data writes that file at all." I drafted the
full wiring against a checked-out copy of `39f0efa`'s contract.ts to confirm
it would actually close this, then reverted all four files
(`app/(market)/list/actions.ts`, `app/(market)/actions.ts`,
`components/market/ListForm.tsx`, `app/(market)/card/[id]/page.tsx`) rather
than commit code that fails `tsc --noEmit` against what's actually on this
branch. Per §9 ("push back... a refused task with a clear explanation is a
good outcome. Implementing something you believe is wrong, correctly, is the
worst one") and §11 (never commit past a failing `tsc`), this is filed
instead of implemented.

**Ask, for whoever owns `track/data`:** land `setCountry()` /
`INVALID_COUNTRY_CODE` / `COUNTRY_NOT_SET` for real this time — either
re-apply `39f0efa` onto `track/data`'s current tip, or redo the equivalent
export against 025 as it stands today (its shape matches what's in the
migration file: `fn_set_country(p_country text)`, session client, no
user-id argument, raising `INVALID_COUNTRY_CODE` on a non-2-letter code and
`UNAUTHENTICATED` — mapped from `'sign in to set your country'` — on no
session; plus the `COUNTRY_NOT_SET` mapping for `fn_payout_method_for_user`'s
new raise, since that fires inside `fn_list_card` and `fn_purchase_card_core`
too, not just a direct read).

**Exact plan ready to apply the moment it lands** (drafted and dry-run
against `39f0efa`'s contract.ts before reverting, so this is not a guess):

1. `app/(market)/list/actions.ts` — import `setCountry` alongside the
   existing `getUser`/`ContractError` imports. In
   `submitListingIntakeAction`, right after the existing
   `isValidCountryCode(countryRaw)` gate and before the `submitListing(...)`
   call: `const onFile = await getUser({ id: me })`; if
   `onFile?.country_code !== countryRaw`, call `setCountry(countryRaw)`
   inside a `try/catch` — on `ContractError` with code
   `INVALID_COUNTRY_CODE` return `{ ok: false, code: "COUNTRY_REQUIRED", ... }`,
   on `UNAUTHENTICATED` return the same `SIGN_IN_REQUIRED` shape the top of
   the function already uses, otherwise fall through to a generic
   `SUBMIT_FAILED`. Skipping the call when unchanged avoids a write on every
   resubmission by a returning consignor.
2. This naturally satisfies the ordering item (3): `submitListing` (013)
   never calls `fn_payout_method_for_user` itself (grepped every migration
   that defines or calls it — only `019c_settlement.sql`,
   `021_credit_holds.sql`, and `fn_list_card`/`fn_purchase_card_core` per
   `39f0efa`'s own contract.ts comment). The only path from this item to a
   `fn_list_card` call is later, after admin review and minting, through
   `listCardAction` (`app/(market)/actions.ts`) — by which point this
   submission has already run and persisted the country. No explicit
   re-ordering needed beyond "call `setCountry` before returning `ok: true`."
3. **Item 4 finding — real gap, in this track's lane, same blocker:**
   `listCardAction` (`app/(market)/actions.ts:92`) is the **other** path to
   `fn_list_card` — the "relist a card you already own" flow from the card
   detail page (`ListForm.tsx`), distinct from the intake wizard. It takes
   no country input at all today. A card owner who never went through
   `/list` (e.g. bought the card from someone else, never sold anything) has
   no country on file and **no field anywhere on `/card/[id]` to set one** —
   `getPayoutMethodForUser(detail.owner.id).catch(() => null)` on that page
   already swallows the raise into `null` (just skips the payout banner,
   harmless), but `listCardAction`'s own `listCard()` call has no such
   guard, so it would hit `fn_list_card`'s new `COUNTRY_NOT_SET` raise and
   dead-end the seller with only the raw SQL text in `?error=`. Drafted fix
   (dry-run passed `tsc`, reverted with everything else): thread the owner's
   `getUser({ id: detail.owner.id }).country_code` into `ListForm` as a new
   `countryCode` prop; when it's not `isValidCountryCode`, `ListForm` renders
   a required country `<select>` (same `COUNTRIES` list PricePayout.tsx
   already uses) and sends `country_code` in the form data; `listCardAction`
   calls `setCountry()` with it — only when present, so an owner who already
   has one on file never triggers an extra write — before `listCard()`. No
   other `listCard()` callers exist repo-wide (grepped).

**Not verified live:** none of the above was probed against the live
project — no code changed, so there was nothing to run.

### Tests

Unchanged: **158 passing** (baseline, not 162 as the task stated — see
above). No code was committed this pass, so nothing to add tests for yet;
the drafted `ListForm` picker (item 4 above) would get the same
`renderToStaticMarkup` coverage the existing `PricePayout` country tests use,
once it can actually be wired to something real.

`npx tsc --noEmit` clean (nothing changed). `git status` clean — all four
draft-edited files (`app/(market)/list/actions.ts`, `app/(market)/actions.ts`,
`components/market/ListForm.tsx`, `app/(market)/card/[id]/page.tsx`) were
reverted with `git checkout --`, not committed.

### Files changed

None — this entry only. `docs/handoff/market.md` (this note).

## 2026-08-24 — Country capture on the listing wizard (payout-routing bug) — UI/validation done; BLOCKING ask for track/data on the actual write

Task: capture the seller's country before they can list, since a confirmed
live bug (2026-08-22) showed a real signup leaves `users.country_code` NULL,
`fn_payout_method_for_user` silently resolves that to `'credit'`, and every
launch consignor is Malaysian — so every one of them was being paid FSC
instead of cash with no error anywhere.

### What's built, fully in this track's lane

1. **`components/market/intake/intake-config.ts`** — `COUNTRIES` (a real ISO
   3166-1 alpha-2 list, ~195 entries) and `isValidCountryCode()`. `MY` is one
   entry among many, not a default — the picker's placeholder option is not
   itself a valid value, so a seller must make a real choice.
2. **`app/(market)/queries.ts`** — `getCashPayoutCountryCodes()`, a new local
   read (same established pattern as this file's other workaround reads:
   server-only, session client, never `users`) over `cash_payout_countries`,
   which 019b already grants `select` to `anon, authenticated`. It mirrors
   `fn_payout_method_for_user`'s exact membership predicate
   (`upper(btrim(country_code))` against the table), so the UI's live preview
   is authoritative-equivalent, not a guess.
3. **`components/market/intake/PricePayout.tsx`** — a required country
   `<select>` (Step 4). The existing seller-payout disclosure banner now
   reacts to whichever country is currently selected (via
   `cashPayoutCountryCodes` above), overriding the stale `sellerPayoutMethod`
   the moment a different country is picked — a seller sees the real cash/FSC
   outcome before they submit, not after. FSC copy now states plainly: store
   credit, 1 FSC = 1 USD, earned by selling, spendable on FlexSoar, cannot be
   cashed out to a bank, and names the Stripe corridor as the reason.
4. **`components/market/intake/IntakeWizard.tsx`** — country state threaded
   through, pre-filled from `initialCountryCode` (the account's current
   `users.country_code`, so a returning consignor is not asked twice), and
   required to advance past Step 4 (`canNext`) — client-side convenience only.
5. **`app/(market)/list/actions.ts`** — `submitListingIntakeAction` refuses
   server-side (`COUNTRY_REQUIRED`) when the submitted country isn't one of
   `COUNTRIES`. This is the real gate; the client requirement above is
   belt-and-braces, same convention as every other check in this action.
6. **`app/(market)/list/page.tsx`** — fetches the account's existing
   `country_code` (`getUser`, already-frozen contract export, self-read is
   RLS-covered) and the live `cash_payout_countries` set, passes both down.

### BLOCKING — this does not yet WRITE `users.country_code`, so the bug is only front-doored, not closed

Verified directly against the applied migrations before writing anything
(AGENT_RULES.md §8): **no path exists, anywhere, for a seller to persist their
own country.**

- `lib/api/contract.ts` has no update/write export touching `users` at all
  (grepped: zero `.update(` calls on the `users` table anywhere in the file).
  `getPayoutMethodForUser` and `getUser` are reads only.
- `007_profile_updates.sql:51-52` — `revoke update on users from
  authenticated; grant update (handle) on users to authenticated;` — the
  self-update RLS policy (`users_self_update`, same file) permits the row, but
  the column-level grant permits **only `handle`**. No later migration
  (checked every file through `024f`) widens it. A raw
  `.update({ country_code })` from a session would be refused at the grant
  layer (42501) even though the row-level policy would allow it — verified by
  reading the grant statement directly, not assumed.

Per AGENT_RULES.md §1/§2, this track does not touch `lib/api/contract.ts`,
does not call `supabase.from(...).update(...)` outside track/data, and does
not write `.sql`. All three would be required to close this for real, so none
were done — filed here instead, per §9 ("push back... a refused task with a
clear explanation is a good outcome").

**Ask, for whoever owns `lib/api/contract.ts` + a migration:**

1. A migration widening the grant: `grant update (handle, country_code) on
   users to authenticated;`, plus a CHECK constraint validating the ISO-2
   shape (`country_code ~ '^[A-Z]{2}$'` or similar) so a client can't write
   garbage into a column `fn_payout_method_for_user` trusts.
2. A contract export, e.g. `updateUserCountry(countryCode: string):
   Promise<void>`, session client, deriving the row from `auth.uid()` the same
   way `handle`'s self-update already does.

Once both land, wiring is small: `submitListingIntakeAction` already validates
and has the value in hand (`countryRaw`) right where the `COUNTRY_REQUIRED`
check is now — add one `await updateUserCountry(countryRaw)` call there,
before `submitListing(...)`, and this closes end-to-end. Flagged in code
comments at both call sites (`PricePayout.tsx`'s file doc comment,
`list/actions.ts`'s check) so whoever wires it finds the exact spot.

**Practical state until then:** the wizard now always asks, validates, and
shows the seller the correct preview for whatever country they pick — real
forward progress, and no submission can skip the question. But
`fn_payout_method_for_user` still resolves off whatever is already in
`users.country_code` (null, for every current consignor), so the actual
payout routing bug is not fixed by this pass alone — only the front door is.
Said plainly rather than left to be discovered at payout time.

### Tests

`tests/invariants.test.ts`: **158 passing (was 152, +6)**. New
`describe('intake-config.isValidCountryCode / COUNTRIES', ...)` (guard
correctness, no dupes, all-uppercase-two-letter shape, `MY` present but not
special-cased) and `describe('PricePayout — country-driven payout disclosure
...', ...)` (renders `PricePayout` via `renderToStaticMarkup`, same convention
as the `MarketTile` block above: no country picked falls back to the
account's saved `sellerPayoutMethod`; picking a cash-eligible country
overrides a stale `credit` value; picking a non-eligible country shows the
FSC copy and overrides a stale `cash` value; neither banner renders with
nothing to go on yet).

`npx tsc --noEmit` clean. `npm run build` compiles (`Compiled successfully`,
all 21 routes render). `npx eslint` on every changed file: clean (two
pre-existing warnings in `list/actions.ts`'s unrelated `fileSkuRequestAction`,
untouched by this pass — `colorway`/`notes` unused, predates this task).

**Not verified live:** `getCashPayoutCountryCodes()` was not probed against
the live project (would need the anon/session key mid-session; read instead
directly against `019b_payout_routing.sql`'s DDL and grant statements, which
are unambiguous). The self-update grant gap above was verified by reading
`007_profile_updates.sql` and every later migration file directly, not by
attempting a live write (this session may not write to the live database,
AGENT_RULES.md §2, and a 42501 from a doomed write would prove nothing a
grep didn't already show).

### Files changed

`components/market/intake/intake-config.ts` (new `COUNTRIES`,
`isValidCountryCode`), `PricePayout.tsx` (country select, live disclosure,
FSC copy), `IntakeWizard.tsx` (country state, gating, review row);
`app/(market)/queries.ts` (new `getCashPayoutCountryCodes`),
`app/(market)/list/actions.ts` (server-side `COUNTRY_REQUIRED` check),
`app/(market)/list/page.tsx` (fetch + thread the two new reads);
`tests/invariants.test.ts` (appended two describe blocks, did not touch any
existing block). No `.sql` file touched, no edit to `lib/api/contract.ts` or
`components/card/**`.

## 2026-08-24 — Closed docs/handoff/design.md item 3 (price-in-FSC formatting), showNumericFloat wiring, live credit_hold_minutes

Task: finish the price-formatting fix track/design filed as item 3 in
`docs/handoff/design.md`, plus two smaller asks in the same doc's item 4.

### 1. `formatFsc()` → `formatUsd()`, 18 call sites

design's audit said "roughly 18" and asked this be re-verified against the
current tree rather than trusted — re-counted by grep before touching
anything: exactly 18 `formatFsc()` call sites in `components/market/**` /
`app/(market)/**` were formatting a USD-cents price (listing price, oracle
value, sale gross/fee/net, redemption/handling fee, reserve price, intake
fee, trade-history price), not an actual FSC amount. All 18 fixed, one-line
swaps, listed in design's item 3 (their line numbers shifted slightly since
that entry was written, but every site named there was found and fixed):
`BuyPanel.tsx` (listing price, oracle value — the other three `formatFsc`
calls in that file are real FSC amounts and are untouched), `ListForm.tsx`,
`IntakeWizard.tsx`, `PricePayout.tsx` (×2), `OrderPoll.tsx`,
`ProvenanceChain.tsx`, `SkuPicker.tsx`, `RedeemForm.tsx`,
`card/[id]/page.tsx` (×6), `dashboard/page.tsx`, `u/[handle]/page.tsx`.

### 2. `formatMyr()` — both remaining call sites removed

`BuyPanel.tsx:129` and `ListForm.tsx:82` were the only two production
callers left repo-wide (grepped after the fix; `tests/invariants.test.ts`
still calls it directly to test the function itself, which is not a
production caller). **Zero production callers of `formatMyr()` remain** —
`components/card/format.ts` (track/design's lane) is not touched here, but
the export can now be deleted; nothing outside `format.ts` and its own test
references it.

### 3. `MarketTile` → `CardTile` `showNumericFloat` wiring

`MarketTile.tsx` gained an optional `showNumericFloat` prop, forwarded
straight to `CardTile` (defaults to `undefined`, which `CardTile`'s own
default of `false` already covers — no behavior change for an unwired
caller). Wired from `getPlatformConfig().show_numeric_float`
(`lib/api/contract.ts`, exposed per `docs/handoff/data.md` item 14) in both
places that render a grid of `MarketTile`s: `app/(market)/page.tsx` (the ask
in design's item 4) and `app/(market)/u/[handle]/page.tsx` (same component,
same bug, not separately asked for but fixed for the same reason). Live
value is `false` today, so nothing visually changes until an admin flips the
flag — verified with three new tests (see below) that actually assert the
prop reaches `CardTile`, not just that the file compiles.

### 4. `checkout-math.ts` / `actions.ts` — `credit_hold_minutes` now read live

`getPlatformConfig()` exposes `credit_hold_minutes` now (`docs/handoff/data.md`
item 14). `createCheckoutAction` (`app/(market)/actions.ts`) reads it live
and falls back to `CREDIT_HOLD_MINUTES_FALLBACK` only when the
`getPlatformConfig()` call itself fails — never on a live value that is
simply lower, which is exactly the direction that must take effect
immediately (a hardcoded 1440 with a *lowered* live config would let a
Stripe Checkout Session outlive the FSC hold backing it — cash collected
with no card transferred, per the risk note in the task and in
`docs/handoff/data.md` item 14). `CREDIT_HOLD_MINUTES_FALLBACK` itself is
untouched in `checkout-math.ts` (still `1440`) — the existing test in
`tests/invariants.test.ts` pinning it against `contract.ts`'s copy of the
same constant still holds, since only the *usage* in `actions.ts` changed,
not the constant's value.

### Tests

`tests/invariants.test.ts`: **152 passing (was 149, +3)**. New
`describe('MarketTile -> CardTile showNumericFloat wiring ...')` block
renders `MarketTile` with `renderToStaticMarkup` (no jsdom in this project —
static markup is enough to assert on): omitting the prop and passing
`false` both render the named condition badge with no `PCT`/numeric float;
passing `true` renders the numeric float and no named badge. This is the
first committed component-render test in this file (prior passes only
model-level tests); used `react-dom/server` + `React.createElement` since
the file is `.ts`, not `.tsx`, so no JSX. Did not add tests for the
`formatFsc`→`formatUsd` swaps or the `credit_hold_minutes` live-read — the
former is already pinned by design's existing "formatUsd/formatFsc render
distinctly" test at the function level, and the latter lives inside a
`'use server'` action that imports `next/headers`/Stripe/Supabase (same
reasoning `docs/handoff/data.md` item 13 gives for not importing
`route.ts` directly in tests — the module-graph cost, not a judgment call
made here).

`npx tsc --noEmit` clean. `npm run build` compiles (`Compiled successfully`,
all 21 routes render — up from 19 in the last checkout pass, the extra two
are admin routes merged in from another track since then). `npx eslint` on
every changed file: clean, zero warnings.

**Not verified live:** the visual effect of `show_numeric_float` actually
flipping true in the live `platform_config` table — the live value is
`false` (per `docs/handoff/data.md`), so there's no live state to click
through that shows the numeric-float branch; covered instead by the new
render tests above, which exercise both branches directly.

### Files changed

`components/market/BuyPanel.tsx`, `ListForm.tsx`, `OrderPoll.tsx`,
`ProvenanceChain.tsx`, `RedeemForm.tsx`, `MarketTile.tsx`,
`intake/IntakeWizard.tsx`, `intake/PricePayout.tsx`, `intake/SkuPicker.tsx`;
`app/(market)/page.tsx`, `u/[handle]/page.tsx`, `card/[id]/page.tsx`,
`dashboard/page.tsx`, `actions.ts`, `checkout-math.ts` (doc comment only, no
behavioral change); `tests/invariants.test.ts` (appended one describe
block, did not touch any existing block). No `.sql` file touched, no edit
to `app/api/webhooks/**`, `lib/api/contract.ts`, or `components/card/**`.

## 2026-08-23 — FSC-aware checkout, two disclosures, pending_vault on the card page

Task: wire the UI to the split-settlement data layer track/data finished in
`docs/handoff/data.md` item 13 — checkout was cash-only because nothing in
`app/**` called `reserveCredit()` or carried `credit_cents`/`hold_id` into
Stripe metadata. All of that is now wired.

### 1. Checkout

`createCheckoutAction` (`app/(market)/actions.ts`) now takes a second
argument, `creditCentsRequested`. Order of operations, exactly as asked:
`getCreditAvailable()` → `validateRequestedCredit()` (refuses, never clamps,
a request above available) → `reserveCredit()` **before** anything
Stripe-side → either settle directly (FSC-only) or create the Checkout
Session with the cash leg only. Any failure after a successful reserve
(session creation, or the direct-settle RPC) calls `releaseCreditHold()` so
the hold is never stranded. Metadata keys (`credit_cents`, `hold_id`) match
what `app/api/webhooks/stripe/route.ts` reads — read the file, not guessed.

**FSC-only settlement — how it's handled, since the task asked specifically:**
when `creditCentsRequested` covers the full price, `createCheckoutAction`
calls `purchaseCardSplit(listingId, buyerId, null, creditCents, holdId)`
**directly**, with no Stripe Session at all. `purchaseCardSplit`'s doc
comment says "never from client code" — read narrowly, that's about the
browser bundle (the service-role key can't reach a client component; the
module is server-only by construction) and about not settling on behalf of a
session-less caller. This call is neither: `app/(market)/actions.ts` is a
`'use server'` Server Action running with the buyer's own session, and the
settlement carries the `holdId` that same session just reserved through
`reserveCredit()` — the exact provenance `fn_purchase_card_core` checks for
(a hold whose `user_id` matches the buyer and whose listing matches). There
is no other way to satisfy "must not create a Stripe session at all" — no
`checkout.session.completed` event will ever fire for a $0 cash leg, so
nothing else could ever call `purchaseCardSplit` for this case. Flagging the
judgment call rather than burying it: if track/data reads this differently,
say so and I'll rework it.

**Stripe Session `expires_at`.** `platform_config.credit_hold_minutes` is
**not** on `getPlatformConfig()` (checked the interface and the row-mapping
in `lib/api/contract.ts` — it returns `redemption_handling_fee_cents` /
`credit_payout_enabled` / `credit_payout_premium_bps` /
`credit_purchase_min_cents` / `show_numeric_float` only). Live-verified value
(read-only, anon key): **1440**, matching the task brief. Pinned as
`CREDIT_HOLD_MINUTES_FALLBACK` in the new `app/(market)/checkout-math.ts`,
same pattern as `REDEMPTION_HANDLING_FEE_CENTS`'s existing fallback in
`contract.ts` itself. **Ask for track/data:** add `credit_hold_minutes` to
`PlatformConfig`/`getPlatformConfig()` so this can read the live value
instead of a pinned one.

`checkoutExpiresAtSeconds()` clamps to Stripe's own [30min, 24h) bounds with
a 60s safety margin below the 24h ceiling — `credit_hold_minutes` is exactly
1440 (24h) today, and computing `now + 1440*60` then sending it to Stripe a
moment later can land a few hundred milliseconds past what Stripe's own
clock considers 24h out and get refused outright.

### 2. Disclosures

**Seller payout method** (`fn_payout_method_for_user`, geography-derived,
never a client choice): shown before a seller commits, in both places a
listing can be created — `ListForm.tsx` (relisting an owned card) and
`PricePayout.tsx` (the self-serve intake wizard's price/payout step, wired
through `IntakeWizard` from `app/(market)/list/page.tsx`). Not admin-gated,
confirmed by reading `019b_payout_routing.sql:95` (`grant ... to
authenticated`) — fine for this since a seller must be signed in to list at
all.

**First-sale freeze warning** (buying a `custody='seller'` listing freezes
the card `pending_vault` until vault-in, 023c): shown in `BuyPanel` before
checkout, gated on `itemCustody?.custody === "seller"`.

**Investigated and ruled out as a blocker, worth recording:** my first read
of `items_public_read` (`001_schema.sql:419` — `using (status in
('minted','redemption_hold','shipped'))`) suggested a buyer couldn't read
`items.custody` for a live first-sale listing at all, since
`fn_approve_submission` sets the item to `'in_custody'` before minting — not
in that allow-list. Live-probed (read-only, anon key) rather than assumed:
`fn_mint_card` (`002_operations.sql:102`) sets `items.status = 'minted'`
**in the same transaction**, so by the time a card is actually live for sale
its item is always `'minted'`, which items_public_read does cover.
Confirmed live: anon key reads `custody` on a real `minted`+`seller` item
fine. So `getItem(item.id)` from a buyer session works as designed — no data
gap here, despite how it first looked from the RLS text alone.

**Not live-verified: the first-sale banner itself.** Checked the live
project (read-only) for a public listing backed by a `custody='seller'`
item to click through — none exists in the current seed data (all three live
public listings trace to `custody='warehouse'` items). The mechanism it
depends on (`getItem()` returning `custody` to a buyer session) is verified
live per above; the banner's own conditional render was checked by reading
the code and by `next build`/`tsc`, not by loading an actual first-sale
listing in a browser.

### 3. Card page — `pending_vault`

`CardStatus` in `lib/db/types.ts` (track/data's lane) is still `'active' |
'locked' | 'burned' | 'redeemed'` — `023a_card_status_pending_vault.sql`
added `'pending_vault'` to the live enum but the TS mirror never caught up
(grepped the whole repo: zero hits for `pending_vault` outside `.sql`
files before this pass). Comparing `detail.status === "pending_vault"`
directly doesn't just look wrong, it's a real `tsc` error (TS2367, "no
overlap") — and it turns out **widening the variable's declared type isn't
enough to silence it**: TypeScript's literal-comparability check narrows a
`const` back to its initializer's type for that specific diagnostic, even
past an explicit wider annotation (reproduced in isolation before trusting
it). What works, with no cast/`any`/`@ts-ignore`: route the comparison
through a function whose *parameter* is typed `CardStatus | "pending_vault"`
— `isPendingVault()` at the top of `card/[id]/page.tsx`. **Ask for
track/data:** add `'pending_vault'` to `CardStatus` in `lib/db/types.ts` so
this workaround can go away.

Rendered via a new `PendingVaultPanel` (owner-only branch, replacing the
generic "Card is {status}" fallback for this one status) — explains the
freeze, shows the 48h ship-by countdown and shipment status, and says
plainly it isn't an error. Its data comes from a new
`getVaultIntakeForCard()` read in `app/(market)/queries.ts`: `vault_intakes`
(023c) has no contract export (grepped `contract.ts` for "vault": zero
hits), so this follows the same "workaround read, flagged, server-only,
never `users`" pattern the file's other three reads already use.
`vault_intakes`' own RLS (`consignor_id/buyer_id = self OR admin`) does the
access control; this just projects the columns the panel needs.

### Bonus fix found while in `actions.ts`: `redirect()` inside `try` blocks

`redirect()` throws Next's own internal control-flow error, and the docs are
explicit it must not be caught without rethrowing
(`node_modules/next/dist/docs/.../unstable_rethrow.md`) — a `catch` that
doesn't check for it turns a *successful* redirect into a mishandled error.
`cancelListingAction`'s existing `redirect(cardPath(...))` on its success
path was already inside its `try`, ahead of a `catch` that didn't rethrow —
found while adding the same shape to `createCheckoutAction`'s two new
redirect-on-success paths (the FSC-only settle, and the Stripe Session
success). Fixed all three with `unstable_rethrow(thrown)` as the first line
of each affected `catch` (imported from `next/navigation`). Not verified
live against a real cancel/checkout (would need a live mutation), but the
docs' own example is exactly this shape, and it's a one-line, low-risk fix
in a file already open for this task.

### Tests

`tests/invariants.test.ts`: **136 passing (was 119, +17)**. All new tests
import `app/(market)/checkout-math.ts` directly (no mirroring) — it's a
plain module with no `next/headers`/Stripe/Supabase in its graph, so there's
none of the import-cost trade-off the webhook tests above accepted.
Coverage: `validateRequestedCredit` (blank = no leg, refuses-not-clamps
over-available, refuses over-price, refuses non-integer/negative, accepts
inclusive bounds), `cashLegCents`/`isFscOnlyPurchase`, and
`checkoutExpiresAtSeconds` (matches the live 1440 fallback, stays inside
Stripe's [30min, 24h) bounds at both extremes).

`npx tsc --noEmit` clean, `npm run build` compiles (all 19 routes,
`Compiled successfully`), `npx eslint` clean on every changed file (3
pre-existing warnings elsewhere, untouched by this pass).

**Smoke-tested in a browser** (`npm run dev`, read-only — no purchase
clicked, since that would reserve real FSC or create a real Checkout
Session against the live project): `/`, `/list`, and `/card/<id>` for a real
public listing all return 200 with no error boundary and no server-log
errors; the FSC input, disclosures, and updated button copy render as
expected for the states the current seed data has (see the "not
live-verified" note above for the one state it doesn't have).

### Files changed

- `app/(market)/checkout-math.ts` (new) — pure checkout decision logic,
  directly unit-tested.
- `app/(market)/actions.ts` — `createCheckoutAction` extended for the FSC
  leg; `unstable_rethrow` fix in it and in `cancelListingAction`.
- `app/(market)/queries.ts` — added `getVaultIntakeForCard()`.
- `app/(market)/card/[id]/page.tsx` — `pending_vault` rendering, first-sale
  and seller-payout disclosure wiring, `isPendingVault()` helper.
- `app/(market)/list/page.tsx` — threads `sellerPayoutMethod` into the wizard.
- `components/market/BuyPanel.tsx` — FSC amount field, disclosures, FSC-only
  button/copy states.
- `components/market/ListForm.tsx`,
  `components/market/intake/PricePayout.tsx`,
  `components/market/intake/IntakeWizard.tsx` — seller-payout disclosure.
- `tests/invariants.test.ts` — appended, did not touch existing blocks.

No `.sql` file touched. No edit to `app/api/webhooks/**` or
`lib/api/contract.ts`. No change to `components/card/**`,
`components/ui/**`, or `app/globals.css` — FSC formatting reuses
`formatFsc()`/`formatUsd()` from `components/card/format.ts` as-is.


Items filed by the market track. Numbered within this file. Created on
`track/market` at `861dfd8` (before `main`'s handoff split was visible here).

Read before building: `AGENT_RULES.md`, `docs/HANDOFF-shared.md`, the admin
handoff, and — critically — `lib/api/contract.ts`, because `docs/handoff/data.md`
**does not exist on any branch yet** (checked `track/data`, `main`, and
`remotes/localmain` on 2026-08-11). The contract on this branch is what the
sections below are written against. When the real `data.md` lands, read it
instead of trusting this file.

---

## What track/market built (this pass)

Shipped and verified (`next build`, `tsc --noEmit`, `npx eslint`, `npm test`
= 77 passing) at 2026-08-11. Everything lives under `app/(market)/**` and
`components/market/**`; nothing outside was touched.

1. `app/(market)/layout.tsx` — market shell: header (brand, market + profile
   links, signed-in handle/sign-out via `signOut` from `(auth)`), Footer, and
   `ToastProvider`. Root `app/layout.tsx` untouched.
2. `app/(market)/page.tsx` — browse grid at `/`. Renders `getListings({
   viewerId, brand, model, sizeUs, tier, sort })`. URL-driven filters:
   **brand / model / size / tier / sort** (recent, price_asc, price_desc,
   float_desc, public_at_asc). Early-access visibility comes out of the
   contract's own filter, fed the signed-in `viewerId`.
3. `app/(market)/card/[id]/page.tsx` — detail: `CardDetail` hero, provenance
   chain, oracle fair value + grading notes strip, and three caller-dependent
   panels: **owner** (list/cancel + redeem), **buyer/anon** (BuyPanel / 
   OrderPoll), or a "not on the market" note.
4. `app/(market)/u/[handle]/page.tsx` — public profile from `public_profiles` +
   `levels`: rank name, level, xp, portfolio value, live listings (visibility
   filtered for the caller), trade history table from `card_provenance`. Never
   reads `users`. (WAITS on handoff item 1.)
5. `app/(market)/actions.ts` — Server Actions, the only mutators on the lane:
   - `listCardAction(formData)` — owner re-check, active card, no live listing.
   - `cancelListingAction(formData)` — seller re-check.
   - `createCheckoutAction(listingId)` — gate re-check, self-purchase refusal,
     then a Stripe Checkout Session with
     `payment_intent_data.metadata = { listing_id, buyer_id }` (without it the
     webhook logs `not recorded`); redirects to Stripe. The client NEVER calls
     `purchaseCard`.
   - `getListingForOrderAction(listingId)` — wrapped `getListing` poll target
     (handoff text below had called it `getListingForOrder`; actual name is
     `getListingForOrderAction`).
   - `redeemCardAction(formData)` — owner re-check + address validation; fee is
     the server-side constant, not client input.
   Errors redirect with the server text verbatim in `?error=` (belt-and-braces
   over the upstream gates).
6. `app/(market)/queries.ts` — `currentUserId`, `currentUserLevel`,
   `getPublicProfileByHandle`, `getTradeHistory`, and the pinned
   `REDEMPTION_HANDLING_FEE_CENTS = 1500`.
7. `components/market/**` — `Banner`, `Countdown` (hydration-safe ticking
   timer), `MarketTile`, `MarketFilters`, `BuyPanel` (level gate UI + countdown
   + unlock flip), `OrderPoll` (polls to `order.status === 'settled'`),
   `ListForm` (price in FSC, 15%-below-oracle **warning, not block**),
   `RedeemForm`, `ProvenanceChain`, and the shape adapter `bridge.ts`
   (`CardSummary`/`SkuRef`/`ListingRef` → pure-prop `Card`/`Sku`/`Listing`).

Client components are only the interactive ones (filters, countdown, forms,
buy/poll); every mutation is a Server Action; the contract is never imported
from a client file.

## Actions on other tracks

### 1. Need `getPublicProfile(handle)` — `app/(market)/u/[handle]` uses a local read until it lands

Your item 14 list is exactly right: `getUser({ handle })` returns null for a
stranger since 006, and nothing else in the frozen contract turns a handle into
a profile. I chose your option 1 — please add `getPublicProfile(handle)` — but
built the page against a local read so it compiles and renders today.

**Local workaround in `app/(market)/queries.ts` (my lane, server-only):** reads
`public_profiles` (the view your contract's own embeds use), `levels`, `cards`
(public), and `card_provenance` (no RLS in 001) directly through
`createServerSupabase()`. Never touches `users`. All three reads are flagged in
the file as waiting on `getPublicProfile`.

What I'd want from `getPublicProfile(handle)` if/when it ships:

- `{ id, handle, level, rank_name, xp_total, portfolio_value_cents, created_at }`
  where `rank_name` comes from `levels.name DO NOT leak email/is_admin/is_consignor`.
- The trade history could ride along (`card_provenance` joined to
  cards/skus is not secret), but `getCards({ ownerId })` plus a provenance read
  already covers it, so a plain profile object is enough to unblock.

### 2. Listings sort default and the 1000-row ceiling (from your item 10)

Nothing to do — acknowledged, not a block. `getListings()` defaulting to
`('early_access','public')` is exactly what the market grid wants, and the
`float_asc` / `float_desc` JS-rank-within-1000 is accepted; I expose
`price_asc` / `price_desc` / `recent` / `public_at_asc` as DB-sorted in the
sort control and keep `float_*` available behind the same control.

### 3. Checkout gate must run BEFORE the Stripe Session, not rely on the webhook

`fn_purchase_card` raises EARLY_ACCESS_LOCKED at webhook time — after the
buyer has paid. A below-level buyer paying then learning the sale could not be
recorded is money moved with no card. `createCheckoutAction` therefore
re-checks the same gate (level >= `early_access_level` while `now < public_at`)
against the buyer's `users.level` before creating the Session, and refuses with
the same EARLY_ACCESS_LOCKED semantics — the BuyPanel also disables the button
with the reason (level required / sign-in). The webhook stays the last line of
defence, not the first; this UI should never reach it locked.

### 4. No source for the redemption handling fee

`fn_redeem_card(p_fee_cents)` takes the fee as an argument and the rest of the
schema records it, but nothing tells a UI what the fee IS. I pinned a constant
(`REDEMPTION_HANDLING_FEE_CENTS = 1500` in `app/(market)/queries.ts`, USD
cents, surfaced in the redeem form). A `levels.perks` value or a
`platform_config` row would be the right home; happy to read it from wherever
track/data puts it.

### 5. Stripe environment variables still absent

DEPS.md already lists `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` as needed.
Confirmed both are still missing from `.env.local` (only the three Supabase
vars are present). The checkout action surfaces a readable error when unset;
no code change needed once they land.

### 6. `components/market/bridge.ts` `toSku()` drops `art_url` — market tiles never show uploaded art

Investigated the "card tiles render the sprite instead of the uploaded art"
report. The data side is clean: `SKU_REF_COLUMNS` and `SKU_COLUMNS` in
`lib/api/contract.ts` both select `art_url` (contract.ts:687-692), and it
survives every read on this lane —
`getListings`/`getListing`/`getCard`/`getSkus` all embed the full `SkuRef`
(via `SKU_REF_COLUMNS`) or `SkuSummary` (`SKU_COLUMNS`) row, and
`toCardSummary` (contract.ts:968-984) passes the embedded `sku` object through
`requireEmbed` unchanged — nothing drops `art_url` before it reaches
`app/(market)/**`.

The gap is `toSku()` in `components/market/bridge.ts:31-48`. It hand-builds
the `Sku` row from `SkuRef` field-by-field and never copies `art_url`, so
every page that calls it (`app/(market)/page.tsx` and `u/[handle]/page.tsx`
via `MarketTile`, `card/[id]/page.tsx` via `toSku` directly) hands
`components/card/CardArt.tsx` a `sku.art_url` of `undefined`. `CardArt.tsx:40`
checks `sku.art_url ?` to decide sprite vs. uploaded PNG, so it always falls
back to the sprite renderer regardless of what's in the database.

Fix is a one-line addition — `art_url: sku.art_url,` in the returned object —
but `components/**` is outside this track's lane (AGENT_RULES.md), so I did
not make the edit. Filing here per the lane-boundary rule; `getPublicProfile`
(item 1) shape is unaffected, this is display-only.

---

## Lane boundary flags

- **`app/page.tsx` (create-next-app scaffold) is DELETED — the market grid
  owns `/`.** `app/(market)/page.tsx` resolves to `/`, and route-groups docs
  are explicit that two routes may not resolve to the same path. The scaffold
  page was tracked (all worktrees have it) and belongs to no track's prompt.
  Keeping it breaks `next build` outright. I deleted the scaffold file and the
  browse grid lives at `/` (as instructed). If that was not intended, restore
  `app/page.tsx` from git and re-point the market root.
- `components/card/**` and `components/ui/**` were NOT edited. The grid and
  detail pages adapt the contract's `CardSummary`/`SkuRef`/`ListingRef` shapes
  onto the pure-prop `Card`/`Sku`/`Listing` components via
  `components/market/bridge.ts`, so design-track files stay untouched.
- Nothing in `lib/**` was edited. All reads go through `lib/api/contract.ts`
  except the three workaround reads in `app/(market)/queries.ts` (item 1).
- No writes to tables outside the contract's RPCs. `listCard`, `cancelListing`,
  `redeemCard` are only ever called through the contract.

## Resolved (from earlier shared handoff items)

- Item 8 (contract is server-only): honored — every contract import is in a
  Server Component or a Server Action; client components call the actions.
- Item 8's poll: `OrderPoll` polls the Server Action, not the contract.
- Item 14's placeholder fields: never rendered from an embedded user except
  handle/level; the profile page value comes from `public_profiles` (which 007
  widened) not from `UserSummary.portfolio_value_cents`.

---

# Self-serve listing flow (`/list` + `/dashboard`) — items for track/data

Built the whole front door in this pass (2026-08-13). The **UI is complete**;
four pieces of backend surface block true persistence. Each is filed below
with the EXACT shape this track calls, so granting them is mechanical. Until
they land, `app/(market)/list/actions.ts` + `app/(market)/intake/rpc.ts` call
the RPCs by name through the session client and surface the PostgREST
"function does not exist" (42883) as a clear, honest message — the wizard is
otherwise fully interactive and validated. None of this touches the frozen
contract (`lib/api/contract.ts`); reads always go through it.

### What this pass built (the flow itself)

- `app/(market)/intake/rpc.ts` — server-only seam. Calls the M1/M2/M3 RPCs **by
  name** through `createServerSupabase().rpc(...)` and detects a missing
  function (PostgrestError 42883 / "function … does not exist") as an
  `IntakeUnavailableError` so the UI can say exactly what isn't wired. When
  track/data ships the contract functions, delete this file and import from the
  contract.
- `app/(market)/list/actions.ts` — Server Actions: `getUploadTargetAction`,
  `fileSkuRequestAction`, `submitListingIntakeAction` (server-side validation of
  all six components 0..1 `numeric(3,2)`-exact, https-only photo URLs,
  cash re-gate via `getRedemptions`), `getPayoutEligibilityAction`. These return
  structured `ActionResult` objects (wizard stays put, shows the outcome inline)
  rather than redirecting.
- `app/(market)/list/page.tsx` — server page: streams `getSkus({})` + payout
  eligibility into the wizard.
- `app/(market)/dashboard/page.tsx` — seller dashboard: submissions
  (`getConsignments` consignor), held items (items flattened from
  `getConsignment` details), owed redemptions with a "ship by" deadline
  (M5), and the cash-gate meter.
- `components/market/intake/**` — `intake-config.ts` (angles, six condition
  questions, disclaimer), `SkuPicker`, `SkuRequestForm`, `PhotoUploader`
  (target → PUT → url), `ConditionWizard`, `SelfDeclaredCondition` (amber,
  dashed, SELF-DECLARED, never FloatBar), `PricePayout` (price beside oracle
  value), and `IntakeWizard` (5-step orchestrator, review screen, "in review"
  done state).
- A self-declared float **never** renders like a FlexSoar-graded float: the
  preview is `SelfDeclaredCondition`, visually distinct (amber dashed strip,
  warning copy, no tier colouring), and submission stores answers in
  `items.self_declared`, never the 008 `grade_*` columns.
- Nav: "List" always visible, "Dashboard" and "Profile" when signed in
  (`app/(market)/layout.tsx`).

Verified at 2026-08-12: `next build`, `tsc --noEmit`, `npx eslint`, `npm test`
= 87 passing.

### M1. RESOLVED — intake write path goes through the frozen contract's `submitListing` (013)

Superseded by `docs/handoff/data.md` item 9: 013 already wraps a seller-custody
submission path (`submitListing`, session client, derives the actor from
`auth.uid()`) and it was live-verified there — positive submission lands a
`pending_review` item with `custody=seller`, `grade_source=seller_declared`,
the six component scores set, and `float` equal to the rubric weighted sum.
There was never a need for a bespoke `fn_submit_listing_intake` RPC; the old
`app/(market)/intake/rpc.ts` seam (which called a nonexistent function by
name) is deleted, and `app/(market)/list/actions.ts` now calls `submitListing`
directly. No action needed from track/data on this item.

### M2. "Not listed?" path — `sku_requests` table + `fn_file_sku_request` (BLOCKING)

The picker dead-ends for shoes not in the catalog; the failure mode the task
called out ("file a request rather than dead-ending"). Requested table
(a migration, human's job):

```sql
create table sku_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id),
  brand           text not null,
  model           text not null,
  colorway        text,
  size_us         numeric(4,1),
  notes           text,
  status          text not null default 'open',   -- 'open' | 'reviewed' | 'catalogued'
  created_at      timestamptz not null default now()
);
alter table sku_requests enable row level security;
-- own insert, own read, admin read-all — mirror 009's consignments policies
```

```sql
fn_file_sku_request(
  p_brand text, p_model text, p_colorway text default null,
  p_size_us numeric(4,1) default null, p_notes text default null)
returns uuid
```
session client, `user_id` = `fn_current_user_id()`.

### M3. RESOLVED — presigned photo upload signer, live-verified end to end

`lib/r2/sign.ts` holds the shared signer (`signUploadUrl({ scope, id,
contentType, httpsOnly })`), promoted out of `components/admin/r2.ts`'s
pattern (that file still has its own copy — track/admin's item 10/11 covers
retiring it to re-export from here). `getUploadTargetAction` in
`app/(market)/list/actions.ts` calls it directly: no RPC, no
`fn_get_upload_target`, no `app/(market)/intake/rpc.ts` (deleted). The key is
built entirely server-side as `intake/<userId>/<uuid>.<ext>`; the client
never supplies a filename. `content-type` is restricted to jpeg/png/webp and
size capped at 8MB before signing is even attempted.

**2026-08-13, first pass:** `.env.local` had only the three Supabase vars — no
`R2_*` keys — contradicting that pass's task brief. Filed as a blocker rather
than worked around.

**2026-08-13, same day, after the human added credentials:** confirmed
`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` /
`R2_PUBLIC_URL` are now present. Live-verified with a throwaway Node script
(`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, the project's own
installed deps) that exercised the identical signing config `lib/r2/sign.ts`
uses — same `S3Client` options, same `intake/<userId>/<uuid>.<ext>` key shape
— then performed a real PUT of a 68-byte PNG and a real GET of the resulting
public URL:

- `PUT` to the signed URL → `200 OK`.
- `GET` of the public URL → `200 OK`, `content-type: image/png`,
  `content-length: 68`.
- `OPTIONS` preflight against the R2 endpoint with
  `Origin: http://localhost:3000` → `204`, with
  `Access-Control-Allow-Origin: http://localhost:3000` and
  `Access-Control-Allow-Methods: PUT, GET` — the browser-PUT CORS path (the
  human's dashboard-side item) is also confirmed open for local dev.

Public URL from that probe (a disposable 1x1 PNG, safe to leave or delete):
`https://pub-8be7b83fc3574e138d5f8f7f108a5ed0.r2.dev/intake/live-verification-probe/1b643c4d-d63e-4ddb-a60f-e64ad454d913.png`

The verification script was a scratch file, run and deleted; it never touched
version control. Nothing left in the working tree from this check.

### M4. Payout: credit vs cash, gated on completed fulfilments (PARTIAL)

No payout model exists anywhere in the schema. `getPayoutEligibilityAction`
currently gates **cash** on a local proxy — the seller's own redemptions with
`status='shipped'` via `getRedemptions({ userId })` (a fulfilled shipment on
their account) — and that proxy is flagged in code as pending M4. Please
define the real rule and surface it (a `platform_config` row, or a
`fulfilments` table + RPC). Threshold constant `CASH_FULFILMENT_THRESHOLD = 1`
lives in `app/(market)/queries.ts` (moved there because `'use server'` files
may only export async functions); move it to wherever the real policy lives.
Until then the UI explains why cash is locked instead of hiding it.

### M5. Redemption ship deadline — display only, needs a source

`/dashboard` shows the seller's owed redemptions (`status='requested'`) with a
"ship by" deadline. There is no deadline column. Local constant
`REDEMPTION_SHIP_DEADLINE_HOURS = 72` in `app/(market)/dashboard/page.tsx`
(flagged). A `redemptions.due_at` or platform-config value would retire it.

### M6. Per-SKU float curves for the live estimate

The price step shows "estimated value at your self-declared condition" using
the **linear fallback** of `lib/db/valuation.ts floatMultiplier([], skuId,
float)` because nothing reads a SKU's curve back (admin.md item 4: no
`getFloatCurve`). Once a curve read exists the estimate should use it.