"use client";

/**
 * components/market/DashboardTabs.tsx
 *
 * The seller dashboard's Held / Submissions / Redemptions toggle. Held is
 * the default tab. Submissions render as an aligned table with human
 * verdicts (Approved / Rejected / In review) instead of raw item statuses.
 * The Held tab carries the profile-visibility switch for the whole
 * collection.
 */

import { useState } from "react";
import type { CardSummary, ItemSummary, RedemptionSummary } from "@/lib/api/contract";
import type { SubmittedItem } from "@/app/(market)/queries";
import { HeldCard } from "@/components/market/HeldCard";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatMyr } from "@/components/card/format";
import { cn } from "@/components/ui/cn";

export interface DashboardTabsProps {
  submittedItems: SubmittedItem[];
  heldItems: ItemSummary[];
  heldCards: CardSummary[];
  redemptions: RedemptionSummary[];
  /** cardId -> show_in_profile. Absent means visible (pre-046 rows). */
  visibility: Record<string, boolean>;
}

type Tab = "held" | "submissions" | "redemptions";

/** Human verdicts, not raw item statuses. */
function submissionVerdict(status: string): { label: string; tone: BadgeTone } {
  if (status === "minted") return { label: "Approved", tone: "accent" };
  if (status === "returned_to_consignor") return { label: "Rejected", tone: "danger" };
  return { label: "In review", tone: "warn" };
}

function redemptionTone(status: string): BadgeTone {
  if (status === "completed" || status === "delivered" || status === "received") {
    return "accent";
  }
  if (status === "cancelled" || status === "failed" || status === "defaulted") {
    return "danger";
  }
  return "warn";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function DashboardTabs({
  submittedItems,
  heldItems,
  heldCards,
  redemptions,
  visibility,
}: DashboardTabsProps) {
  const [tab, setTab] = useState<Tab>("held");

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "held", label: "Held items", count: heldItems.length + heldCards.length },
    { id: "submissions", label: "Submissions", count: submittedItems.length },
    { id: "redemptions", label: "Redemptions", count: redemptions.length },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div role="tablist" aria-label="Dashboard sections" className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-lg border px-3.5 py-2 text-sm transition-colors",
              tab === t.id
                ? "border-transparent bg-accent font-semibold text-[#0B0B0B]"
                : "border-line-strong bg-raised text-muted hover:border-muted hover:text-foreground",
            )}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {tab === "held" && (
        <div role="tabpanel" className="flex flex-col gap-3">
          {heldItems.length + heldCards.length === 0 ? (
            <EmptyState
              title="Nothing in custody"
              description="Approved submissions you haven't listed live here."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {heldCards.map((card) => (
                <HeldCard
                  key={card.id}
                  card={card}
                  statusLabel={
                    card.status === "active"
                      ? "Held — not listed"
                      : card.status.replace(/_/g, " ")
                  }
                  shownInProfile={visibility[card.id] ?? true}
                />
              ))}
              {heldItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-1 rounded-2xl border border-dashed border-line-strong bg-raised/40 p-3"
                >
                  <p className="truncate text-sm font-bold">
                    {item.sku.brand} {item.sku.model}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {item.sku.colorway} · US {item.sku.size_us}
                  </p>
                  <p className="text-xs text-muted">
                    {item.status === "in_custody"
                      ? "In custody — pre-mint"
                      : item.status.replace(/_/g, " ")}
                    {item.float_value != null
                      ? ` · float ${item.float_value.toFixed(3)}`
                      : " · not graded"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "submissions" && (
        <div role="tabpanel" className="flex flex-col gap-2">
          {submittedItems.length === 0 ? (
            <EmptyState
              title="No submissions yet"
              description="List your first shoe and it shows up here."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-raised">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-semibold">Shoe</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Price</th>
                    <th className="px-3 py-2 text-right font-semibold">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {submittedItems.map((item) => {
                    const verdict = submissionVerdict(item.status);
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-line last:border-b-0"
                      >
                        <td className="px-3 py-2">
                          <p className="font-bold">
                            {item.sku.brand} {item.sku.model}
                          </p>
                          <p className="text-xs text-muted">
                            {item.sku.colorway} · US {item.sku.size_us}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={verdict.tone}>{verdict.label}</Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {item.askingPriceCents != null
                            ? formatMyr(item.askingPriceCents)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-muted">
                          {fmtDate(item.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "redemptions" && (
        <div role="tabpanel" className="flex flex-col gap-2">
          {redemptions.length === 0 ? (
            <EmptyState
              title="No redemptions"
              description="Cards you redeem for the physical shoes show up here."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-raised">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-semibold">Shoe</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {redemptions.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className="px-3 py-2">
                        <p className="font-bold">
                          {r.card.sku.brand} {r.card.sku.model}
                        </p>
                        <p className="text-xs text-muted">
                          US {r.card.sku.size_us}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={redemptionTone(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right text-muted">
                        {fmtDate(r.requested_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
