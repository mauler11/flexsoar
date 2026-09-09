/**
 * app/(market)/consignor/connect/return/page.tsx
 *
 * Where Stripe sends the consignor after onboarding (return_url in
 * createConnectAccount). Refreshes the live account status from Stripe and
 * shows whether payouts are enabled yet. The account.updated webhook also
 * lands the same state on the user row — this page is the synchronous
 * confirmation, the webhook is the durable one.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { currentUserId } from "@/app/(market)/queries";
import { createServerSupabase } from "@/lib/supabase/server";
import { updateConnectAccountStatus } from "@/lib/api/contract";

export const metadata: Metadata = {
  title: "Payout setup — FlexSoar Market",
};

export default async function ConnectReturnPage() {
  const me = await currentUserId();
  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight">
          Payout setup
        </h1>
        <p className="font-mono text-[11px] tracking-tight text-muted">
          Sign in to check your payout status.{" "}
          <Link href="/sign-in" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  const supabase = await createServerSupabase();
  const { data: user } = await supabase
    .from("users")
    .select("stripe_connect_account_id")
    .eq("id", me)
    .maybeSingle();

  const accountId = (user as { stripe_connect_account_id: string | null } | null)
    ?.stripe_connect_account_id;

  if (!accountId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight">
          Payout setup
        </h1>
        <p className="font-mono text-[11px] tracking-tight text-muted">
          No Connect account found. Start from the dashboard.{" "}
          <Link href="/dashboard" className="text-accent hover:underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    );
  }

  let status: {
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    onboardingComplete: boolean;
  } | null = null;
  let statusError: string | null = null;
  try {
    const full = await updateConnectAccountStatus(accountId);
    status = {
      chargesEnabled: full.chargesEnabled,
      payoutsEnabled: full.payoutsEnabled,
      onboardingComplete: full.onboardingComplete,
    };
  } catch (err) {
    statusError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-extrabold tracking-tight">
        Payout setup
      </h1>
      {statusError ? (
        <p className="font-mono text-[11px] tracking-tight text-[#FF4444]">
          Could not check Stripe status: {statusError}. The webhook will still
          update your account when onboarding completes.{" "}
          <Link href="/dashboard" className="text-accent hover:underline">
            Back to dashboard
          </Link>
        </p>
      ) : status?.onboardingComplete ? (
        <p className="font-mono text-[11px] tracking-tight text-green-500">
          Payouts enabled — your Stripe account is ready.{" "}
          <Link href="/dashboard" className="text-accent hover:underline">
            Back to dashboard
          </Link>
        </p>
      ) : (
        <p className="font-mono text-[11px] tracking-tight text-muted">
          Onboarding not complete yet (charges:{" "}
          {status?.chargesEnabled ? "enabled" : "pending"}, payouts:{" "}
          {status?.payoutsEnabled ? "enabled" : "pending"}). Finish
          Stripe&apos;s remaining steps, then come back.{" "}
          <Link href="/dashboard" className="text-accent hover:underline">
            Back to dashboard
          </Link>
        </p>
      )}
    </div>
  );
}
