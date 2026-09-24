/**
 * app/(market)/payouts/page.tsx
 *
 * Payouts: seller balance first, Stripe Connect onboarding only at the point
 * of withdrawal (progressive onboarding — asking for bank KYC before a user
 * has ever sold kills conversion). The Connect section stays available but
 * quiet until there is money to cash out.
 *
 * Data:
 *   - Balance            settled, unpaid, cash-method orders where the caller
 *                        is the seller (orders_own_read covers seller_id =
 *                        auth.uid()); split into available (clearing hold
 *                        elapsed) vs clearing. Defensive: any query failure
 *                        renders zeros, never an error state.
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

function formatRm(cents: number): string {
  return `RM ${(cents / 100).toFixed(2)}`;
}

async function getPayoutOverview(userId: string): Promise<{
  availableCents: number;
  clearingCents: number;
  hasUnpaidSales: boolean;
}> {
  const fallback = { availableCents: 0, clearingCents: 0, hasUnpaidSales: false };
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("orders")
      .select("net_cents, payout_release_at")
      .eq("seller_id", userId)
      .eq("status", "settled")
      .eq("paid_out", false)
      .eq("seller_payout", "cash");
    if (error || !data) return fallback;
    const now = Date.now();
    let availableCents = 0;
    let clearingCents = 0;
    for (const o of data as {
      net_cents: number | null;
      payout_release_at: string | null;
    }[]) {
      const cents = o.net_cents ?? 0;
      if (o.payout_release_at && Date.parse(o.payout_release_at) <= now) {
        availableCents += cents;
      } else {
        clearingCents += cents;
      }
    }
    return { availableCents, clearingCents, hasUnpaidSales: data.length > 0 };
  } catch {
    return fallback;
  }
}

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
  const overview = await getPayoutOverview(me);
  const connected =
    connectStatus.payoutsEnabled && connectStatus.accountId != null;
  // Progressive onboarding: the Connect wall only becomes the hero when
  // there is actually money waiting to cash out.
  const cashoutReady = !connected && overview.availableCents > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Payouts</h1>
          <p className="text-sm text-muted">
            Sell first, cash out when you&apos;re ready — proceeds release
            after the 7-day clearing hold once the vault confirms receipt.
          </p>
        </div>
      </div>

      {/* Balance — the hero. Setup lives below until this is non-zero. */}
      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-raised px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Available to cash out
          </span>
          <span className="text-2xl font-extrabold tracking-tight text-accent">
            {formatRm(overview.availableCents)}
          </span>
        </div>
        {overview.clearingCents > 0 && (
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-muted">Still clearing (7-day hold)</span>
            <span className="font-bold">
              {formatRm(overview.clearingCents)}
            </span>
          </div>
        )}
        {!overview.hasUnpaidSales && (
          <p className="text-[12px] leading-snug text-muted">
            No sales yet — when your cards sell, the proceeds land here.
            Nothing to set up until then.
          </p>
        )}
      </section>

      {/* Connect Payout Setup */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold tracking-tight text-foreground">
          {connected
            ? "Payout setup"
            : cashoutReady
              ? `Cash out ${formatRm(overview.availableCents)}`
              : "Cashing out (when you're ready)"}
        </h2>
        {cashoutReady && (
          <p className="text-[12px] leading-snug text-muted">
            You have money waiting. Cashing out to a bank needs a one-time
            Stripe verification (~2 minutes) — after that, payouts are
            automatic.
          </p>
        )}
        {!connected && !cashoutReady && (
          <p className="text-[12px] leading-snug text-muted">
            Bank payouts need a one-time Stripe verification, and only when
            you withdraw. Skip it for now —{" "}
            {connectStatus.isConsignor ? (
              "it'll be waiting here when you've sold."
            ) : (
              <>
                <Link href="/list" className="text-accent hover:underline">
                  list your first shoe
                </Link>{" "}
                instead.
              </>
            )}
          </p>
        )}
        <PayoutSetup
          accountId={connectStatus.accountId}
          payoutsEnabled={connectStatus.payoutsEnabled}
          isConsignor={connectStatus.isConsignor}
          countryCode={connectStatus.countryCode}
          ctaLabel={
            cashoutReady
              ? `Cash out ${formatRm(overview.availableCents)}`
              : undefined
          }
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