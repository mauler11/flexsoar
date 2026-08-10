/**
 * app/(auth)/magic-link-form.tsx
 *
 * The shared form behind /sign-in and /sign-up.
 *
 * A Server Component on purpose: a form posting to a Server Action needs no
 * client JS, so nothing here is a hydration boundary. AGENT_RULES.md — Server
 * Components by default, "use client" only where interaction requires it.
 *
 * Deliberately unstyled beyond bare layout. components/ui/** belongs to
 * track/design; when Input and Button land, this markup is theirs to replace.
 */

import { requestMagicLink } from '@/app/(auth)/actions';

interface MagicLinkFormProps {
  mode: 'sign-in' | 'sign-up';
  /** The address a link was just sent to, echoed back from the query string. */
  sent?: string;
  /** Server error text, verbatim. */
  error?: string;
  /** Where to land after the link is clicked. Already same-origin checked. */
  next: string;
}

export function MagicLinkForm({ mode, sent, error, next }: MagicLinkFormProps) {
  const isSignUp = mode === 'sign-up';

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">
          {isSignUp ? 'Create an account' : 'Sign in'}
        </h1>
        <p className="text-sm opacity-70">
          We email you a link. No password to forget.
        </p>
      </header>

      {sent ? (
        <p role="status" className="border p-3 text-sm">
          Link sent to <strong>{sent}</strong>. It expires shortly — open it on this
          device to stay signed in here.
        </p>
      ) : null}

      {error ? (
        // Verbatim server text. AGENT_RULES.md: never swallow a server error.
        <p role="alert" className="border p-3 text-sm">
          {error}
        </p>
      ) : null}

      <form action={requestMagicLink} className="flex flex-col gap-4">
        <input type="hidden" name="mode" value={mode} />
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

        {isSignUp ? (
          <label className="flex flex-col gap-1 text-sm">
            Handle <span className="opacity-70">(optional)</span>
            <input
              type="text"
              name="handle"
              maxLength={24}
              pattern="[A-Za-z0-9_]{3,24}"
              autoComplete="username"
              spellCheck={false}
              className="border p-2"
            />
            <span className="text-xs opacity-70">
              3–24 characters, letters, numbers and underscores. Taken handles get a
              number appended; we derive one from your email if you leave this blank.
            </span>
          </label>
        ) : null}

        <button type="submit" className="border p-2 text-sm font-medium">
          {isSignUp ? 'Send sign-up link' : 'Send sign-in link'}
        </button>
      </form>

      <p className="text-sm">
        {isSignUp ? (
          <>
            Already have an account? <a href="/sign-in">Sign in</a>.
          </>
        ) : (
          <>
            No account yet? <a href="/sign-up">Create one</a>.
          </>
        )}
      </p>
    </main>
  );
}
