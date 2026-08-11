# Handoff — track/admin

Items filed by the admin track. Numbered within this file; where an item
started life in the shared `HANDOFF.md` its old global number is noted, since
008's header cites those numbers.

**Local adapters in play.** `components/admin/db-reads.ts` holds session-client
READS for gaps itemised below (open items 2, 3, 4). Reads only, RLS-backed,
projected columns, and each dies the day the contract exports the real thing —
the sanctioned local-adapter workaround, not a second data path. No writes
bypass the contract anywhere in this track. `getAdminRedemptions` was deleted
the day `getRedemptions()` landed, as promised.

---

## Open

### 1. BUG, STILL LIVE: `gradeFloatFromComponents()` rounds half-milli ties down

**Reported fixed alongside the 009 contract surface; it is not.** The body is
byte-identical to the one 896afb5 introduced — binary-FP products, then
`Math.round(total * 1000) / 1000` — and `git log -S` shows no integer-space
version ever landed on main.

The failure: on exact half-milli ties the FP product lands just under the tie
and rounds DOWN, while `items_grade_components_sum` recomputes in `numeric`
and rounds half AWAY FROM ZERO — the helper returns a float its own constraint
rejects. Smallest counterexample:

```
accessories 0.29, everything else 0.00
  numeric:  0.29 × 0.05 = 0.0145 → round(_, 3) = 0.015   ← what the DB demands
  helper:   0.28999… × 0.05 = 0.014499… → ×1000 = 14.499… → 0.014
```

`gradeItem(id, gradeFloatFromComponents(c), …, c)` fails with
GRADE_COMPONENTS_MISMATCH for every such set, deterministically — a sweep of
84,280,662 2dp combinations found 2,522,964 affected (~3%), all ties, all
rounded down. The comment inside the helper ("Doing this in binary floating
point and rounding at the end matches") is the part that is wrong.

Exact fix, staying in 2dp/weight space — work in integers:

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
written to become a no-op and be deleted the day the helper is fixed — please
say so in this file when it is, and it goes.

### 2. `getItems()` cannot fetch one item

`ItemsQuery` has no `id` filter and there is no `getItem(id)` — unchanged by
the 009 contract extension. The grading bench (`/admin/grading/[itemId]`)
still reads through the `getAdminItem()` local adapter. Either an `id?: UUID`
on `ItemsQuery` or a `getItem(itemId)` retires it.

### 3. `ItemSummary` has no `consignor_id` or `consignment_id`

Unchanged by the 009 extension. The mint action resolves each item's consignor
to pass as `mintCard`'s owner (the `getItemOwners()` adapter), and the grading
bench links back to the item's consignment. Both columns exist on `items` and
are admin-readable; adding them to the projection and the type is additive.

### 4. No read path for a SKU's float curve

`setFloatCurve()` writes the curve; nothing reads one back. The curve editor
on `/admin/skus/[id]` has to show the current bands before it can edit them,
so it reads through a `getSkuFloatCurve()` local adapter (public `curve_read`
policy, 009). A `getFloatCurve(skuId)` on the contract retires it —
`fn_card_value_cents` already proves the projection.

### 5. Two small design-system notes

- **`components/ui` has no textarea.** Grading notes, transition notes and both
  rejection reasons all style a raw `<textarea>` inline to match `Input`.
  Promote to `components/ui/Textarea.tsx`.
- **The rubric's band anchors are not `FLOAT_BANDS`.** `lib/domain/rarity.ts`
  has the five display bands; `docs/GRADING_RUBRIC.md` has six, splitting
  Factory New into Deadstock (0.000–0.020) and Factory New (0.021–0.070). The
  boundaries otherwise agree. Duplicated on purpose — one is a grading tool,
  one is marketplace display, and `lib/domain` is not this track's lane — but
  if a boundary ever moves it has to move in `BAND_ANCHORS` too.

---

## Resolved

Kept as a record, since 008's header cites the old numbers.

### ~~Fulfilment has no contract surface~~ — landed in 009 + contract

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
are the two values that exist in practice. The check constraint suggested in
the original item remains worth a future migration.

`/admin/fulfilment` now lists on `getRedemptions()` and ships on
`markShipped()`.

### ~~No write path for the catalog~~ — landed as RLS policies + contract

009 chose admin **RLS policies** (`skus_admin_write`, `curve_admin_write`)
rather than the `fn_upsert_sku` RPC the original item asked for — the policy is
the entire guard, there is no function. The contract wraps them:

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

`/admin/skus` now creates and edits on `upsertSku()`/`setFloatCurve()`, and
the SKU form surfaces `FORBIDDEN` ("row exists, session may not write it")
distinctly from `NOT_FOUND` ("no such row").

### ~~13. No write path for a grade~~ — landed in 008

`fn_grade_item`, `fn_authenticate_item` and `fn_reject_item`, all session-client
with `fn_require_admin()` inside. Wired up in `/admin/grading/[itemId]`.

### ~~14. No read path for the grading queue~~ — landed as `getItems()`

The queue at `/admin/grading` runs on it. Single-item fetch is the remaining
gap (open item 2).

### ~~15. The six component scores deserve real columns~~ — landed in 008

Six `numeric(3,2)` columns on `items`, plus `items_grade_components_sum`
(float must equal the weighted sum) and `items_grade_components_complete`
(all six or none). The grading screen branches on both codes with a sentence
of context on top of the verbatim server message.
