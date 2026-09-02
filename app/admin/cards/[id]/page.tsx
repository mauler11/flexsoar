/**
 * app/admin/cards/[id]/page.tsx
 *
 * Admin card detail view: shows the card, its SKU, owner, provenance, and
 * allows retiring (burning) the card with a required reason and confirmation.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/components/admin/auth";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatUsd } from "@/components/card/format";
import { getCard } from "@/lib/api/contract";
import type { CardStatus } from "@/lib/db/types";

export const metadata: Metadata = {
  title: "Card detail — FlexSoar admin",
};

const STATUS_LABELS: Record<CardStatus, string> = {
  active: "Active",
  locked: "Locked (listed)",
  burned: "Burned",
  redeemed: "Redeemed",
  pending_vault: "Pending vault",
};

const STATUS_TONES: Record<CardStatus, "info" | "warn" | "danger" | "success" | "neutral"> = {
  active: "success",
  locked: "info",
  burned: "danger",
  redeemed: "neutral",
  pending_vault: "warn",
};

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminPage(`/admin/cards/${id}`);

  const card = await getCard(id);
  if (!card) notFound();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6">
      <nav className="font-mono text-[10px] uppercase tracking-tight text-muted">
        <Link href="/admin/cards" className="hover:text-foreground">
          ← Cards
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-lg uppercase tracking-tight">
            {card.sku.brand} {card.sku.model}
          </h1>
          <Badge tone={STATUS_TONES[card.status]}>
            {STATUS_LABELS[card.status]}
          </Badge>
          {card.is_exceptional && <Badge tone="warn">Exceptional</Badge>}
        </div>
        <p className="font-mono text-[10px] tracking-tight text-muted">
          {card.sku.colorway} · US {card.sku.size_us} · #{card.mint_number} · {card.id}
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-2 border border-line bg-raised p-3 font-mono text-[11px] tracking-tight sm:grid-cols-4">
        <Field label="Tier" value={card.tier === 1 ? "■ Common" : card.tier === 2 ? "■ Uncommon" : card.tier === 3 ? "■ Rare" : card.tier === 4 ? "■ Epic" : "■ Legendary"} />
        <Field label="Float" value={Number(card.float_value).toFixed(3)} />
        <Field label="Condition" value={card.condition_grade?.replace(/_/g, " ") ?? "—"} />
        <Field label="Minted" value={formatTimestamp(card.minted_at)} />
        <Field label="Oracle value" value={card.oracle_value_cents != null ? formatUsd(card.oracle_value_cents) : "—"} />
        <Field label="Owner" value={`${card.owner.handle} (L${card.owner.level})`} />
        {card.listing && (
          <Field label="Listing" value={`${card.listing.status} · ${formatUsd(card.listing.price_cents)}`} />
        )}
      </dl>

      {card.exceptional_reason && (
        <div className="border border-line bg-raised p-3">
          <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Exceptional reason
          </p>
          <p className="font-mono text-[11px] leading-snug tracking-tight whitespace-pre-wrap">
            {card.exceptional_reason}
          </p>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">Physical item</h2>
        <dl className="grid grid-cols-2 gap-2 border border-line bg-raised p-3 font-mono text-[11px] tracking-tight">
          <Field label="Item ID" value={card.item.id} />
          <Field label="Status" value={card.item.status} />
          <Field label="Graded at" value={formatTimestamp(card.item.graded_at)} />
          <Field label="Authenticated at" value={formatTimestamp(card.item.authenticated_at)} />
          <Field label="Custody location" value={card.item.custody_location ?? "—"} />
        </dl>
      </section>

      {card.provenance.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[13px] uppercase tracking-tight">Provenance ({card.provenance.length})</h2>
          <ol className="flex flex-col">
            {card.provenance.map((hop, idx) => (
              <li
                key={idx}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-2 border-line py-1.5 pl-3 font-mono text-[11px] tracking-tight"
              >
                <span className="tabular-nums text-muted">
                  {formatTimestamp(hop.acquired_at)}
                </span>
                <span>
                  {hop.owner.handle} (L{hop.owner_level})
                  {hop.released_at && (
                    <>
                      <span className="text-muted"> → </span>
                      <span className="font-bold">{formatTimestamp(hop.released_at)}</span>
                    </>
                  )}
                </span>
                {hop.price_cents != null && (
                  <span className="text-muted">{formatUsd(hop.price_cents)}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">Actions</h2>
        <RetireCardForm cardId={card.id} cardLabel={`${card.sku.brand} ${card.sku.model} · US ${card.sku.size_us} · #${card.mint_number}`} />
      </section>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-tight text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

interface RetireCardFormProps {
  cardId: string;
  cardLabel: string;
}

function RetireCardForm({ cardId, cardLabel }: RetireCardFormProps) {
  return (
    <form action={async (formData: FormData) => {
      const reason = formData.get("reason") as string;
      const confirm = formData.get("confirm") === "on";
      if (!reason || !confirm) return;
      await import("./actions").then((m) => m.burnCardAction(cardId, reason));
    }}>
      <div className="border border-destructive/30 bg-destructive/5 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-bold text-destructive">
                Retire card (burn)
              </p>
              <p className="font-mono text-[10px] text-muted">
                {cardLabel}
              </p>
            </div>
            <Button
              type="submit"
              variant="destructive"
              className="whitespace-nowrap"
              disabled={!document.querySelector('input[name="confirm"]:checked')}
            >
              Burn card
            </Button>
          </div>
          <p className="font-mono text-[10px] text-destructive/80 border-t border-destructive/20 pt-3">
            This action is IRREVERSIBLE. The card will be permanently burned and
            cannot be restored. A written reason is required for the audit trail.
          </p>
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="confirm"
                className="mt-1"
                required
              />
              <span className="font-mono text-[11px]">
                I understand this cannot be undone
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-tight text-muted">
                Reason (required)
              </span>
              <textarea
                name="reason"
                rows={3}
                required
                className="border border-line bg-input font-mono text-[11px] px-2 py-1.5 focus:border-accent focus:outline-none"
                placeholder="Explain why this card is being retired..."
              />
            </label>
          </div>
        </div>
    </form>
  );
}