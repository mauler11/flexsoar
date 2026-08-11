/**
 * lib/supabase/server.ts
 *
 * Server-side Supabase clients. Two of them, and the difference matters:
 *
 *   createServerSupabase()   the signed-in user's session, read out of the
 *                            request cookies. RLS applies. This is what every
 *                            read in lib/api/contract.ts uses, and what the
 *                            SECURITY DEFINER RPCs are called through.
 *
 *   createServiceSupabase()  the service role key. Bypasses RLS entirely.
 *                            Only three callers exist, all of them without a
 *                            user session by definition: the Stripe webhook
 *                            (purchaseCard), the nightly level job
 *                            (refreshLevels), and first-sign-in user
 *                            provisioning.
 *
 * THE SERVICE ROLE KEY MUST NEVER REACH A CLIENT COMPONENT. Three things keep
 * it out:
 *   1. This module imports `next/headers`, so importing it from a client
 *      component is a build error, not a silent leak.
 *   2. The key is read through a computed `process.env[name]` lookup, which no
 *      bundler can statically inline the way it inlines `process.env.FOO`.
 *   3. createServiceSupabase() throws outright if a `window` exists.
 *
 * Nothing here writes tables directly. Writes go through the RPCs in
 * 002_operations.sql; no table has an INSERT or UPDATE policy.
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/** The client shape both factories return. */
export type ServerSupabaseClient = ReturnType<typeof createServerClient>;

/**
 * Computed lookup on purpose — see the header. Also fails loudly at the call
 * site instead of handing Supabase an `undefined` key and getting a confusing
 * 401 several frames later.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local — see DEPS.md for the full list.`,
    );
  }
  return value;
}

/**
 * The request's user session, backed by cookies.
 *
 * Must be awaited per request and never hoisted into a module-level singleton:
 * `cookies()` is request-scoped, and caching the client across requests would
 * serve one user's session to another.
 */
export async function createServerSupabase(): Promise<ServerSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. Swallowing here is safe
            // *only* because proxy.ts refreshes the session on every visited
            // matched request and writes the rotated cookies there. If that
            // matcher stops covering a route, sessions on it stop refreshing.
          }
        },
      },
    },
  );
}

/**
 * Service role client. Bypasses RLS. No session, no cookies — the empty
 * cookie adapter is what keeps it from picking one up.
 *
 * Call this only from code that provably has no user session: the Stripe
 * webhook, the nightly job, first-sign-in provisioning. If you are reaching
 * for it to "make a query work", the query is being run as the wrong role.
 */
export function createServiceSupabase(): ServerSupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      'createServiceSupabase() was called in the browser. The service role key ' +
        'bypasses RLS and must never leave the server.',
    );
  }

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      cookies: {
        getAll() {
          return [];
        },
        // No setAll: there is no session to persist, and a service-role
        // session is not a thing we ever want written to a cookie.
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
