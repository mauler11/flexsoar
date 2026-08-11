/**
 * app/(auth)/sign-in/page.tsx — /sign-in
 *
 * Magic link for an existing account. `shouldCreateUser` is false in the
 * action, so an unrecognised address is rejected rather than quietly
 * registered.
 *
 * When this app is built with NEXT_PUBLIC_ENABLE_PASSWORD_AUTH=true — local
 * development only — an email+password form renders alongside it so dev
 * agents can get a session without an inbox. NEXT_PUBLIC_ vars are inlined at
 * build time, so the form cannot appear in a build that was not made for it.
 */

import { MagicLinkForm } from '@/app/(auth)/magic-link-form';
import { PasswordSignInForm } from '@/app/(auth)/password-sign-in-form';
import { safeNextPath } from '@/app/(auth)/paths';

/** Query strings can repeat a key; take the first and ignore the rest. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Inlined at build time. A deployment built without the flag folder has no
 * password path, whatever its runtime environment claims.
 */
const passwordAuthEnabled =
  process.env.NEXT_PUBLIC_ENABLE_PASSWORD_AUTH === 'true';

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));

  return (
    <div className="flex flex-col gap-8">
      <MagicLinkForm
        mode="sign-in"
        sent={first(params.sent)}
        error={first(params.error)}
        next={next}
      />

      {passwordAuthEnabled ? (
        <PasswordSignInForm error={first(params.error)} next={next} />
      ) : null}
    </div>
  );
}
