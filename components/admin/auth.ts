/**
 * components/admin/auth.ts
 *
 * The server-side `is_admin` re-check every admin page and Server Action runs.
 *
 * WHY THIS EXISTS WHEN middleware.ts ALREADY GATES /admin: that gate is
 * optimistic. The Next docs are explicit that proxy/middleware is not the
 * authorisation boundary, and it does not run on a Server Action invoked from
 * an already-loaded page — so an action reached from a page a user still has
 * open is not covered by it at all (docs/HANDOFF-shared.md item 7).
 *
 * It is not the last line of defence either. `fn_require_admin()` enforces
 * admin inside the transaction for every mutation this track calls (005, 008).
 * This check exists so the operator gets a 404 or a sentence instead of a raw
 * Postgres refusal — not because the database would otherwise let it through.
 *
 * SERVER ONLY. It reaches lib/api/contract.ts. Importing it from a client
 * component is a build error, by design.
 */

import { notFound, redirect } from "next/navigation";
import { getUser, type User } from "@/lib/api/contract";
import { createServerSupabase } from "@/lib/supabase/server";

export type AdminCheck =
  | { ok: true; user: User }
  | { ok: false; reason: "unauthenticated" | "forbidden" };

/**
 * Resolves the signed-in user and whether they are an admin.
 *
 * `auth.getUser()` revalidates the token against Supabase rather than trusting
 * the cookie, which is the difference that matters here.
 */
export async function checkAdmin(): Promise<AdminCheck> {
  const supabase = await createServerSupabase();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return { ok: false, reason: "unauthenticated" };

  const user = await getUser({ authId: authUser.id });
  if (!user?.is_admin) return { ok: false, reason: "forbidden" };

  return { ok: true, user };
}

/**
 * Page guard. Signed out goes to sign-in and comes back; signed in without
 * admin gets a 404 rather than a 403 — an admin console should not confirm its
 * own routes exist to someone who cannot use them.
 */
export async function requireAdminPage(nextPath: string): Promise<User> {
  const check = await checkAdmin();
  if (check.ok) return check.user;
  if (check.reason === "unauthenticated") {
    redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  }
  notFound();
}

/**
 * Server Action guard. Throws rather than redirecting: an action returns its
 * failure to the caller for display, and a redirect mid-action would swallow
 * the reason. Callers catch this and surface the message verbatim.
 */
export async function requireAdminAction(): Promise<User> {
  const check = await checkAdmin();
  if (check.ok) return check.user;
  throw new Error(
    check.reason === "unauthenticated"
      ? "not signed in"
      : "admin privileges required",
  );
}
