/**
 * components/ui/cn.ts
 *
 * Tiny className joiner. Filters falsy values so callers can conditionally
 * compose Tailwind classes without pulling in a dependency (see DEPS.md).
 */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
