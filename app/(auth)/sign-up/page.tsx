/**
 * app/(auth)/sign-up/page.tsx — /sign-up
 *
 * Unified auth form with tabs for sign-in/sign-up, Google OAuth,
 * magic link, and optional password auth (development only).
 */

import { AuthForm } from "@/components/auth/AuthForm";
import { safeNextPath } from "@/app/(auth)/paths";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));

  return <AuthForm mode="sign-up" next={next} />;
}
