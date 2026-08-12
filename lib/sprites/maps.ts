// lib/sprites/maps.ts
//
// Hand-drawn silhouettes. Each map is a string[] on a 40-wide grid,
// rendered left-facing (toe at left, heel/collar at right):
//
//   HIGH_TOP  40x26    MID_TOP  40x22    LOW_TOP  40x18
//
// Iterate with scripts/render-sprite.ts — render to PNG, look, fix, repeat.
//
// Palette characters:
//   .  transparent      D  outline
//   C  body             c  body shadow
//   B  overlay panel    b  overlay shadow
//   W  midsole          I  outsole      i  outsole shadow
//   G  lace accent
//
// Design notes, if you edit these:
//   - Every silhouette edge needs a D. Without a hard outline the shape
//     dissolves against the #0B0B0B card background.
//   - Diagonals step in 2-3px jumps, not 1. Single-pixel stairs read as
//     a downscaled photo rather than as pixel art.
//   - Keep the palette at 9 colours. More shading steps push it toward
//     realism and away from the collectible look.
//   - Test at px=2 (thumbnail). If the toe box vanishes, the map is
//     carrying too much detail for the size it's used at.

import type { SpriteMap, SpritePalette } from "./types";

/**
 * Every row of a map must be the same width — a short row silently truncates
 * the render. Called at module load for each exported map; throws on drift.
 */
function assertUniformWidth(name: string, map: SpriteMap): void {
  const width = map[0]?.length ?? 0;
  for (let i = 0; i < map.length; i++) {
    if (map[i].length !== width) {
      throw new Error(
        `sprite map ${name}: row ${i} is ${map[i].length} cells wide, expected ${width}`,
      );
    }
  }
}

export const HIGH_TOP: string[] = [
  '.................DDDDDDDDDDDDDDDDD......',
  '................DCCBBBBBBBBBBBBBBbD.....',
  '................DCGGBBBBBBBBBBBBBbbD....',
  '..............DDCCBBBBBBBBBBBBBBBbbD....',
  '..............DCGGBBBBBBBBBBBBBBBbbD....',
  '..............DCCCBBBBBBBBBBBBBBBbbD....',
  '............DDGGBBDDDDDDDDDDDDDDDbbD....',
  '............DCCCBBCCCCCCCCCCCCCCCbbD....',
  '............DCGGBBCCCCCCCCCCCCCCCbbD....',
  '..........DDCCBBCCCCCCCCCCCCCCCCCbbD....',
  '..........DCGGBBCCCCCCCCCCCCCCCCCbbD....',
  '..........DCCCBBCCCCCCCCCCCCCCCCCbbD....',
  '..........DCCCCCCCCCCCCCCCCCDDDCDBbD....',
  '.......DDDCCCCCCCCCCCCCCCCDDDDDCDBbD....',
  '.....DDBBBbCCCCCCCCCCCCCDDDDDDCDBBbD....',
  '...DDBBBBBbCCCCCCCCCCDDDDDDDDCCDBBbD....',
  '..DBbBbBbBbCCCCCCDDDDDDDDDDCCCCDBBbD....',
  '.DBBBBBBBBbCDDDDDDDDDDDDDCCCCCCDBBbD....',
  '.DBBBBBBBBbCDDDDDDDDDDCCCCCCCCCDBBbD....',
  '.DBBBBBBBBbCDDDDDDCCCCCCCCCCCCCDBBbD....',
  '.DbbbbbbbbcccccccccccccccccccccbbbbD....',
  '.DWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWD..',
  'DWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWD..',
  'DIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIID..',
  'DiiIiiIiiIiiIiiIiiIiiIiiIiiIiiIiiIiiID..',
  '.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD...',
]

export const LOW_TOP: string[] = [
  '.........................DDDDDDDDDD.....',
  '........................DCCBBBBBBbD.....',
  '......................DDCGGBBBBBBbbD....',
  '...................DDDCCGGBBCCDBBBbD....',
  '................DDDCCGGBBCCCCCDBBBbD....',
  '.............DDDCCGGBBCCCCCDDCDBBBbD....',
  '...........DDCCGGBBCCCCCCDDDDCDBBBbD....',
  '........DDDCCCCCCCCCCCCCDDDDDCDBBBbD....',
  '.....DDDBbCCCCCCCCCCCDDDDDDCCCDBBBbD....',
  '..DDDBBBBbCCCCCCCDDDDDDDDDCCCCDBBBbD....',
  '.DBbBbBbBbCCCCDDDDDDDDCCCCCCCCDBBBbD....',
  '.DBBBBBBBbCCCCDDDDCCCCCCCCCCCCDBBBbD....',
  '.DbbbbbbbbccccccccccccccccccccbbbbbD....',
  '.DWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWD..',
  'DWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWD..',
  'DIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIID..',
  'DiiIiiIiiIiiIiiIiiIiiIiiIiiIiiIiiIiiID..',
  '.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD...',
]

