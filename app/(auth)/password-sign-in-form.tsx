/**
 * app/(auth)/password-sign-in-form.tsx
 *
 * DEVELOPMENT-ONLY email+password sign-in, rendered by /sign-in only when
 * NEXT_PUBLIC_ENABLE_PASSWORD_AUTH=true (checked in the page at render time and
 * again inside the Server Action). There is deliberately no password in the
 * shipped product — this exists so dev agents can render the five admin
 * screens, which a magic link cannot unlock for them.
 *
 * The Server Action does the same work the magic-link callback does:
 * signInWithPassword establishes the session cookie, then ensureUserRow()
 * provisions the `users` row on that session, so 006's users_self_insert
 * policy vets it.
 *
 * Same minimal styling as magic-link-form.tsx. components/ui/** belongs to
 * track/design; this markup is theirs to replace.
 */

import { signInWithPassword } from '@/app/(auth)/actions';

interface PasswordSignInFormProps {
  /** Server error text, verbatim. */
  error?: string;
  /** Where to land after sign-in. Already same-origin checked. */
  next: string;
}

export function PasswordSignInForm({ error, next }: PasswordSignInFormProps) {
  return (
    <section className="mx-auto flex w-full max-w-sm flex-col gap-6 border-t pt-8">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Password sign-in</h2>
        <p className="text-sm opacity-70">
          Development only. Compiled in by NEXT_PUBLIC_ENABLE_PASSWORD_AUTH —
          never build with it set for a deployment people can reach.
        </p>
      </header>

      {error ? (
        // Verbatim server text. AGENT_RULES.md: never swallow a server error.
        <p role="alert" className="border p-3 text-sm">
          {error}
        </p>
      ) : null}

      <form action={signInWithPassword} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            spellCheck={false}
            className="border p-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="border p-2"
          />
        </label>

        <button type="submit" className="border p-2 text-sm font-medium">
          Sign in
        </button>
      </form>
    </section>
  );
}