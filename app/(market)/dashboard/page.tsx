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
import { getCards, getConsignment, getConsignments, getRedemptions } from "@/lib/api/contract";
import type { CardSummary } from "@/lib/api/contract";
import type { RedemptionSummary } from "@/lib/api/contract";
import type { ItemSummary } from "@/lib/api/contract";
import { currentUserId, getMySubmittedItems } from "@/app/(market)/queries";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatUsd } from "@/components/card/format";

/** Placeholder for Connect status contract export — replace when Connect integration lands. */
async function getConnectStatus(_userId: string): Promise<{
  connected: boolean;
  accountId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  onboardingUrl?: string;
}> {
  return { connected: false };
}

export const metadata: Metadata = {
  title: "Dashboard — FlexSoar Market",
};

/** Display-only ship SLA, pending handoff M5. Hours from requested_at. */
const REDEMPTION_SHIP_DEADLINE_HOURS = 72;

const HELD_STATUSES: readonly ItemSummary["status"][] = [
  "pending_intake",
  "in_custody",
  "redemption_hold",
];

const OWED_STATUSES: readonly RedemptionSummary["status"][] = ["requested", "picking"];

const HELD_CARD_STATUSES: CardSummary["status"][] = ["active", "locked"];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function deadlineOf(requestedAt: string): Date {
  return new Date(
    new Date(requestedAt).getTime() + REDEMPTION_SHIP_DEADLINE_HOURS * 3600 * 1000,
  );
}

function isOverdue(deadline: Date): boolean {
  return deadline.getTime() < Date.now();
}

export default async function DashboardPage() {
  const me = await currentUserId();

  const connectStatus = me ? await getConnectStatus(me) : { connected: false };

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-mono text-xl font-black uppercase tracking-tight">
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
  const owed = redemptions.filter((r) => OWED_STATUSES.includes(r.status as RedemptionSummary["status"]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-black uppercase tracking-tight">
            Seller dashboard
          </h1>
          <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Submissions · held stock · redemptions
          </p>
        </div>
        <Button variant="primary" size="md" href="/list">
          list a shoe
        </Button>
      </div>

      {/* Connect Payout Setup */}
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[11px] font-black uppercase tracking-tight text-foreground">
          Payout setup
        </h2>
        {connectStatus.connected ? (
          <div className="border border-line bg-overlay/50 px-3 py-3 font-mono text-[11px] tracking-tight">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" aria-hidden="true" />
                <span className="font-medium text-green-500">Connected</span>
                <span className="text-muted">Account <code className="text-[10px] bg-overlay px-1 rounded">{connectStatus.accountId?.slice(-8)}</code></span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted">
                <span>Charges: {connectStatus.chargesEnabled ? "enabled" : "disabled"}</span>
                <span>Payouts: {connectStatus.payoutsEnabled ? "enabled" : "disabled"}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-line-strong px-3 py-3 font-mono text-[11px] tracking-tight">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#FF4444]" aria-hidden="true" />
                <span className="font-medium text-[#FF4444]">Not connected</span>
              </div>
              <Button
                variant="primary"
                size="sm"
                href={connectStatus.onboardingUrl ?? "#"}
                disabled={!connectStatus.onboardingUrl}
              >
                Set up payouts
              </Button>
            </div>
            <p className="mt-2 text-[9px] text-muted">
              Connect your Stripe account to receive payouts. Payout method (cash vs
              credit) is determined by your country — see TERMS.md §10.
            </p>
          </div>
        )}
      </section>

      {/* Submissions */}
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[11px] font-black uppercase tracking-tight text-foreground">
          Submissions ({submittedItems.length})
        </h2>
        {submittedItems.length === 0 ? (
          <p className="border border-dashed border-line-strong px-3 py-4 font-mono text-[10px] tracking-tight text-muted">
            No submissions yet — list your first shoe from /list.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {submittedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[11px] tracking-tight"
              >
                <span className="min-w-0 truncate font-bold text-foreground">
                  {item.sku.brand} {item.sku.model} · {item.sku.colorway} · US{" "}
                  {item.sku.size_us}
                </span>
                <span className="shrink-0 text-muted">{item.status}</span>
                <span className="shrink-0 text-muted">
                  submitted {fmtDate(item.createdAt)}
                </span>
                <span className="shrink-0 text-muted">
                  {item.askingPriceCents != null ? formatUsd(item.askingPriceCents) : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Held items */}
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[11px] font-black uppercase tracking-tight text-foreground">
          Held items ({preMintHeldItems.length + heldCards.length})
        </h2>
        {(preMintHeldItems.length + heldCards.length) === 0 ? (
          <p className="border border-dashed border-line-strong px-3 py-4 font-mono text-[10px] tracking-tight text-muted">
            Nothing in custody right now.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {preMintHeldItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[11px] tracking-tight"
              >
                <span className="min-w-0 truncate font-bold text-foreground">
                  {item.sku.brand} {item.sku.model} · {item.sku.colorway} · US{" "}
                  {item.sku.size_us}
                </span>
                <span className="shrink-0 text-muted">{item.status}</span>
                <span className="shrink-0 text-muted">
                  {item.float_value != null ? item.float_value.toFixed(3) : "not graded"}
                </span>
              </div>
            ))}
            {heldCards.map((card) => (
              <div
                key={card.id}
                className="flex items-center justify-between gap-3 border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[11px] tracking-tight"
              >
                <span className="min-w-0 truncate font-bold text-foreground">
                  {card.sku.brand} {card.sku.model} · {card.sku.colorway} · US{" "}
                  {card.sku.size_us}
                </span>
                <span className="shrink-0 text-muted">{card.status}</span>
                <span className="shrink-0 text-muted">
                  {card.float_value != null ? card.float_value.toFixed(3) : "not graded"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Owed redemptions */}
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[11px] font-black uppercase tracking-tight text-foreground">
          Owed redemptions ({owed.length})
        </h2>
        <p className="font-mono text-[9px] tracking-tight text-muted">
          Shipment window: {REDEMPTION_SHIP_DEADLINE_HOURS}h from request, until
          the fulfilment SLA ships (handoff M5).
        </p>
        {owed.length === 0 ? (
          <p className="border border-dashed border-line-strong px-3 py-4 font-mono text-[10px] tracking-tight text-muted">
            Nothing owed — every redemption you hold is shipped or still
            requested above.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {owed.map((r) => {
              const deadline = deadlineOf(r.requested_at);
              const overdue = isOverdue(deadline);
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[11px] tracking-tight"
                >
                  <span className="min-w-0 truncate font-bold text-foreground">
                    {r.card.sku.brand} {r.card.sku.model} · US{" "}
                    {r.card.sku.size_us}
                  </span>
                  <span className="shrink-0 text-muted">{r.status}</span>
                  <span
                    className={
                      "shrink-0 " +
                      (overdue ? "text-[#FF4444]" : "text-muted")
                    }
                  >
                    {overdue
                      ? `overdue ${fmtDate(deadline.toISOString())}`
                      : `ship by ${fmtDate(deadline.toISOString())}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="border-t border-line-strong pt-2 font-mono text-[9px] tracking-tight text-muted">
        Anything stale? The fulfilment SLA (M5) is flagged in
        docs/handoff/market.md — the dashboard renders the reads the contract
        has today.
      </p>
    </div>
  );
}