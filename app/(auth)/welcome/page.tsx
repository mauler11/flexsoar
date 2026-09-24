/**
 * app/(auth)/welcome/page.tsx — /welcome?next=
 *
 * Post-confirmation username claim for brand-new accounts. The callback
 * (email/Google) and the dev password action send freshly provisioned
 * users here instead of straight onward, so the @username is picked AFTER
 * the email is confirmed — a modal step could never survive the email hop.
 * Claiming is optional ("skip for now" keeps the provisioned handle);
 * returning users never land here (provision reports created:false).
 */
import { redirect } from "next/navigation";

import { safeNextPath } from "@/app/(auth)/paths";
import { createServerSupabase } from "@/lib/supabase/server";
import { WelcomeForm } from "@/components/auth/WelcomeForm";

export const metadata = {
  title: "Choose your username — FlexSoar",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next)) || "/";

  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/sign-in?next=${encodeURIComponent(`/welcome?next=${encodeURIComponent(next)}`)}`);

  const { data } = await supabase
    .from("users")
    .select("handle")
    .eq("id", auth.user.id)
    .maybeSingle();
  const handle = (data as { handle?: string } | null)?.handle ?? null;
  // No users row (shouldn't happen — provision runs before this page) :
  // don't trap anyone, send them onward.
  if (!handle) redirect(next);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-sm flex-col justify-center gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight">Claim your username</h1>
        <p className="text-[11px] text-muted">
          Email confirmed — last step. This is your public @handle.
        </p>
      </header>
      <WelcomeForm currentHandle={handle} next={next} />
      <a
        href={next}
        className="text-center text-xs text-muted transition hover:text-foreground"
      >
        Skip for now
      </a>
    </main>
  );
}
