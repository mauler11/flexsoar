/**
 * components/card/Sprite.tsx
 *
 * React wrapper over lib/sprites/renderSprite. Takes a base map + palette and
 * renders the inline SVG at a given pixel scale.
 *
 * Pure props only — no fetching, no state.
 */
import { renderSprite } from "@/lib/sprites";
import type { SpriteMap, SpritePalette } from "@/lib/sprites";
import { cn } from "@/components/ui/cn";

export interface SpriteProps {
  map: SpriteMap | null | undefined;
  palette: SpritePalette | null | undefined;
  /** CSS pixels per cell. Defaults to 4. */
  px?: number;
  /** Accessibility label. Omit for purely decorative art. */
  label?: string;
  /** Solid background colour behind the art, or null for transparent. */
  background?: string | null;
  className?: string;
}

export function Sprite({
  map,
  palette,
  px = 4,
  label,
  background,
  className,
}: SpriteProps) {
  if (!map) return null;
  const svg = renderSprite(map, palette ?? {}, px, { label, background });
  return (
    <span
      className={cn("inline-block leading-none", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
