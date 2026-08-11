/**
 * components/admin/grading/photos.ts
 *
 * `items.photos` is jsonb with no schema behind it. The intake fixtures write
 * `[{ url, angle }]`; tolerate bare strings too and drop anything else rather
 * than crash the queue over one malformed row. Pure, client-safe.
 */

import type { Json } from "@/lib/db/types";

export interface ItemPhoto {
  url: string;
  /** 'toe', 'lateral', … or a positional fallback. */
  label: string;
}

export function toPhotoList(photos: Json): ItemPhoto[] {
  if (!Array.isArray(photos)) return [];

  const list: ItemPhoto[] = [];
  for (const [index, entry] of photos.entries()) {
    if (typeof entry === "string") {
      list.push({ url: entry, label: `photo ${index + 1}` });
      continue;
    }
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const url = (entry as { url?: unknown }).url;
      const angle = (entry as { angle?: unknown }).angle;
      if (typeof url === "string") {
        list.push({
          url,
          label: typeof angle === "string" ? angle : `photo ${index + 1}`,
        });
      }
    }
  }
  return list;
}
