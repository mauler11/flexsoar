// lib/sprites/maps.ts
//
// Hand-drawn silhouettes. Each map is a string[] on a 40-wide grid,
// rendered left-facing (toe at left, heel/collar at right).
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

export const HIGH_TOP: string[] = [
  '........................................',
  '.......................DDDDDDDDDDDDD....',
  '......................DBbBBBBBBBBBBBD...',
  '......................DBBBBBBBBBBBBBD...',
  '.....................DBBBBBBBBBBBBBbD...',
  '.....................DBBBBBBBBBBBBBbD...',
  '................DDDDDDCCCCCCCCBBBBBbD...',
  '............DDDDDCCCCCCCCCCCCCBBBBBbD...',
  '.........DDDDCCCCCGCCCCCCCCCCCBBBBBbD...',
  '.......DDCCCCCCCCGGCCCCCCCCCCCBBBBBbD...',
  '......DCCCCCCCCCGGCCCCCCCCCCCCCBBBBbD...',
  '.....DCCCCCCCCCGGCCCCCCCCCCCCCCCBBBbD...',
  '....DCCCCCCCCCGGCCCCCCCCCBBBBBBBBBBBD...',
  '...DBBBCCCCCCGGCCCCCCCCBBBBBBBBBBBBBD...',
  '...DBBBBCCCCCGGCCCCCCBBBBBBBBBBBBBBbD...',
  '..DBBBBBBCCCCGGCCCCBBBBBBBBBBBBBBCCbD...',
  '..DBBBBBBBCCCCCCCCCCCCCCCCCCCCBBBBBbD...',
  '..DBBBBBBBBCCCCCCCCCCCCCCCCCCCCCCBBBD...',
  '..DcCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCcD..',
  '..DcccccccccccccccccccccccccccccccccccD.',
  '.DWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWD.',
  '.DWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWD.',
  '.DIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIID.',
  '.DiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiD.',
  '..DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD..',
]

export const LOW_TOP: string[] = [
  '........................................',
  '........................................',
  '...................DDDDDDDDDDDDDDDD.....',
  '...............DDDDDCCCCCCCCCCCBBBBD....',
  '..........DDDDDCCCCCCCCCCCCCCCCBBBBD....',
  '.......DDDCCCCCCGCCCCCCCCCCCCCCBBBBD....',
  '.....DDCCCCCCCCGGCCCCCCCCCCCCCCBBBBD....',
  '....DCCCCCCCCCGGCCCCCCCCCCCCCCCCBBBD....',
  '...DCCCCCCCCCGGCCCCCCCCCBBBBBBBBBBBD....',
  '...DBBBCCCCCGGCCCCCCCCBBBBBBBBBBBBBD....',
  '..DBBBBCCCCGGCCCCCCCBBBBBBBBBBBBBBbD....',
  '..DBBBBBCCCGGCCCCCBBBBBBBBBBBBBBCCbD....',
  '..DBBBBBBCCCCCCCCCCCCCCCCCCCCBBBBBbD....',
  '..DcCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCBbD...',
  '..DccccccccccccccccccccccccccccccccD....',
  '.DWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWD...',
  '.DWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWD...',
  '.DIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIID...',
  '.DiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiD...',
  '..DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD...',
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

export const PALETTE_TRIPLE_BLACK: SpritePalette = {
  D: '#000000',
  C: '#2A2A2A',
  c: '#1E1E1E',
  B: '#3D3D3D',
  b: '#2E2E2E',
  W: '#242424',
  I: '#141414',
  i: '#0C0C0C',
  G: '#4A4A4A',
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

export const SPRITE_MAPS: Record<string, SpriteMap> = {
  'low-top': LOW_TOP,
  'high-top': HIGH_TOP,
}

export const PALETTES: Record<string, SpritePalette> = {
  sail_blue: PALETTE_SAIL_BLUE,
  chicago: PALETTE_CHICAGO,
  triple_black: PALETTE_TRIPLE_BLACK,
  gum: PALETTE_GUM,
}

export type PaletteKey = keyof typeof PALETTES
