/**
 * lib/sprites/render.ts
 *
 * Renders a pixel map into an inline SVG string of <rect> elements at any
 * pixel scale. Adjacent same-colour cells on a row are merged into one rect so
 * the output stays small.
 *
 * The returned string is pure markup built from caller-supplied maps and
 * palettes — no interpolation of arbitrary input, so embedding via
 * dangerouslySetInnerHTML is safe.
 */
import type { SpriteMap, SpritePalette } from "./types";

/** What renderSprite can additionally take, beyond the required triple. */
export interface RenderSpriteOptions {
  /** Accessibility label for the <title>. Omit for decorative-only art. */
  label?: string;
  /** Solid background behind the sprite, or null for transparent. */
  background?: string | null;
}

/**
 * @param map     the pixel grid, top row first.
 * @param palette char -> hex. Unresolved chars render transparent.
 * @param px      CSS pixels per cell. Defaults to 4.
 * @returns an inline <svg> markup string with `shape-rendering="crispEdges"`.
 */
export function renderSprite(
  map: SpriteMap,
  palette: SpritePalette,
  px = 4,
  options?: RenderSpriteOptions,
): string {
  const cell = px > 0 ? Math.floor(px) : 1;
  const width = Math.max(1, ...map.map((row) => row.length)) * cell;
  const height = map.length * cell;

  const rects: string[] = [];
  for (let y = 0; y < map.length; y++) {
    const row = map[y];
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      const fill = palette[key];
      if (fill === undefined) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === key) end++;
      rects.push(
        `<rect x="${x * cell}" y="${y * cell}" width="${(end - x) * cell}" height="${cell}" fill="${fill}"/>`,
      );
      x = end;
    }
  }

  const backgroundRect =
    options?.background != null
      ? `<rect width="${width}" height="${height}" fill="${options.background}"/>`
      : "";

  const title =
    options?.label != null
      ? `<title>${options.label.replace(/[<>&"]/g, "")}</title>`
      : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `shape-rendering="crispEdges" aria-hidden="true">` +
    `${title}${backgroundRect}${rects.join("")}` +
    `</svg>`
  );
}

/** Human-readable dimensions of a map, for layout code. */
export function spriteSize(map: SpriteMap): { width: number; height: number } {
  return {
    width: Math.max(1, ...map.map((row) => row.length)),
    height: map.length,
  };
}
