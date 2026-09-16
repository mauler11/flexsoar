/**
 * app/(market)/payouts/page.tsx
 *
 * Payouts: Stripe Connect onboarding plus the linked USDC payout wallet —
 * the payout footprint moved off the seller dashboard (which had grown too
 * full), now its own page below Dashboard in the sidebar.
 *
 * Data:
 *   - Payout setup       stored Connect status (webhook-landed columns, 028);
 *                        the live check runs on /consignor/connect/return and
 *                        via the account.updated webhook. Never pre-mints an
 *                        onboarding link: account links expire, so the link is
 *                        minted on button click (PayoutSetup POSTs to
 *                        /api/consignor/connect).
 *   - USDC payout wallet users.solana_address — the ONLY seller-side link path.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentUserId } from "@/app/(market)/queries";
import { PayoutSetup } from "@/components/market/PayoutSetup";
import { EmbeddedLinkButton } from "@/components/market/EmbeddedWalletSection";
import { EmptyState } from "@/components/ui/EmptyState";

async function getConnectStatus(userId: string): Promise<{
  accountId: string | null;
  payoutsEnabled: boolean;
  isConsignor: boolean;
  countryCode: string | null;
  solanaAddress: string | null;
}> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("users")
    .select(
      "stripe_connect_account_id, stripe_connect_payouts_enabled, is_consignor, country_code, solana_address",
    )
    .eq("id", userId)
    .maybeSingle();
  const row = (data ?? {}) as {
    stripe_connect_account_id?: string | null;
    stripe_connect_payouts_enabled?: boolean | null;
    is_consignor?: boolean | null;
    country_code?: string | null;
    solana_address?: string | null;
  };
  return {
    accountId: row.stripe_connect_account_id ?? null,
    payoutsEnabled: row.stripe_connect_payouts_enabled ?? false,
    isConsignor: row.is_consignor ?? false,
    countryCode: row.country_code ?? null,
    solanaAddress: row.solana_address ?? null,
  };
}

export const metadata: Metadata = {
  title: "Payouts — FlexSoar Market",
};

export default async function PayoutsPage() {
  const me = await currentUserId();
  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Payouts</h1>
        <EmptyState
          title="Sign in to manage payouts"
          description="Your Stripe Connect payout setup and USDC payout wallet show up here once you're signed in."
        />
      </div>
    );
  }

  const connectStatus = await getConnectStatus(me);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Payouts</h1>
          <p className="text-sm text-muted">
            Where your sale proceeds go
          </p>
        </div>
      </div>

      {/* Connect Payout Setup */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold tracking-tight text-foreground">
          Payout setup
        </h2>
        <PayoutSetup
          accountId={connectStatus.accountId}
          payoutsEnabled={connectStatus.payoutsEnabled}
          isConsignor={connectStatus.isConsignor}
          countryCode={connectStatus.countryCode}
        />
      </section>

      {/* USDC payout wallet — the ONLY seller-side link path. Sellers never
          see the buy panel on their own listings, so without this section a
          seller whose listings the quote path rejects ("seller has no linked
          payout wallet yet") has nowhere to fix it. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold tracking-tight text-foreground">
          USDC payout wallet
        </h2>
        {connectStatus.solanaAddress ? (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-muted">
              Linked {connectStatus.solanaAddress.slice(0, 8)}…
              {connectStatus.solanaAddress.slice(-6)} — USDC sale proceeds go
              here (95% seller / 5% FlexSoar, split on-chain).
            </p>
            <EmbeddedLinkButton cta="Change payout wallet" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-muted">
              No wallet linked — your listings can&apos;t be bought with USDC
              until you link one. One signature proves you own it.
            </p>
            <EmbeddedLinkButton cta="Link payout wallet" />
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted">
        <Link href="/dashboard" className="text-accent hover:underline">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}