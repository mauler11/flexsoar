/**
 * components/card/CardArt.tsx
 *
 * The card's image area. Renders the uploaded pixel-art PNG on `sku.art_url`
 * when present; otherwise falls back to the sprite renderer. Either way the
 * art lives in a fixed-aspect-ratio box and is contained (never clipped), so
 * the rarity frame stays square and a sprite can't overflow the top of the
 * tile's image area.
 *
 * Uses a plain <img> deliberately: card art lives on an external host, and
 * next/image would need that host allow-listed in next.config.ts. See
 * components/admin/grading/PhotoViewer.tsx for the same call. The sprite
 * fallback is contained the same way — off-screen "meet" via the SVG viewBox
 * instead of object-fit.
 */
import type { Sku } from "@/lib/db/types";
import {
  DEFAULT_PALETTE,
  paletteFromJson,
  spriteMapForKey,
} from "@/lib/sprites";
import { cn } from "@/components/ui/cn";
import { Sprite } from "./Sprite";

export interface CardArtProps {
  sku: Sku;
  /** Fixed aspect ratio of the art box. */
  aspect?: string;
  /** Base pixel scale for the sprite fallback. */
  px?: number;
  className?: string;
}

export function CardArt({ sku, aspect = "aspect-[3/2]", px = 6, className }: CardArtProps) {
  const map = spriteMapForKey(sku.sprite_key);
  const palette = paletteFromJson(sku.palette) ?? DEFAULT_PALETTE;

  return (
    <div className={cn("relative w-full overflow-hidden bg-[#050505]", aspect, className)}>
      {sku.art_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- external host; see header
        <img
          src={sku.art_url}
          alt={`${sku.brand} ${sku.model} ${sku.colorway}`}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <Sprite
          map={map}
          palette={palette}
          px={px}
          className="block h-full w-full [&_svg]:h-full [&_svg]:w-full"
        />
      )}
    </div>
  );
}