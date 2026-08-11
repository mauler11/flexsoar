# Handoff — track/admin

Items filed by the admin track. Numbered within this file; where an item
started life in the shared `HANDOFF.md` its old global number is noted, since
008's header cites those numbers.

<<<<<<< HEAD
**Track status: this worktree has not been rebased.** `track/admin` is at
`d14970d`. `gradeItem`, `authenticateItem`, `rejectItem`, `getItems` and
`008_grading.sql` are on `main` and are not here, so the grading Save path, the
grading queue and the mint screen cannot be built or typechecked yet. Rebasing
is the human's call — AGENT_RULES forbids this agent from merging or rebasing.
=======
**Local adapters in play.** `components/admin/db-reads.ts` holds three
session-client READS for gaps itemised below (1, 3, 4). Reads only, RLS-backed,
projected columns, and each dies the day the contract exports the real thing —
they are the sanctioned local-adapter workaround, not a second data path.
No writes bypass the contract anywhere in this track.
>>>>>>> track/admin

---

## Open

<<<<<<< HEAD
### 3. Two small design-system notes

- **`components/ui` has no textarea.** Grading notes and the reject reason both
  need one, so `components/admin/grading` styles a raw `<textarea>` inline to
  match `Input`. It is three utility classes copied; worth promoting to
  `components/ui/Textarea.tsx` before a third screen wants one.
- **The rubric's band anchors are not `FLOAT_BANDS`.** `lib/domain/rarity.ts`
  has the five display bands; `docs/GRADING_RUBRIC.md` has six, splitting
  Factory New into Deadstock (0.000–0.020) and Factory New (0.021–0.070). The
  boundaries otherwise agree. They are duplicated on purpose — one is a grading
  tool, one is marketplace display, and `lib/domain` is not this track's lane —
  but if a boundary ever moves it has to move in `BAND_ANCHORS` too.
=======
### 1. Fulfilment: `fn_mark_shipped` landed (009) — now needs its contract wrappers

009 delivered the admin-read policy and `fn_mark_shipped(p_redemption_id,
p_carrier, p_tracking)`, admin-guarded on the session client. What remains is
contract surface:

- **`markShipped(redemptionId, carrier, tracking)`** wrapping the RPC. Until it
  exists `/admin/fulfilment` is read-only — carrier/tracking entry and the
  "mark shipped" button are built-but-blocked, since writes only go through the
  contract.
- **`getRedemptions({ status? })`** to replace the `getAdminRedemptions()`
  local adapter: id, status, handling_fee_cents, shipping_address, carrier,
  tracking_number, requested_at, shipped_at, card (mint_number, float, sku
  brand/model/size) and requester handle/level via `public_profiles`.

Still worth doing while in there: `redemptions.status` is bare `text` with no
check constraint, unlike every other status column. Constrain it before the
first typo'd status goes in.

### 2. Catalog: 009 unblocked SKU writes at the database — needs contract functions

`skus_admin_write` and `curve_admin_write` exist now, so RLS would permit a
direct table write. Not taking that path: it is exactly the second write path
the contract exists to prevent. `/admin/skus` is read-only until the contract
exports:

- **`createSku(...)` / `updateSku(id, patch)`** — brand/model/colorway/size,
  retail and oracle price cents, price_confidence, sprite_key, palette,
  mint_cap.
- **Float curve writes** — `sku_float_curve` rows per SKU
  (float_min/float_max/value_multiplier).

Two things that belong in the write function, not the UI:

- **`market_price_cents` drives tier.** An edit re-tiers future mints from that
  SKU and leaves existing cards alone (tier copies at mint). 003_retier.sql is
  the record of this going wrong once already; the function should own the
  semantics.
- **`palette` should be validated against the sprite maps** (9-key format, see
  `PALETTES` in `lib/sprites/maps.ts`), or a typo renders a transparent sprite
  in the marketplace with no error anywhere.

### 3. `getItems()` cannot fetch one item

`ItemsQuery` has no `id` filter and there is no `getItem(id)`, so the grading
bench (`/admin/grading/[itemId]`) reads through the `getAdminItem()` local
adapter. Either an `id?: UUID` on `ItemsQuery` or a `getItem(itemId)` retires
it.

### 4. `ItemSummary` has no `consignor_id` or `consignment_id`

Two screens need the links: the mint action must resolve each item's consignor
to pass as `mintCard`'s owner (currently the `getItemOwners()` adapter), and
the grading bench links back to the item's consignment. Both columns exist on
`items` and are admin-readable; adding them to the projection and the type is
additive.

### 5. BUG: `gradeFloatFromComponents()` rounds half-milli ties the wrong way

The helper computes the weighted sum in binary floating point. On exact
half-milli ties the FP product lands just under the tie and `Math.round` goes
DOWN, while `items_grade_components_sum` recomputes in `numeric` and rounds
half AWAY FROM ZERO — so the helper returns a float its own constraint then
rejects. Smallest counterexample:

```
accessories 0.29, everything else 0.00
  numeric:  0.29 × 0.05 = 0.0145 → round(_, 3) = 0.015   ← what the DB demands
  helper:   0.28999… × 0.05 = 0.014499… → ×1000 = 14.499… → 0.014
```

`gradeItem(id, gradeFloatFromComponents(c), …, c)` fails with
GRADE_COMPONENTS_MISMATCH for every such set, deterministically — a sweep of
84,280,662 2dp combinations found 2,522,964 affected (~3%), all ties, all
rounded down.

