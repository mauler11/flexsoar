/**
 * lib/sprites/types.ts
 *
 * Shared types for the pixel-art sprite system.
 *
 * A base map is a string[] pixel grid. Every row is the same logical grid of
 * cells; each cell holds one palette key (e.g. 'A', 'B', 'C') or a transparent
 * marker. The renderer resolves each key through the palette at draw time, so
 * one silhouette serves many colourways — the `skus.palette` jsonb column is
 * exactly this char -> hex map.
 */

/**
 * A pixel map: one string per row, top to bottom. Cells are palette keys;
 * '.' (and whitespace) render as transparent.
 */
export type SpriteMap = readonly string[];

/**
 * char -> hex colour. Keys not present in the palette render transparent, so a
 * map may carry detail characters that a given colourway simply omits.
 */
export type SpritePalette = Readonly<Record<string, string>>;

/** Transparent cell marker. Anything not present in the palette is also skipped. */
export const TRANSPARENT = ".";

/** One logical cell of a map. */
export interface SpriteCell {
  row: number;
  col: number;
  key: string;
}
