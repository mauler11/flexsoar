/**
 * app/(auth)/paths.ts
 *
 * Shared by the auth actions and the callback route. A plain module, not a
 * 'use server' one: every export from a 'use server' file becomes a callable
 * server endpoint, and a string helper has no business being one.
 */

/**
 * Only same-origin paths survive. Without this, `?next=https://evil.example`
 * would turn the callback into an open redirect that arrives with a freshly
 * minted session cookie already set.
 */
export function safeNextPath(candidate: string | null | undefined): string {
  if (!candidate) return '/';
  if (!candidate.startsWith('/')) return '/';
  // '//host' and '/\host' are protocol-relative — still off-origin.
  if (/^\/[/\\]/.test(candidate)) return '/';
  return candidate;
}
