/**
 * app/(auth)/callback/route.ts — GET /callback
 *
 * Where the emailed link lands. Turns the one-time credential into a session
 * cookie, then creates the `users` row if this is the first sign-in.
 *
 * Two credential shapes are accepted, because which one Supabase sends
 * depends on the email template configured in the project:
 *
 *   ?token_hash=...&type=magiclink   the current template, verified with
 *                                    verifyOtp()
 *   ?code=...                        the PKCE template, exchanged with
 *                                    exchangeCodeForSession()
 *
 * Handling both means the flow works whichever template is in place. See
 * HANDOFF.md for the template snippet.
 *
 * The session cookies are written by the client's `setAll` through
 * next/headers, and Next attaches them to this handler's response.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { safeNextPath } from '@/app/(auth)/paths';
import { ensureUserRow } from '@/lib/db/provision';
import { createServerSupabase } from '@/lib/supabase/server';

/** The `type` values Supabase sends for an email credential. */
const OTP_TYPES = [
  'email',
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
] as const;

type OtpType = (typeof OTP_TYPES)[number];

function asOtpType(value: string | null): OtpType | null {
  return OTP_TYPES.includes(value as OtpType) ? (value as OtpType) : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));

  const back = (message: string): NextResponse =>
    NextResponse.redirect(
      new URL(
        `/sign-in?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`,
        url.origin,
      ),
    );

  // Supabase reports a refused or expired link here rather than as a failed
  // exchange. Pass its own words through.
  const providerError =
    url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (providerError) return back(providerError);

  const supabase = await createServerSupabase();

  const tokenHash = url.searchParams.get('token_hash');
  const otpType = asOtpType(url.searchParams.get('type'));
  const code = url.searchParams.get('code');

  let authUserId: string | null = null;
  let authEmail: string | null = null;
  let authMetadata: { handle?: unknown } | null = null;

  if (tokenHash && otpType) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (error) return back(error.message);
    authUserId = data.user?.id ?? null;
    authEmail = data.user?.email ?? null;
    authMetadata = data.user?.user_metadata ?? null;
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return back(error.message);
    authUserId = data.user?.id ?? null;
    authEmail = data.user?.email ?? null;
    authMetadata = data.user?.user_metadata ?? null;
  } else {
    return back('This sign-in link is missing its token. Request a new one.');
  }

  if (!authUserId) {
    return back('The link verified but returned no user. Request a new one.');
  }

  // First sign-in creates the users row; every later sign-in no-ops. If this
  // throws, the session cookie is already set but the app has no users row to
  // hang anything on, so send them back rather than into a half-signed-in app.
  try {
    await ensureUserRow({
      id: authUserId,
      email: authEmail,
      user_metadata: authMetadata,
    });
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    await supabase.auth.signOut();
    return back(message);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
