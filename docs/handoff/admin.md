# Handoff — track/admin

Items filed by the admin track. Numbered within this file; where an item
started life in the shared `HANDOFF.md` its old global number is noted, since
008's header cites those numbers.

**Local adapters in play.** `components/admin/db-reads.ts` holds session-client
READS for gaps itemised below (open items 4, 6). Reads only, RLS-backed,
projected columns, and each dies the day the contract exports the real thing —
the sanctioned local-adapter workaround, not a second data path. No writes
bypass the contract anywhere in this track. `getAdminRedemptions` was deleted
the day `getRedemptions()` landed; `getAdminItem` and `getItemOwners` were
deleted the day the sync landed `getItem()` and the `consignor_id` columns —
the promised lifecycle.

---

## Open

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

### 6. No single-row read for a SKU

`getSkus()` is list-only. The edit screen (`/admin/skus/[id]`) loads through
the `getAdminSku()` local adapter. A `getSku(id)` on the contract, or an
`id?: UUID` on `SkusQuery`, retires it.

### 7. `fn_mint_card` does not verify the owner is the consignor

The mint screen's rule is "owner = consignor", and now that `ItemSummary`
carries `consignor_id` the action takes it straight off the item — but nothing
enforces it. `fn_mint_card(p_item_id, p_owner_id)` accepts any owner id; the
database never cross-checks `p_owner_id` against `items.consignor_id`, and the
old `getItemOwners()` adapter at least re-read the column server-side. The
surface is admin-only (`fn_require_admin` inside), so this is not a privilege
bug, but a compromised or buggy client can mint a card to a user who never
consigned the shoe. If the "owner is the consignor" rule matters, it belongs
inside `fn_mint_card` — this screen cannot enforce it and the contract is
frozen.

### 8. Photo count disagrees between two screens on a malformed array

The consignment detail page counts photos with `Array.isArray ? length : 0`;
the grading queue and bench use `toPhotoList()`, which drops malformed entries.
A `photos` array containing a non-string, non-`{url}` element shows N on
`/admin/consignments/[id]` and fewer on `/admin/grading`. Both views should use
`toPhotoList()` so the count is the count of real photos.

### 9. Consignment history shows the actor as a raw UUID

`/admin/consignments/[id]` renders `actor {event.actor_id}`. `public_profiles`
is public and `consignment_events` is already readable by admins, so the actor
could resolve to a handle the way every other embed on the screen does. Display
gap, not a correctness bug.

### 10. Intake photo upload: R2 build is in, but three needs block saving

The upload path now works end to end on this branch: the grading bench has a
`PhotoUploader` that asks `getItemPhotoUploadUrlAction` (in
`app/admin/grading/actions.ts`) for a presigned PUT URL, then PUTs the file
bytes straight to Cloudflare R2 (`components/admin/r2.ts`, config-first). What
still blocks the feature from actually recording photos:

