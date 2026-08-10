'use client';

/**
 * lib/supabase/client.ts
 *
 * The browser Supabase client. Anon key only — it shares the same session
 * cookies the server client reads, so a user signed in on the server is signed
 * in here without a second round trip.
 *
 * What this client is for: auth calls that have to happen in the browser
 * (magic-link request, sign-out) and any realtime subscription a UI track
 * adds later.
 *
 * What it is NOT for: reads and writes. Those go through lib/api/contract.ts,
 * which is server-only. Never call `.from(...).insert()` or a mutation RPC
 * from here — see AGENT_RULES.md.
 *
 * Only NEXT_PUBLIC_* variables are referenced, and they are referenced
 * statically so Next can inline them into the client bundle. Never read
 * SUPABASE_SERVICE_ROLE_KEY from this file.
 */

import { createBrowserClient } from '@supabase/ssr';

export type BrowserSupabaseClient = ReturnType<typeof createBrowserClient>;

let cached: BrowserSupabaseClient | undefined;

/**
 * Memoised per browser tab. `createBrowserClient` is cheap but each instance
 * spins up its own auth-state listener and token refresh timer, so handing out
 * a fresh one per component means duplicate refreshes racing each other.
 */
export function createBrowserSupabase(): BrowserSupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. ' +
        'NEXT_PUBLIC_ variables are inlined at build time — restart `next dev` ' +
        'after editing .env.local.',
    );
  }

  cached = createBrowserClient(url, anonKey);
  return cached;
}
