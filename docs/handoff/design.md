# Handoff — track/design

Items filed by the design track. Numbered within this file.

---

## Open

### 3. Ask for track/market: 20 price-shaped call sites in `components/market/**` and `app/(market)/**` render USD cents through `formatFsc()`/`formatMyr()` — same bug as item 4 below, out of this track's lane

Auditing every call site of `formatFsc()`/`formatMyr()` in the repo while fixing
the market-grid bug (item 4 below): the two formatters in
`components/card/format.ts` are each correct on their own terms — the bug is
almost entirely caller-side, picking the wrong one. Of 26 `formatFsc()` call
sites repo-wide, only 3 format an actual FSC amount (all in
`components/market/BuyPanel.tsx`: the "available FSC" balance, the applied-FSC
leg, and the FSC-only pay button — correctly left alone). The other 23 format
a USD-cents price (a listing price, an oracle value, a sale gross/fee/net, a
redemption/handling fee, a reserve price, or a market price) and should call
`formatUsd()` instead. 5 of those also render `formatMyr()` beneath the price —
AGENT_RULES.md §6 is explicit ringgit is never shown.

This track fixed every instance inside its own lane (`components/card/**`,
`app/styleguide/page.tsx` — see item 4). What's left is entirely
`components/market/**` and `app/(market)/**`, outside this track's paths, so
none of it was touched here:

- `components/market/RedeemForm.tsx:69` — `formatFsc(feeCents)`, the handling
  fee (USD).
- `components/market/ProvenanceChain.tsx:46` — `formatFsc(entry.price_cents)`,
  a trade-history price (USD).
- `components/market/OrderPoll.tsx:79` — `formatFsc(priceCents)`, the settled
  order price (USD).
- `components/market/ListForm.tsx:82` — `formatFsc(oracleValueCents)` +
  `formatMyr(oracleValueCents)`, the oracle value (USD) plus a ringgit figure.
- `components/market/intake/SkuPicker.tsx:109` —
  `formatFsc(sku.market_price_cents)` (USD).
- `components/market/intake/PricePayout.tsx:86,100` — oracle value and live
  condition estimate, both USD.
- `components/market/intake/IntakeWizard.tsx:294` — "Reserve price" (USD).
- `components/market/BuyPanel.tsx:126,129,135` — the listing price rendered as
  `formatFsc` + `formatMyr`, and the oracle value as `formatFsc`. The three
  other calls in this same file (165, 184, 215) are correct — they format an
  actual FSC balance/leg, not a price. Fix only these three, not the file.
- `app/(market)/u/[handle]/page.tsx:142` — trade-history price (USD).
- `app/(market)/dashboard/page.tsx:167` — intake fee (USD).
- `app/(market)/card/[id]/page.tsx:168,318,323,331,332,333` — oracle value,
  listing price, and order gross/fee/net (all USD).

Every one of these is a one-line `formatFsc`→`formatUsd` swap (plus, where
`formatMyr` is also called, deleting that line). `formatMyr()` itself was kept
exported from `components/card/format.ts` rather than deleted, specifically
because these out-of-lane call sites still reference it — deleting it would
have broken `tsc`/`npm run build` for a lane this track cannot fix in the same
pass. Its doc comment now says plainly not to add new callers.

## Resolved / notes for other tracks

### 4. 2026-08-23 — Market-grid bugs: prices in FSC, ringgit shown, numeric float published while the flag is off; `pending_vault` tile treatment added

Three bugs reported live on the market grid (`/`, via `CardTile`) and fixed in
this track's lane only (`components/card/**`, `lib/domain/rarity.ts`,
`app/styleguide/page.tsx`, `tests/invariants.test.ts`). None of
`app/(market)/**`, `lib/api/**`, or `app/api/**` was touched, per the task's
explicit constraint; `components/market/**` findings are filed as item 3
above rather than fixed, since that lane belongs to track/market in practice
even though AGENT_RULES.md's lane table only names `app/(market)/**`
explicitly — flagging the judgment call rather than burying it.

