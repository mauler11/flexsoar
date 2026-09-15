/**
 * lib/auth/handle.ts
 *
 * Client- and route-safe username rules. normalizeUsername MIRRORS
 * normalizeHandle in lib/db/provision.ts (which this track may not edit):
 * lowercase, non-[a-z0-9_] runs fold to one underscore, edge underscores
 * trimmed, max 24 chars, minimum 3 after normalising. If provision's rules
 * ever change, this file must change with them — the server re-normalises
 * anyway, so drift degrades to a confusing preview, never a bad write.
 */

export function normalizeUsername(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
}

/** True when the RAW input is already clean (no silent changes on save). */
export function isCleanUsername(raw: string): boolean {
  return raw.length >= 3 && raw.length <= 24 && normalizeUsername(raw) === raw;
}
