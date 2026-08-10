/**
 * lib/db/provision.ts
 *
 * Creates the `users` row on first sign-in, and nothing else.
 *
 * This is the one place in the codebase that inserts a row directly rather
 * than going through an RPC, because 002_operations.sql has no
 * fn_create_user() and lib/api/contract.ts is frozen — no function can be
 * added to it. It runs on the service-role client, server-side only, and is
 * called from exactly one place: the auth callback in app/(auth)/callback.
 *
 * ------------------------------------------------------------------
 * LOAD-BEARING: users.id IS SET TO THE SUPABASE AUTH USER ID.
 *
 * Every RLS policy in 001_schema.sql compares a users.id-valued column
 * against auth.uid():
 *
 *   ledger_own_read     account_id = auth.uid()
 *   orders_own_read     buyer_id = auth.uid() or seller_id = auth.uid()
 *   listings_visibility seller_id = auth.uid()
 *
 * auth.uid() is the auth user's id, so those arms only ever match if
 * users.id equals it. `users.id` defaults to gen_random_uuid(); taking the
 * default would leave every one of those policies permanently false, which
 * silently breaks order visibility and the whole early-access window.
 *
 * So: id and auth_id are both set to the auth user id. Any other way of
 * creating users — a seed script, a manual insert — MUST do the same.
 * See HANDOFF.md.
 * ------------------------------------------------------------------
 */

import { createServiceSupabase } from '@/lib/supabase/server';
import type { UUID } from '@/lib/db/types';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** How many handle suffixes to try before giving up. */
const HANDLE_ATTEMPTS = 25;

export interface AuthUserLike {
  id: UUID;
  email?: string | null;
  /** `options.data` from signInWithOtp — carries the handle chosen at sign-up. */
  user_metadata?: { handle?: unknown } | null;
}

export interface ProvisionResult {
  userId: UUID;
  handle: string;
  /** False when the row already existed. */
  created: boolean;
}

/**
 * citext unique, so case folds. Keep it to characters that survive a URL
 * unescaped — handles end up in /u/[handle].
 */
function normalizeHandle(candidate: string): string {
  return candidate
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
}

/**
 * The handle to try first: what they typed at sign-up, else the local part of
 * their email. `user` is the floor so a pathological address still yields
 * something insertable.
 */
function seedHandle(authUser: AuthUserLike): string {
  const chosen = authUser.user_metadata?.handle;
  if (typeof chosen === 'string') {
    const normalized = normalizeHandle(chosen);
    if (normalized.length >= 3) return normalized;
  }

  const local = (authUser.email ?? '').split('@')[0] ?? '';
  const normalized = normalizeHandle(local);
  return normalized.length >= 3 ? normalized : 'user';
}

/**
 * Deterministic, never random: AGENT_RULES.md rules out RNG anywhere in this
 * codebase, and a collided handle is a naming problem, not a dice roll.
 */
function nthHandle(seed: string, attempt: number): string {
  if (attempt === 0) return seed;
  const suffix = String(attempt + 1);
  return `${seed.slice(0, 24 - suffix.length)}${suffix}`;
}

/**
 * Idempotent: safe to call on every sign-in, not just the first.
 *
 * @throws Error when the auth user has no email — `users.email` is not null,
 *         and a magic-link sign-in always has one.
 */
export async function ensureUserRow(authUser: AuthUserLike): Promise<ProvisionResult> {
  const supabase = createServiceSupabase();

  const existing = await supabase
    .from('users')
    .select('id, handle')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (existing.error && existing.error.code !== 'PGRST116') {
    throw new Error(`could not read users: ${existing.error.message}`);
  }
  if (existing.data) {
    const row = existing.data as { id: UUID; handle: string };
    return { userId: row.id, handle: row.handle, created: false };
  }

  const email = authUser.email?.trim();
  if (!email) {
    throw new Error(
      `auth user ${authUser.id} has no email; users.email is not null and cannot be defaulted`,
    );
  }

  // A row may already exist from a seed or an earlier import, keyed on email
  // and not yet linked to an auth identity. Link it rather than colliding on
  // the unique email index.
  const byEmail = await supabase
    .from('users')
    .select('id, handle, auth_id')
    .eq('email', email)
    .maybeSingle();

  if (byEmail.error && byEmail.error.code !== 'PGRST116') {
    throw new Error(`could not read users: ${byEmail.error.message}`);
  }

  if (byEmail.data) {
    const row = byEmail.data as { id: UUID; handle: string; auth_id: UUID | null };

    if (row.auth_id === null) {
      const linked = await supabase
        .from('users')
        .update({ auth_id: authUser.id })
        .eq('id', row.id);
      if (linked.error) {
        throw new Error(`could not link auth identity: ${linked.error.message}`);
      }
    }

    // Deliberately not rewriting row.id: it is a primary key other tables
    // reference. If it differs from the auth id, the RLS arms described in the
    // header stay false for this user. Loud, because it is not recoverable
    // from here — see HANDOFF.md.
    if (row.id !== authUser.id) {
      console.warn(
        `[provision] users.id ${row.id} != auth id ${authUser.id} for ${email}. ` +
          'RLS policies comparing to auth.uid() will not match for this user.',
      );
    }

    return { userId: row.id, handle: row.handle, created: false };
  }

  const seed = seedHandle(authUser);

  for (let attempt = 0; attempt < HANDLE_ATTEMPTS; attempt++) {
    const handle = nthHandle(seed, attempt);

    const inserted = await supabase
      .from('users')
      .insert({ id: authUser.id, auth_id: authUser.id, handle, email })
      .select('id, handle')
      .maybeSingle();

    if (!inserted.error && inserted.data) {
      const row = inserted.data as { id: UUID; handle: string };
      return { userId: row.id, handle: row.handle, created: true };
    }

    if (inserted.error?.code !== UNIQUE_VIOLATION) {
      throw new Error(`could not create user: ${inserted.error?.message ?? 'no row returned'}`);
    }

    // A concurrent callback for the same auth user won the race on the
    // auth_id/email unique index — their row is the one that counts.
    const raced = await supabase
      .from('users')
      .select('id, handle')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (raced.data) {
      const row = raced.data as { id: UUID; handle: string };
      return { userId: row.id, handle: row.handle, created: false };
    }

    // Otherwise it was the handle that collided. Try the next one.
  }

  throw new Error(
    `could not find a free handle for ${email} after ${HANDLE_ATTEMPTS} attempts`,
  );
}
