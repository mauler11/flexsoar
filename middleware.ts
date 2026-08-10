/**
 * middleware.ts
 *
 * Two jobs, in this order:
 *   1. Refresh the Supabase session on every matched request and write the
 *      rotated cookies onto the response.
 *   2. Keep non-admins out of /admin.
 *
 * WHY (1) IS NOT OPTIONAL: a Server Component cannot set cookies, so the
 * `setAll` in lib/supabase/server.ts is a no-op there by design. This file is
 * the only place the rotated access token gets persisted. If a route stops
 * matching the matcher below, sessions on it stop refreshing and users get
 * signed out when the token expires.
 *
 * Session refresh needs its own Supabase client rather than
 * createServerSupabase(): that one reads `next/headers`, which is not
 * available here. Middleware reads and writes cookies through the request and
 * response objects instead.
 *
 * DEPRECATION: Next.js 16 renamed this file convention to `proxy.ts` (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 * `middleware.ts` still works and is what this track was scoped to own, so the
 * rename is left for the human running `npx @next/codemod middleware-to-proxy .`
 * — logged in HANDOFF.md.
 *
 * THE /admin GATE IS A FIRST PASS, NOT THE AUTHORISATION BOUNDARY. The Next
 * docs are explicit that proxy/middleware is for optimistic checks, not full
 * authorisation. Admin pages must re-check `is_admin` server-side themselves.
 * Also in HANDOFF.md, for track/admin.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Prefixes gated on users.is_admin. */
const ADMIN_PREFIX = '/admin';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See DEPS.md.`);
  return value;
}

/** Carries the refreshed session cookies onto a response we are replacing. */
function withCookiesFrom(source: NextResponse, target: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Update the request copy first so anything reading cookies later in
          // this pass sees the new values, then rebuild the response around it.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Nothing may run between creating the client and this call. getUser()
  // revalidates the token with Supabase and triggers the refresh that writes
  // the cookies above; code in between can read a stale session or, worse,
  // return a response built before the refresh landed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!request.nextUrl.pathname.startsWith(ADMIN_PREFIX)) {
    return response;
  }

  if (!user) {
    const signIn = new URL('/sign-in', request.url);
    signIn.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return withCookiesFrom(response, NextResponse.redirect(signIn));
  }

  const { data, error } = await supabase
    .from('users')
    .select('is_admin')
    .eq('auth_id', user.id)
    .maybeSingle();

  // Fails closed. A signed-in user with no users row, or a query that errors,
  // is not an admin.
  const isAdmin = !error && (data as { is_admin: boolean } | null)?.is_admin === true;

  if (!isAdmin) {
    return withCookiesFrom(response, NextResponse.redirect(new URL('/', request.url)));
  }

  return response;
}

export const config = {
  /**
   * Everything except static assets and the Stripe webhook.
   *
   * The webhook is excluded because it authenticates with a Stripe signature
   * over the raw body, not a session — running a session refresh on it is pure
   * latency on a path Stripe retries.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
