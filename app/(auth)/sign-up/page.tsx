/**
 * app/(auth)/sign-up/page.tsx — /sign-up
 *
 * Same magic link as /sign-in, with `shouldCreateUser` true and an optional
 * handle. The `users` row is not written here: it is written in
 * app/(auth)/callback once the emailed link is actually clicked, so an
 * abandoned sign-up leaves nothing behind.
 */

import { MagicLinkForm } from '@/app/(auth)/magic-link-form';
import { safeNextPath } from '@/app/(auth)/paths';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  const params = await searchParams;

  return (
    <MagicLinkForm
      mode="sign-up"
      sent={first(params.sent)}
      error={first(params.error)}
      next={safeNextPath(first(params.next))}
    />
  );
}