**1. Prices rendering in FSC.** `CardTile.tsx` and `CardDetail.tsx` both
called `formatFsc(value)` on `displayPriceCents()` — a USD-cents value
(`components/card/value.ts`'s `oracleValueCents`/`fn_card_value_cents`
mirror, or a listing's `price_cents`), never an FSC amount. Both now call
`formatUsd()`. See item 3 above for the full repo-wide audit and the 23
misused call sites outside this lane.

**2. Ringgit shown under the price.** `formatMyr(value)` in both files,
removed outright — no replacement, per the task ("Prices are USD only, on
purpose"). `formatMyr()` stays exported from `format.ts` only because
out-of-lane files still call it (item 3); its doc comment now says not to add
new callers.

**3. Numeric float published while `platform_config.show_numeric_float` is
false.** Root cause: nothing in `components/card/**` read the flag at all —
`CardTile` rendered `FloatBar` (the gradient bar + "0.062 FN") and the "PCT
0.00" row unconditionally, regardless of the live config
(`getPlatformConfig().show_numeric_float`, live-verified false per
`lib/api/contract.ts`). Both `CardTile` and `CardDetail` are pure-prop
components ("no fetching, no state" — their own doc comments), so the fix is
an additive `showNumericFloat?: boolean` prop, **defaulting to `false`** — the
live value today — so a caller that hasn't wired the real config still
renders the correct state. When false, a new `ConditionBadge` component
renders instead: the named grade only (Factory New .. Battle-Scarred), no
numeric float, no percentile, sourced from the card's DB-derived
`condition_grade` (018-020) via two new `lib/domain/rarity.ts` exports —
`conditionGradeBand()` and `publishedConditionLabel()` — falling back to
deriving the band from the raw float for rows that predate that migration
(e.g. `lib/mock` fixtures, which don't set `condition_grade`).

**Ask for track/market:** `components/market/MarketTile.tsx` doesn't pass
`showNumericFloat` to `CardTile`, so the grid renders the safe default
(badge-only) regardless of the live config value. To make the flag actually
toggle the UI when an admin flips it, thread `getPlatformConfig().show_numeric_float`
through `app/(market)/page.tsx` → `MarketTile` → `CardTile`. Not fixed here —
`app/(market)/**` is out of lane and `MarketTile.tsx` reads live data.

**4. `pending_vault` tile treatment.** `023a_card_status_pending_vault.sql`
added `'pending_vault'` to the live `card_status` enum; `CardStatus` in
`lib/db/types.ts` (track/data's lane) hasn't caught up (same gap
`BuyPanel`/`card/[id]/page.tsx` hit — see `docs/handoff/market.md`). Used the
same fix as those two: route the comparison through a function whose
*parameter* is typed `CardStatus | "pending_vault"` (`isPendingVault()`,
local to `CardTile.tsx`, TS2367-safe, no cast). When frozen: the `CardArt` is
grayscaled + dimmed with a centered "Vault Pending" badge (`Badge tone="info"`,
blue) over it, the top-right tag switches from "Listed" to "Frozen" (same
blue, not `is_exceptional`'s red — the task is explicit that red means
something else), and the hover-lift transform is suppressed. The tier border
itself is untouched. Not live-verified — no fixture or live seed data
currently has a `pending_vault` card (same gap `docs/handoff/market.md` notes
for the first-sale banner); verified instead with a throwaway
`renderToStaticMarkup` smoke test (not committed) asserting the frozen markup
appears and `#FF4444` (the exceptional red) never does.

**5. FSC-amount formatting audited, not changed.** Checked
`components/market/BuyPanel.tsx`'s "available FSC" balance display and the
"Apply FSC" checkout field (added in `69c7b0c`, both named in the task): both
already call `formatFsc()` correctly (no `$` sign) — nothing to fix there.
The *same file* does misuse `formatFsc`/`formatMyr` for the listing price and
oracle value; that's filed as part of item 3, not fixed here, since it's the
identical out-of-lane question as everything else in that item.

**Files changed:** `components/card/CardTile.tsx`, `components/card/CardDetail.tsx`
(USD price, no MYR, `showNumericFloat` prop + `ConditionBadge`, frozen
`pending_vault` treatment — tile only, per the task); `components/card/ConditionBadge.tsx`
(new); `components/card/format.ts` (doc comments only — no behavioural
change, `formatMyr` kept for out-of-lane callers); `lib/domain/rarity.ts`
(added `conditionGradeBand()`, `publishedConditionLabel()`); `app/styleguide/page.tsx`
(same USD/no-MYR fix, `CardDetail` demo now shows one card at each
`showNumericFloat` value); `tests/invariants.test.ts` (appended two describe
blocks, did not touch existing ones).

**Verification:** `npx tsc --noEmit` clean. `npm run build` compiles
(`Compiled successfully`, all 23 routes render including `/styleguide`).
`npm test`: **143 passing (was 136, +7)** — new coverage: `formatUsd`/`formatFsc`
render distinctly (pins the exact bug this pass fixed), `conditionGradeBand`
maps all five grades, `publishedConditionLabel` prefers `condition_grade` over
a re-derived float band and falls back correctly when it's absent, and never
leaks a numeric float into the label. Smoke-tested in a browser (`npm run
dev`, read-only, fixtures only): `/styleguide`'s Card tiles section shows
`$210.00`/`$435.00`/etc. with no "FSC"/"RM" anywhere, and named-grade badges
("MINIMAL WEAR", "FIELD-TESTED", ...) with no numeric float or PCT; the Card
detail section's two demo cards show the `showNumericFloat=false` (badge
only) and `=true` (full `FloatBar` + PCT) states side by side, both in USD.

**Not verified live:** the `pending_vault` tile (no fixture/seed data has
that status — see item 4 above); whether `platform_config.show_numeric_float`
flipping true actually reaches `CardTile` today (it doesn't — see the "ask"
in item 4, `MarketTile.tsx` needs the wiring, which is out of lane).

### 1. Sprite maps redrawn; MID_TOP added — dimensions changed

The three silhouettes in `lib/sprites/maps.ts` were redrawn from pixel-art
references (2026-08-12). What other tracks need to know:

- **New export**: `MID_TOP`, registered in `SPRITE_MAPS` under the key
  `'mid-top'` and re-exported from `lib/sprites/index.ts` alongside
  `LOW_TOP`/`HIGH_TOP`. A SKU row with `sprite_key = 'mid-top'` now resolves
  via `spriteMapForKey`.
- **Grid dimensions changed** (width x height in cells):
  `HIGH_TOP` 40x26 (was 40x25), `LOW_TOP` 40x18 (was 40x20), `MID_TOP` 40x22.
  All three stay 40 wide, so rendered *widths* at a given `px` are unchanged;
  rendered *heights* differ per silhouette (that has always been possible —
  `spriteSize()` is the source of truth, never a hardcoded height).
- **Palette keys are unchanged** (`D C c B b W I i G` + `.`), as required by
  live `skus.palette` rows. The four exported palettes kept their hex values.
- `maps.ts` now asserts at module load that every row of every map is the
  same width, and throws otherwise — a short row used to truncate the render
  silently.
- `scripts/render-sprite.ts` renders any map x palette to PNGs (zero new
  dependencies; run with plain `node`). Use it to LOOK at a map while editing
  — the file's header documents the loop. Nothing was added to DEPS.md.

### 2. Card art moves to `skus.art_url` (PNG), sprites are the fallback

`CardTile`, `CardDetail`, and the styleguide's `FrameDemo` now render
`sku.art_url` as a plain `<img>` (object-contain) inside a fixed-aspect box
when present, else fall back to the sprite renderer. What other tracks need:

- **Data track**: add an `art_url` column to `skus` (nullable `text`) and
  populate the six fixture SKUs in `lib/mock/fixtures.ts` with hosted
  pixel-art PNG URLs. The `Sku` TS type already carries `art_url?: string | null`.
  Until the column + fixtures land, every card renders the sprite fallback,
  which is the intended behaviour.
- **Schema note**: `lib/api/contract.ts` and `001_schema.sql` are frozen; the
  new column arrives as a new numbered migration owned by track/data.