export const MID_TOP: string[] = [
  '...................DDDDDDDDDDDDDDD......',
  '..................DCCBBBBBBBBBBBBbD.....',
  '..................DCGGBBBBBBBBBBBbbD....',
  '................DDCCBBBBBBBBBBBBBbbD....',
  '................DCGGBBDDDDDDDDDDDbbD....',
  '..............DDCCBBCCCCCCCCCCCCCbbD....',
  '..............DCGGBBCCCCCCCCCCCCCbbD....',
  '............DDCCBBCCCCCCCCCCCCCCCbbD....',
  '............DCGGBBCCCCCCCCCCDDDCDBbD....',
  '..........DCCCCCCCCCCCCCCCCDDDDCDBbD....',
  '.......DDDCCCCCCCCCCCCCCDDDDDDCDBBbD....',
  '.....DDBBBbCCCCCCCCCCDDDDDDDDCCDBBbD....',
  '...DDBBBBBbCCCCCCDDDDDDDDDDCCCCDBBbD....',
  '..DBBBBBBBbCDDDDDDDDDDDDCCCCCCCDBBbD....',
  '.DBBbBbBbBbCDDDDDDDDDCCCCCCCCCCDBBbD....',
  '.DBBBBBBBBbCDDDDDCCCCCCCCCCCCCCDBBbD....',
  '.DbbbbbbbbcccccccccccccccccccccbbbbD....',
  '.DWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWD..',
  'DWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWD..',
  'DIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIID..',
  'DiiIiiIiiIiiIiiIiiIiiIiiIiiIiiIiiIiiID..',
  '.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD...',
]

// Sail / university blue — the AJ1 colourway from the design reference.
export const PALETTE_SAIL_BLUE: SpritePalette = {
  D: '#16202E',
  C: '#F2EBDD',
  c: '#DCD2BE',
  B: '#A9CBE8',
  b: '#7FAAD0',
  W: '#FAF6EE',
  I: '#9ED8E8',
  i: '#7CBBD0',
  G: '#1F7A4D',
}

export const PALETTE_CHICAGO: SpritePalette = {
  D: '#1A1214',
  C: '#F4F1EA',
  c: '#DAD5CB',
  B: '#C8202E',
  b: '#9A1622',
  W: '#FAF7F0',
  I: '#2B2226',
  i: '#1A1417',
  G: '#1A1417',
}

// Every value steps up off the #0B0B0B card. A true-black outline is darker
// than the card and takes the silhouette edge with it, so D is the lightest
// dark here, not the darkest — the shoe reads as tonal black, not a hole.
export const PALETTE_TRIPLE_BLACK: SpritePalette = {
  D: '#2B2B2E',
  C: '#5E5E63',
  c: '#4A4A4F',
  B: '#3E3E43',
  b: '#333338',
  W: '#74747A',
  I: '#2A2A2E',
  i: '#202024',
  G: '#85858B',
}

export const PALETTE_GUM: SpritePalette = {
  D: '#2B1E14',
  C: '#EFE7D8',
  c: '#D6CCBA',
  B: '#6B4A2E',
  b: '#513623',
  W: '#F3EDE1',
  I: '#B07A3E',
  i: '#8C5F2E',
  G: '#3E2A18',
}

assertUniformWidth("HIGH_TOP", HIGH_TOP);
assertUniformWidth("MID_TOP", MID_TOP);
assertUniformWidth("LOW_TOP", LOW_TOP);

export const SPRITE_MAPS: Record<string, SpriteMap> = {
  'low-top': LOW_TOP,
  'mid-top': MID_TOP,
  'high-top': HIGH_TOP,
}

export const PALETTES: Record<string, SpritePalette> = {
  sail_blue: PALETTE_SAIL_BLUE,
  chicago: PALETTE_CHICAGO,
  triple_black: PALETTE_TRIPLE_BLACK,
  gum: PALETTE_GUM,
}

export type PaletteKey = keyof typeof PALETTES
