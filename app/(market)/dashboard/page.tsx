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
 * Payout plumbing lives on /payouts (see app/(market)/payouts/page.tsx):
 * Stripe Connect onboarding and the linked USDC payout wallet both moved
 * there so this page stays about stock, not money movement.
 *
 * There used to be a "cash payout gate" panel here mirroring
 * users.fulfilments_completed against a client-side threshold. Removed: it
 * described a gate fn_submit_listing (019c) no longer has. Payout is derived
 * from the seller's country, not rationed by a fulfilment count — see
 * AGENT_RULES.md section 5 and 019c_settlement.sql's own comment ("The
 * cash_payout_min_fulfilments gate is gone").
 */

import type { Metadata } from "next";
import { getCards, getConsignment, getConsignments, getListings, getRedemptions } from "@/lib/api/contract";
import type { CardSummary } from "@/lib/api/contract";
import type { ItemSummary } from "@/lib/api/contract";
import { currentUserId, getHiddenCardIds, getMySubmittedItems, getTradeHistory } from "@/app/(market)/queries";
import { Button } from "@/components/ui/Button";
import { DashboardTabs } from "@/components/market/DashboardTabs";
import { PlStrip, plEntriesForCards } from "@/components/market/PlStrip";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = {
  title: "Dashboard — FlexSoar Market",
};

const HELD_STATUSES: readonly ItemSummary["status"][] = [
  "pending_intake",
  "in_custody",
  "redemption_hold",
];

/**
 * Held stock includes frozen first sales: a pending_vault card is still
 * yours, just unmovable until the shoe reaches us — hiding it reads as
 * losing the shoe. The cast is load-bearing: CardStatus in lib/db/types.ts
 * predates 023a's pending_vault enum value (track/data's lane), while the
 * database accepts it.
 */
const HELD_CARD_STATUSES = ["active", "locked", "pending_vault"] as CardSummary["status"][];

export default async function DashboardPage() {
  const me = await currentUserId();

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
  const hiddenIds = await getHiddenCardIds(me);
  const visibility: Record<string, boolean> = {};
  for (const card of heldCards) {
    visibility[card.id] = !hiddenIds.has(card.id);
  }

  // Unrealized P/L inputs: live asks for value, open provenance hops for
  // cost. Sold cards are excluded by construction — provenance records no
  // release price, so realized P/L cannot be computed from it.
  const [liveListings, trades] = await Promise.all([
    getListings({ sellerId: me }).catch(() => []),
    getTradeHistory(me).catch(() => []),
  ]);
  const askByCardId = new Map(liveListings.map((l) => [l.card_id, l.price_cents]));
  const openCostByCardId = new Map<string, number | null>();
  for (const t of trades) {
    if (t.releasedAt == null && !openCostByCardId.has(t.cardId)) {
      openCostByCardId.set(t.cardId, t.priceCents);
    }
  }
  const plEntries = plEntriesForCards(
    heldCards.map((c) => ({
      id: c.id,
      label: `${c.sku.brand} ${c.sku.model}`,
      oracleCents: c.sku.market_price_cents ?? null,
    })),
    openCostByCardId,
    askByCardId,
  );

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

      <PlStrip entries={plEntries} />

      <DashboardTabs
        submittedItems={submittedItems}
        heldItems={preMintHeldItems}
        heldCards={heldCards}
        redemptions={redemptions}
        visibility={visibility}
      />

    </div>
  );
}