- **R2 environment never exists.** The signer reads `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `R2_PUBLIC_URL`
  (all listed in DEPS.md). None are in `.env.local`; until they are, every
  upload fails with "R2 photo upload is not configured". The build was
  verified by typecheck/build only — there is no way to live-probe R2 without
  credentials.
- **The bucket needs a CORS policy for browser PUTs.** Presigned uploads are
  PUT cross-origin from the app, so R2 must allow `PUT` (and the `Content-Type`
  header) from the app's origin, configured in the Cloudflare dashboard — a
  dashboard change, not code. Until it is set, the PUT fails with an HTTP
  error and the uploader names the policy in its message.
- **`items.photos` has no write path.** This is the one that needs the
  contract: `items` has no UPDATE policy (only the three SELECT policies in
  002/004) and the contract exposes no function that touches photos — every
  items write goes through a security-definer RPC (`fn_mint_card`,
  `fn_grade_item`, …), none of which accept photos. So the uploaded public URL
  cannot be persisted by any code in this track, and the uploader stages
  uploads in local state rather than pretending to save. A `fn_add_item_photos`
  (or similar) RPC with `fn_require_admin()` inside, plus an additive contract
  export, retires the staging and lets the page write `photos` for real.

### 11. SKU art upload: R2 build is in, but `art_url` is missing from the contract

The pixel-art upload now works on this branch the same way the intake photos
do: `ArtUploader` (on `/admin/skus/[id]`) asks `getSkuArtUploadUrlAction` (in
`app/admin/skus/actions.ts`) for a presigned PUT URL, then PUTs the bytes
straight to Cloudflare R2 under `sku-art/<skuId>/` (`components/admin/r2.ts`,
config-first, shared signer with the item photos). Previews of the current art
show on the SKU list and the edit form. Two things stand in the way of a real
save:

- **`skus.art_url` is not on the contract.** The column exists in the live
  database (verified: `select id, art_url` returns it, `null` for seeded
  rows) but there is no migration file for it in `supabase/migrations/`, and
  the contract's `Sku`/`SkuRef` types, `SKU_COLUMNS`/`SKU_REF_COLUMNS`, and
  `UpsertSkuInput` do not carry it. So `getSkus()` cannot return it (the list
  reads through a `getSkuArtUrls()` local adapter overlay — dies the day it
  lands), and `upsertSku()` cannot write it (the form's save drops it
  silently, so the uploader stages rather than fakes the save). **Ask:
  track/data add `art_url: string | null` to `Sku`/`SkuRef`, include it in the
  column projections, and accept it on `UpsertSkuInput`** — `skus_admin_write`
  (009) already lets an admin session write it through `upsertSku`. The
  `getSkuArtUrls()` overlay and the staging note in `ArtUploader` both retire
  the day that lands.
- **A migration for the live `art_url` column is missing from the repo.** The
  column is in the database but no `.sql` file creates it — anyone resetting
  the schema from `supabase/migrations/` loses it. The human needs to add the
  numbered migration (with the https-only check the column appears to carry)
  as part of promoting this.
- **R2 creds + CORS are still the standing needs from item 10.** No
  `R2_*` vars exist in `.env.local` yet; the bucket needs a CORS policy for
  browser PUTs. Until then every upload fails with the config/copy-policy
  message, which is by design.

---

## Resolved

Kept as a record, since 008's header cites the old numbers.

### ~~1. `gradeFloatFromComponents()` half-milli tie bug~~ — fixed by the sync

track/data's 010-era work rewrote the helper in integer arithmetic (now in
`lib/db/grading.ts`, re-exported by the contract; pinned by
`tests/invariants.test.ts`, which grew 77 → 87). `floatForSave()` in
`app/admin/grading/actions.ts` was deleted the same day — it is a no-op on the
integer helper. `RubricPanel`'s client preview and the server action both now
derive the float from the same exact arithmetic as `items_grade_components_sum`.

### ~~2. `getItems()` cannot fetch one item~~ — landed as `getItem()`

`getItem(itemId)` now exists on the contract (RLS-scoped, SKU embed, card_id
lookup). The grading bench reads through it; `getAdminItem()` is deleted.

### ~~3. `ItemSummary` has no `consignor_id` / `consignment_id`~~ — landed

Both columns are on the projection and the type. The mint action takes
`consignor_id` straight off each `ItemSummary` (`MintRequest`), and the grading
bench links back to the consignment from it. `getItemOwners()` is deleted.
See open item 7 for what this exposed.

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

The queue at `/admin/grading` runs on it. Single-item fetch landed as
`getItem()` (resolved item 2).

### ~~15. The six component scores deserve real columns~~ — landed in 008

Six `numeric(3,2)` columns on `items`, plus `items_grade_components_sum`
(float must equal the weighted sum) and `items_grade_components_complete`
(all six or none). The grading screen branches on both codes with a sentence
of context on top of the verbatim server message.
