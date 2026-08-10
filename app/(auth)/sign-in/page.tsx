/**
 * app/(auth)/sign-in/page.tsx — /sign-in
 *
 * Magic link for an existing account. `shouldCreateUser` is false in the
 * action, so an unrecognised address is rejected rather than quietly
 * registered.
 */

import { MagicLinkForm } from '@/app/(auth)/magic-link-form';
import { safeNextPath } from '@/app/(auth)/paths';

/** Query strings can repeat a key; take the first and ignore the rest. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const params = await searchParams;

  return (
    <MagicLinkForm
      mode="sign-in"
      sent={first(params.sent)}
      error={first(params.error)}
      next={safeNextPath(first(params.next))}
    />
  );
}
