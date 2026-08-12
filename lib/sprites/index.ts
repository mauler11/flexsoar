/**
 * lib/sprites/index.ts
 *
 * Public surface for the sprite system: the renderer, the two shipped base
 * maps, the four shipped colourways, and the lookups that connect fixture/SKU
 * rows to maps and palettes.
 *
 * The `skus` table stores `sprite_key` (a base map id) and `palette` (a jsonb
 * char -> hex map). Use spriteMapForKey + paletteFromJson to turn a row into
 * what renderSprite expects. Base maps never change; only the palette does.
 */
import { LOW_TOP, MID_TOP, HIGH_TOP, SPRITE_MAPS, PALETTES } from "./maps";
import { renderSprite, spriteSize } from "./render";
import type { SpriteMap, SpritePalette } from "./types";

export { LOW_TOP, MID_TOP, HIGH_TOP, SPRITE_MAPS, PALETTES, renderSprite, spriteSize };
export type { SpriteMap, SpritePalette };
export type { RenderSpriteOptions } from "./render";
export type { PaletteKey } from "./maps";
export { TRANSPARENT } from "./types";

/** Fallback palette when a row carries none; every key resolved to grey. */
export const DEFAULT_PALETTE: SpritePalette = {
  D: "#1A1A1A",
  C: "#9A9A9A",
  c: "#7A7A7A",
  B: "#5C5C5C",
  b: "#454545",
  W: "#EDECE7",
  I: "#3A3A3A",
  i: "#2E2E2E",
  G: "#262626",
};

/** A base map by its sprite_key, or null when the key is unknown. */
export function spriteMapForKey(key: string | null | undefined): SpriteMap | null {
  if (!key) return null;
  return SPRITE_MAPS[key] ?? null;
}

/**
 * Coerce a `skus.palette` jsonb value into a SpritePalette. Non-object or
 * non-string values are dropped; a row with no usable palette returns null so
 * callers can substitute DEFAULT_PALETTE themselves.
 */
export function paletteFromJson(json: unknown): SpritePalette | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(json)) {
    if (typeof value === "string" && value.startsWith("#")) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
