'use server';

/**
 * app/(auth)/actions.ts
 *
 * Server Actions behind the auth forms. Magic link only — there is no
 * password anywhere in this app, so there is no password to leak.
 *
 * Both sign-in and sign-up call the same Supabase endpoint. The only
 * difference is `shouldCreateUser`: sign-up may mint a new auth identity,
 * sign-in may not. The `users` row itself is created later, in
 * app/(auth)/callback, once the link is actually clicked — an unclicked link
 * must not leave a half-real account behind.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { safeNextPath } from '@/app/(auth)/paths';
import { createServerSupabase } from '@/lib/supabase/server';

type AuthMode = 'sign-in' | 'sign-up';

/**
 * Where Supabase should send the user back to. Must also be listed in the
 * project's Redirect URLs allow-list or Supabase rejects it — see HANDOFF.md.
 */
async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');

  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
  if (!host) {
    throw new Error(
      'cannot determine the site origin: no Host header and NEXT_PUBLIC_SITE_URL is unset',
    );
  }
  const proto = headerList.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

function backTo(mode: AuthMode, params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  return `/${mode}?${search.toString()}`;
}

/**
 * Emails a magic link. Called by the sign-in and sign-up forms.
 *
 * Redirects back to the form either way, carrying the outcome in the query
 * string — that keeps both pages Server Components with no client JS.
 */
export async function requestMagicLink(formData: FormData): Promise<void> {
  const mode: AuthMode = formData.get('mode') === 'sign-up' ? 'sign-up' : 'sign-in';
  const email = String(formData.get('email') ?? '').trim();
  const handle = String(formData.get('handle') ?? '').trim();
  const next = safeNextPath(String(formData.get('next') ?? ''));

  if (!email) {
    redirect(backTo(mode, { error: 'Enter your email address.', next }));
  }

  const origin = await siteOrigin();
  const callback = new URL('/callback', origin);
  callback.searchParams.set('next', next);

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callback.toString(),
      // Sign-in must not silently create an account for a typo'd address.
      shouldCreateUser: mode === 'sign-up',
      // Read back in the callback by lib/db/provision.ts. Only a preference:
      // the handle is still uniqued and normalised there.
      ...(mode === 'sign-up' && handle ? { data: { handle } } : {}),
    },
  });

  // Verbatim, per AGENT_RULES.md. Note that on sign-in this does disclose
  // whether an address is registered — flagged in HANDOFF.md.
  if (error) {
    redirect(backTo(mode, { error: error.message, next }));
  }

  redirect(backTo(mode, { sent: email, next }));
}

/**
 * Clears the session cookies and returns to the home page.
 *
 * Exposed both here (for `<form action={signOut}>`) and as a POST route at
 * /sign-out. Never a GET: a link prefetch would sign the user out.
 */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signOut();

  if (error) {
    redirect(backTo('sign-in', { error: error.message }));
  }

  redirect('/');
}
