/**
 * app/(market)/payouts/page.tsx
 *
 * Payouts: seller balance first, then the USDC payout wallet. Sellers are
 * paid in USDC only (founder decision 2026-10-20); the Stripe Connect
 * onboarding surface (/api/consignor/connect, /consignor/connect/*, the
 * Connect webhooks) was removed in H1, so there is no bank setup here.
 *
 * Data:
 *   - Balance            settled, unpaid, cash-method orders where the caller
 *                        is the seller (orders_own_read covers seller_id =
 *                        auth.uid()); split into available (clearing hold
 *                        elapsed) vs clearing. Defensive: any query failure
 *                        renders zeros, never an error state.
 *   - USDC payout wallet users.solana_address — the ONLY seller-side link path.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentUserId } from "@/app/(market)/queries";
import {
  NO_BANK_PAYOUT,
  PAYMENTS_NOT_LIVE,
  SELLER_PAYOUT_SUMMARY,
} from "@/app/(market)/payout-copy";
import { EmbeddedLinkButton } from "@/components/market/EmbeddedWalletSection";
import { EmptyState } from "@/components/ui/EmptyState";

async function getPayoutWallet(userId: string): Promise<string | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("users")
    .select("solana_address")
    .eq("id", userId)
    .maybeSingle();
  return (data as { solana_address?: string | null } | null)?.solana_address ?? null;
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
          description="Your USDC payout wallet shows up here once you're signed in."
        />
      </div>
    );
  }

  const solanaAddress = await getPayoutWallet(me);
  const overview = await getPayoutOverview(me);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Payouts</h1>
          <p className="text-sm text-muted">
            {SELLER_PAYOUT_SUMMARY} {PAYMENTS_NOT_LIVE}
          </p>
        </div>
      </div>

      {/* Balance — the hero. Setup lives below until this is non-zero. */}
      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-raised px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Available
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

      {/* No bank payout (founder decision 2026-10-20). */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold tracking-tight text-foreground">
          Payout method
        </h2>
        <p className="text-[12px] leading-snug text-muted">
          {NO_BANK_PAYOUT} Sellers are paid in USDC to the wallet below.
          Nothing to set up here.
        </p>
      </section>

      {/* USDC payout wallet — the ONLY seller-side link path. Sellers never
          see the buy panel on their own listings, so without this section a
          seller whose listings the quote path rejects ("seller has no linked
          payout wallet yet") has nowhere to fix it. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold tracking-tight text-foreground">
          USDC payout wallet
        </h2>
        {solanaAddress ? (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-muted">
              Linked {solanaAddress.slice(0, 8)}…
              {solanaAddress.slice(-6)} — USDC sale proceeds go
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