# Handoff — track/admin

Items filed by the admin track. Numbered within this file; where an item
started life in the shared `HANDOFF.md` its old global number is noted, since
008's header cites those numbers.

**Track status: this worktree has not been rebased.** `track/admin` is at
`d14970d`. `gradeItem`, `authenticateItem`, `rejectItem`, `getItems` and
`008_grading.sql` are on `main` and are not here, so the grading Save path, the
grading queue and the mint screen cannot be built or typechecked yet. Rebasing
is the human's call — AGENT_RULES forbids this agent from merging or rebasing.

---

## Open

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

---

## Resolved

Kept as a record, since 008's header cites the old numbers.

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
