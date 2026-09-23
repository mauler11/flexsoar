/**
 * app/(market)/dashboard/page.tsx
 *
 * Retired as a surface: the profile (u/[handle]) absorbed the seller
 * sections (collection with visibility toggles, submissions, redemptions,
 * P/L). This route bounces signed-in users to their own profile and
 * signed-out visitors to sign-in, so every existing link keeps working.
 */
import { redirect } from "next/navigation";
import { getUser } from "@/lib/api/contract";
import { currentUserId } from "@/app/(market)/queries";

export default async function DashboardPage() {
  const me = await currentUserId();
  if (!me) redirect("/sign-in?next=/dashboard");
  const user = await getUser({ id: me }).catch(() => null);
  redirect(user ? `/u/${user.handle}` : "/market");
}
