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

### 1. Fulfilment has no contract surface at all — blocks `app/admin/fulfilment`

`redemptions` is written once, by `fn_redeem_card`, and never read or updated
again. The table already carries everything the screen needs:

```
id, card_id, item_id, user_id, handling_fee_cents, shipping_address jsonb,
status text default 'requested', carrier, tracking_number,
requested_at, shipped_at
```

Nothing exposes it. `getRedemptions()` and a `fn_mark_shipped` are both
missing, so the admin screen cannot list a single request, let alone ship one.

Needed:

- **`getRedemptions({ status? })`** → id, status, handling fee, shipping
  address, requested_at, carrier, tracking, plus the card's sku and mint number
  and the requesting user's handle. There is no admin read policy on
  `redemptions` either (004 was written before this screen existed), so this
  needs an `redemptions_admin_read` policy alongside it.
- **`fn_mark_shipped(p_redemption_id, p_carrier, p_tracking)`** setting
  `carrier`, `tracking_number`, `shipped_at = now()`, `status = 'shipped'`, and
  moving `items.status` from `redemption_hold` to `shipped`. Session client
  with `fn_require_admin()` inside, like 005 and 008 — same reasoning.

Note `redemptions.status` is a bare `text` with no check constraint and no
enum, unlike every other status column in the schema. Worth constraining to
`('requested','shipped','cancelled')` — whatever the real set is — in the same
migration, before the first row goes in with a typo.

### 2. No write path for the catalog — blocks `app/admin/skus`

`getSkus()` reads; nothing creates or updates. The screen is specified as CRUD
over oracle price, float curve, `sprite_key` and `palette` JSON, and none of
those can be written.

Needed: `createSku()` / `updateSku()` over an `fn_upsert_sku`, admin-guarded
the same way. Two things the RPC should own rather than the UI:

- **`market_price_cents` drives tier**, so an edit re-tiers every future mint
  from that SKU. 003_retier.sql exists because this already had to be fixed
  once. The function should say plainly what it does to existing cards
  (nothing — tier is copied at mint) and what it does to future ones.
- **`palette` JSON is validated against the sprite maps**, or a typo'd key
  renders a transparent sprite in the marketplace with no error anywhere. See
  the design→data note in `docs/HANDOFF-shared.md`; the 9-key format is the
  reference.

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