The comment inside the helper ("Doing this in binary floating point and
rounding at the end matches") is what is wrong. Exact fix, staying in 2dp/
weight space: work in integers —

```ts
// hundredths × integer-percent weights land exactly in ten-thousandths
const tenThousandths =
  Math.round(c.outsole * 100) * 25 + Math.round(c.midsole * 100) * 20 +
  Math.round(c.creasing * 100) * 20 + Math.round(c.upper * 100) * 20 +
  Math.round(c.heel * 100) * 10 + Math.round(c.accessories * 100) * 5;
return Math.round(tenThousandths / 10) / 1000; // .5 rounds up, like numeric
```

Until it lands, `floatForSave()` in `app/admin/grading/actions.ts` applies
exactly this correction on top of the helper, only where the two differ. It is
written to become a no-op and be deleted the day the helper is fixed.

### 6. Two small design-system notes

- **`components/ui` has no textarea.** Grading notes, transition notes and both
  rejection reasons all style a raw `<textarea>` inline to match `Input`. Four
  copies now — promote to `components/ui/Textarea.tsx`.
- **The rubric's band anchors are not `FLOAT_BANDS`.** `lib/domain/rarity.ts`
  has the five display bands; `docs/GRADING_RUBRIC.md` has six, splitting
  Factory New into Deadstock (0.000–0.020) and Factory New (0.021–0.070). The
  boundaries otherwise agree. Duplicated on purpose — one is a grading tool,
  one is marketplace display, and `lib/domain` is not this track's lane — but
  if a boundary ever moves it has to move in `BAND_ANCHORS` too.
>>>>>>> track/admin

---

## Resolved

Kept as a record, since 008's header cites the old numbers.

<<<<<<< HEAD
### ~~1. Fulfilment has no contract surface~~ — landed in 009 + contract

`fn_mark_shipped` and `redemptions_admin_read`/`redemptions_own_read` are in
009_rls_sweep.sql. The contract now exposes, verified live against the project
(positive and negative):

- **`getRedemptions({ status?, userId? })`** → every redemption column plus
  `card` (with its SKU), `item` (id, status, custody_location) and `user` (the
  requester's public profile). Admin sees all, the requester their own, anyone
  else nothing — an empty array means "none you may see". Oldest first.
- **`markShipped(redemptionId, carrier, tracking)`** → session client,
  `fn_require_admin()` inside. Service-role is refused too (no `auth.uid()`).
  A second ship on the same redemption raises `redemption % is already
  shipped`, surfaced as `WRONG_STATUS`; branch on the code.

`redemptions.status` is still unconstrained text — 'requested' and 'shipped'
are the two values that exist in practice. The check constraint suggested
below remains worth a future migration.

### ~~2. No write path for the catalog~~ — landed as RLS policies + contract

009 chose admin **RLS policies** (`skus_admin_write`, `curve_admin_write`)
rather than the `fn_upsert_sku` RPC this item asked for — the policy is the
entire guard, there is no function. The contract wraps them:

- **`upsertSku(input)`** → insert when `id` is absent, update when present;
  returns the full row. On update, a non-admin session writes nothing
  *silently* (RLS filters the row set — no error), so the contract reads back
  and raises `FORBIDDEN` when the row exists but nothing was written. Verified
  live: non-admin insert → 42501, non-admin update → no-op, price unchanged.
- **`setFloatCurve(skuId, bands)`** → replace-all semantics, `[]` clears back
  to the linear fallback. NOT atomic (PostgREST has no transactions): a failed
  insert after the delete leaves the SKU on the linear fallback — a defined
  state — until re-saved. Bands validated client-side (0 ≤ min < max ≤ 1,
  no overlaps) because the table has no constraints.

The two cautions in the original item stand and are now in the contract docs:
`market_price_cents` re-tiers **future mints only**, and `palette` should be
validated against the 9 sprite glyphs before saving (`tests/invariants.test.ts`
shows the check).


### ~~13. No write path for a grade~~ — landed in 008

`fn_grade_item`, `fn_authenticate_item` and `fn_reject_item` all exist, all
session-client with `fn_require_admin()` inside, as requested.

### ~~14. No read path for the grading queue~~ — landed as `getItems()`

### ~~15. The six component scores deserve real columns~~ — landed in 008

Six `numeric(3,2)` columns on `items`, plus the constraint this track asked for
but did not expect to get: `items_grade_components_sum` checks that
`float_value` really is the weighted sum, and `items_grade_components_complete`
that it is all six components or none.

That constraint is the strongest possible version of the rubric rule — the
grader cannot decide the total first and reverse-engineer components to justify
it, because the database will not store it. The JSON-in-`grading_notes` interim
shape described in the old item 15 is dead; nothing was written in it.
=======
### ~~13. No write path for a grade~~ — landed in 008

`fn_grade_item`, `fn_authenticate_item` and `fn_reject_item`, all session-client
with `fn_require_admin()` inside, as requested. Wired up in
`/admin/grading/[itemId]`; the float that reaches `gradeItem()` is derived by
the contract's own `gradeFloatFromComponents()`, and the panel's live preview
(`components/admin/grading/rubric.ts`) is display maths only.

### ~~14. No read path for the grading queue~~ — landed as `getItems()`

The queue at `/admin/grading` runs on it. Single-item fetch is the remaining
gap (open item 3).

### ~~15. The six component scores deserve real columns~~ — landed in 008

Six `numeric(3,2)` columns on `items`, plus `items_grade_components_sum`
(float must equal the weighted sum) and `items_grade_components_complete`
(all six or none). The grading screen branches on both:
`GRADE_COMPONENTS_MISMATCH` and `GRADE_COMPONENTS_INCOMPLETE` each get a
sentence of context on top of the verbatim server message.

### ~~(old item 1 here) Fulfilment had no surface at all~~ — reads landed in 009

Superseded by open item 1: policies and `fn_mark_shipped` exist, wrappers do
not.
>>>>>>> track/admin
