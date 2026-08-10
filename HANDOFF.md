## Handoff requests

### Design track → data track — fixture palettes need re-keying

`lib/sprites` now ships the 40-wide maps with 9-key palettes
(`D C c B b W I i G`). The `skus.palette` JSON in `lib/mock/fixtures.ts` still
holds the old 3-key A/B/C format, so `paletteFromJson` resolves only `C` and
`B` against the new maps and every fixture-driven sprite (CardTile, CardDetail,
styleguide rarity frames) renders mostly transparent. Re-key the six fixture
palettes to the 9-key format — the four shipped palettes are the reference, see
`PALETTES` in `lib/sprites/maps.ts`.
