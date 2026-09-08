/**
 * app/(market)/consignor/connect/refresh/page.tsx
 *
 * Where Stripe sends the consignor when an onboarding link expires
 * (refresh_url in createConnectAccount). Mints a fresh link and redirects
 * straight to Stripe — same as pressing "Set up payouts" again.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUserId } from "@/app/(market)/queries";
import { ContractError, createConnectAccount } from "@/lib/api/contract";

export default async function ConnectRefreshPage() {
  const me = await currentUserId();
  if (!me) {
    redirect("/sign-in?next=/dashboard");
  }

  try {
    const link = await createConnectAccount(me);
    redirect(link.onboardingUrl);
  } catch (err) {
    const message =
      err instanceof ContractError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-mono text-xl font-black uppercase tracking-tight">
          Payout setup
        </h1>
        <p className="font-mono text-[11px] tracking-tight text-[#FF4444]">
          Could not refresh your Stripe link: {message}.{" "}
          <Link href="/dashboard" className="text-accent hover:underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    );
  }
}
