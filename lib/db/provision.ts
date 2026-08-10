/**
 * lib/db/provision.ts
 *
 * Creates the `users` row on first sign-in, and nothing else.
 *
 * This is the one place in the codebase that inserts a row directly rather
 * than going through an RPC, because 002_operations.sql has no
 * fn_create_user() and lib/api/contract.ts is frozen — no function can be
 * added to it. It is called from exactly one place: the auth callback in
 * app/(auth)/callback.
 *
 * ------------------------------------------------------------------
 * WHICH CLIENT, AND WHY IT IS SPLIT
 *
 * The happy path — read yourself, insert yourself — runs on the CALLER'S
 * SESSION, not the service key. 006_users_rls.sql added `users_self_insert`,
 * whose WITH CHECK is `auth_id = auth.uid() and id = auth.uid() and is_admin
 * = false`. Running as the user means the database enforces all three. Under
 * service-role those checks are bypassed, so a bug here could mint an admin;
 * 005's fn_require_admin() would then accept it. Provisioning is the one write
 * a user is allowed to make about themselves, so let the policy police it.
 *
 * One branch still needs the service key and cannot be moved: adopting a
 * pre-existing row that was seeded or imported with `auth_id = null`. That row
 * is invisible to `users_self_read` (null <> auth.uid()), and 006 deliberately
 * ships no UPDATE policy at all, so the session client can neither see it nor
 * link it. It is clearly marked below.
 * ------------------------------------------------------------------
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

import { createServiceSupabase, type ServerSupabaseClient } from '@/lib/supabase/server';
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
 * @param sessionClient the caller's own session, already carrying the verified
 *        credential. Must be signed in — `users_self_insert` checks
 *        `auth.uid()`, so an anonymous client cannot provision anybody.
 * @throws Error when the auth user has no email — `users.email` is not null,
 *         and a magic-link sign-in always has one.
 */
export async function ensureUserRow(
  authUser: AuthUserLike,
  sessionClient: ServerSupabaseClient,
): Promise<ProvisionResult> {
  // Reads its own row through users_self_read (auth_id = auth.uid()).
  const existing = await sessionClient
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

  // ---- SERVICE-ROLE BRANCH, and it has to be ----
  //
  // A row may already exist from a seed or an import, keyed on email and not
  // yet linked to an auth identity. `users_self_read` cannot see it (its
  // auth_id is null, and null <> auth.uid()), and 006 ships no UPDATE policy
  // at all, so the session client can neither find it nor link it.
  //
  // Reached only when the caller has no row of their own, and it never writes
  // anything the session client could not have written: the linked row ends up
  // with id = auth_id = this auth user, which is what users_self_insert would
  // have required anyway.
  const service = createServiceSupabase();

  const byEmail = await service
    .from('users')
    .select('id, handle, auth_id')
    .eq('email', email)
    .maybeSingle();

  if (byEmail.error && byEmail.error.code !== 'PGRST116') {
    throw new Error(`could not read users: ${byEmail.error.message}`);
  }

  if (byEmail.data) {
    const row = byEmail.data as { id: UUID; handle: string; auth_id: UUID | null };

    if (row.auth_id !== null && row.auth_id !== authUser.id) {
      throw new Error(
        `${email} already belongs to a different auth identity (${row.auth_id})`,
      );
    }

    // 004's users_id_matches_auth trigger raises unless id = auth_id, so a row
    // whose id is not this auth user's id cannot be adopted at all — the
    // UPDATE below would be rejected by the database. Say so plainly instead
    // of letting a trigger message surface from three frames down. Renumbering
    // the id is not an option here: it is a primary key half the schema
    // references. See HANDOFF.md.
    if (row.id !== authUser.id) {
      throw new Error(
        `cannot adopt the existing row for ${email}: users.id ${row.id} does not ` +
          `match auth id ${authUser.id}, and users.id must equal auth_id. ` +
          'Delete or renumber that row, or sign in with the account that owns it.',
      );
    }

    if (row.auth_id === null) {
      const linked = await service
        .from('users')
        .update({ auth_id: authUser.id })
        .eq('id', row.id);
      if (linked.error) {
        throw new Error(`could not link auth identity: ${linked.error.message}`);
      }
    }

    return { userId: row.id, handle: row.handle, created: false };
  }

  const seed = seedHandle(authUser);

  for (let attempt = 0; attempt < HANDLE_ATTEMPTS; attempt++) {
    const handle = nthHandle(seed, attempt);

    // Session client, so users_self_insert vets it: id and auth_id must both
    // be auth.uid(), and is_admin must be false. is_admin is left to its
    // column default rather than passed — the policy would reject `true`, and
    // nothing here should ever want to send it.
    const inserted = await sessionClient
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
    const raced = await sessionClient
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
