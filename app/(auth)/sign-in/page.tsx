/**
 * app/(auth)/sign-in/page.tsx — /sign-in
 *
 * Unified auth form with tabs for sign-in/sign-up, Google OAuth,
 * magic link, and optional password auth (development only).
 */

import { AuthForm } from "@/components/auth/AuthForm";
import { safeNextPath } from "@/app/(auth)/paths";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));

  return <AuthForm mode="sign-in" next={next} />;
}
