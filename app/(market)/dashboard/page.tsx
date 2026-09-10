/**
 * app/(market)/dashboard/page.tsx
 *
 * The seller dashboard: submissions, held items, and owed redemptions with a
 * ship deadline.
 *
 * Data:
 *   - submissions  getMySubmittedItems(me)                — every item I've
 *                  submitted (app/(market)/queries.ts workaround read; see
 *                  its doc comment — getConsignments() never returns these,
 *                  since submitListing() never sets items.consignment_id and
 *                  nothing anywhere writes the consignments table at all)
 *   - held items   getConsignment(id).items, flattened    — pre-mint pipeline
 *   - redemptions  getRedemptions({ userId: me })         — cards I redeemed
 *
 * "Owed redemptions" here means the shipments the market owes the seller for
 * their redeemed cards. The ship deadline is display-only pending handoff M5
 * (a redemptions column / shared constant for the real SLA); the redemptions
 * table has no deadline column, so the 72h window below is a local constant
 * and is clearly labelled as one.
 *
 * There used to be a "cash payout gate" panel here mirroring
 * users.fulfilments_completed against a client-side threshold. Removed: it
 * described a gate fn_submit_listing (019c) no longer has. Payout is derived
 * from the seller's country, not rationed by a fulfilment count — see
 * AGENT_RULES.md section 5 and 019c_settlement.sql's own comment ("The
 * cash_payout_min_fulfilments gate is gone").
 */

import type { Metadata } from "next";
import { getCards, getConsignment, getConsignments, getRedemptions, getPlatformConfig } from "@/lib/api/contract";
import type { CardSummary } from "@/lib/api/contract";
import type { ItemSummary } from "@/lib/api/contract";
import { currentUserId, getMySubmittedItems } from "@/app/(market)/queries";
import { createServerSupabase } from "@/lib/supabase/server";
import { Button } from "@/components/ui/Button";
import { PayoutSetup } from "@/components/market/PayoutSetup";
import { DashboardTabs } from "@/components/market/DashboardTabs";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Stored Connect status for the dashboard. Reads the webhook-landed columns
 * (028) — the live check happens on /consignor/connect/return and via the
 * account.updated webhook. Never pre-mints an onboarding link here: account
 * links expire, so the link is minted on button click (PayoutSetup POSTs to
 * /api/consignor/connect).
 */
async function getConnectStatus(userId: string): Promise<{
  accountId: string | null;
  payoutsEnabled: boolean;
  isConsignor: boolean;
  countryCode: string | null;
  showCollection: boolean;
}> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("users")
    .select(
      "stripe_connect_account_id, stripe_connect_payouts_enabled, is_consignor, country_code, show_collection",
    )
    .eq("id", userId)
    .maybeSingle();
  const row = (data ?? {}) as {
    stripe_connect_account_id?: string | null;
    stripe_connect_payouts_enabled?: boolean | null;
    is_consignor?: boolean | null;
    country_code?: string | null;
    show_collection?: boolean | null;
  };
  return {
    accountId: row.stripe_connect_account_id ?? null,
    payoutsEnabled: row.stripe_connect_payouts_enabled ?? false,
    isConsignor: row.is_consignor ?? false,
    countryCode: row.country_code ?? null,
    showCollection: row.show_collection ?? true,
  };
}

export const metadata: Metadata = {
  title: "Dashboard — FlexSoar Market",
};

const HELD_STATUSES: readonly ItemSummary["status"][] = [
  "pending_intake",
  "in_custody",
  "redemption_hold",
];

const HELD_CARD_STATUSES: CardSummary["status"][] = ["active", "locked"];

export default async function DashboardPage() {
  const me = await currentUserId();

  const connectStatus = me
    ? await getConnectStatus(me)
    : { accountId: null, payoutsEnabled: false, isConsignor: false, countryCode: null, showCollection: true };

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight">
          Seller dashboard
        </h1>
        <EmptyState
          title="Sign in to track your listings"
          description="Your submissions, held items, and payouts show up here once you're signed in."
        />
      </div>
    );
  }

  const submittedItems = await getMySubmittedItems(me);
  const consignments = await getConsignments({ consignorId: me });
  const details = await Promise.all(
    consignments.map(async (c) => ({
      consignment: c,
      detail: await getConsignment(c.id),
    })),
  );

  const preMintHeldItems = details
    .flatMap(({ detail }) => detail?.items ?? [])
    .filter((item) => HELD_STATUSES.includes(item.status));

  const heldCards = await getCards({ ownerId: me, status: HELD_CARD_STATUSES, limit: 200 });

  const redemptions = await getRedemptions({ userId: me });
  const platformConfig = await getPlatformConfig().catch(() => ({
    show_numeric_float: false,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Seller dashboard
          </h1>
          <p className="text-sm text-muted">
            Submissions · held stock · redemptions
          </p>
        </div>
        <Button variant="primary" size="md" href="/list" className="rounded-md">
          List a Shoe
        </Button>
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

      <DashboardTabs
        submittedItems={submittedItems}
        heldItems={preMintHeldItems}
        heldCards={heldCards}
        redemptions={redemptions}
        showCollection={connectStatus.showCollection}
        showNumericFloat={platformConfig.show_numeric_float}
      />

      <p className="border-t border-line-strong pt-2 text-xs text-muted">
        Anything stale? The fulfilment SLA (M5) is flagged in
        docs/handoff/market.md — the dashboard renders the reads the contract
        has today.
      </p>
    </div>
  );
}