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
