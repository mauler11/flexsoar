'use server';

/**
 * app/(auth)/actions.ts
 *
 * Server Actions behind the auth forms. Magic link is the product flow — there
 * is deliberately no password anywhere in the shipped app, so there is nothing
 * to leak. Email+password sign-in exists as a DEVELOPMENT-ONLY affordance,
 * compiled out unless NEXT_PUBLIC_ENABLE_PASSWORD_AUTH=true is set at build
 * time (see signInWithPassword below).
 *
 * Both sign-in and sign-up call the same Supabase magic-link endpoint. The
 * only difference is `shouldCreateUser`: sign-up may mint a new auth identity,
 * sign-in may not. The `users` row itself is created later, in
 * app/(auth)/callback, once the link is actually clicked — an unclicked link
 * must not leave a half-real account behind. signInWithPassword provisions the
 * same row itself, because there is no callback hop for a password session.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { safeNextPath } from '@/app/(auth)/paths';
import { ensureUserRow } from '@/lib/db/provision';
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
 * Whether password sign-in is compiled in. NEXT_PUBLIC_ vars are inlined at
 * BUILD time, which is exactly the gate we want: a deployment built without
 * NEXT_PUBLIC_ENABLE_PASSWORD_AUTH=true cannot have a password path no matter
 * what the runtime environment says. Keep it off for anything the outside
 * world can reach — there is no password reset and no rate limiting beyond
 * what Supabase's own auth surface applies.
 */
const passwordAuthEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_ENABLE_PASSWORD_AUTH === 'true';

/**
 * DEVELOPMENT-ONLY email+password sign-in, shown on /sign-in only when
 * passwordAuthEnabled(). Same session handling as the magic link: the session
 * cookies are written by the server client, and the `users` row is provisioned
 * with ensureUserRow() on the session that was just established — so 006's
 * users_self_insert policy vets it, exactly as it does in the callback.
 *
 * The gate is checked here as well as in the page, because a Server Action can
 * be POSTed to without ever rendering the form.
 */
export async function signInWithPassword(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? ''));

  if (!passwordAuthEnabled()) {
    redirect(backTo('sign-in', { error: 'Password sign-in is disabled.', next }));
  }

  if (!email || !password) {
    redirect(backTo('sign-in', { error: 'Enter your email and password.', next }));
  }

  const supabase = await createServerSupabase();
  const { error, data } = await supabase.auth.signInWithPassword({ email, password });

  // Verbatim, per AGENT_RULES.md.
  if (error) {
    redirect(backTo('sign-in', { error: error.message, next }));
  }

  const user = data?.user;
  if (!user) {
    redirect(backTo('sign-in', { error: 'Password sign-in returned no user.', next }));
  }

  // First password sign-in creates the users row, exactly as the magic-link
  // callback does; later sign-ins no-op. If provisioning fails, drop the
  // session again rather than landing someone in a half-signed-in app.
  try {
    await ensureUserRow(
      { id: user.id, email: user.email, user_metadata: user.user_metadata },
      supabase,
    );
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    await supabase.auth.signOut();
    redirect(backTo('sign-in', { error: message, next }));
  }

  redirect(next);
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
