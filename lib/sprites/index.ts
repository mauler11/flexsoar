/**
 * lib/sprites/index.ts
 *
 * Public surface for the sprite system: the renderer, the two shipped base
 * maps, and the lookups that connect fixture/SKU rows to maps and palettes.
 *
 * The `skus` table stores `sprite_key` (a base map id) and `palette` (a jsonb
 * char -> hex map). Use spriteMapForKey + paletteFromJson to turn a row into
 * what renderSprite expects. Base maps never change; only the palette does.
 */
import { LOW_TOP } from "./maps/low-top";
import { HIGH_TOP } from "./maps/high-top";
import { renderSprite, spriteSize } from "./render";
import type { SpriteMap, SpritePalette } from "./types";

export { LOW_TOP, HIGH_TOP, renderSprite, spriteSize };
export type { SpriteMap, SpritePalette };
export type { RenderSpriteOptions } from "./render";
export { TRANSPARENT } from "./types";

/** Every shipped base map, keyed by the `skus.sprite_key` value. */
export const SPRITE_MAPS: Readonly<Record<string, SpriteMap>> = {
  "low-top": LOW_TOP,
  "high-top": HIGH_TOP,
} as const;

/** Fallback palette when a row carries none; all three keys resolved to grey. */
export const DEFAULT_PALETTE: SpritePalette = {
  A: "#3a3a3a",
  B: "#1c1c1c",
  C: "#9a9a9a",
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
