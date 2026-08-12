# Handoff — track/design

Items filed by the design track. Numbered within this file.

---

## Open

_(none)_

## Resolved / notes for other tracks

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
