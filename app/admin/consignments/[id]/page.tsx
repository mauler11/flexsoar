/**
 * app/admin/consignments/[id]/page.tsx
 *
 * One consignment: who sent it, what is in it, everywhere it has been, and
 * the moves available from here.
 *
 * The event log is rendered oldest first and never edited — `consignment_events`
 * is append-only, and the log is the answer to "who moved this and why" six
 * months later. 005 takes the actor from the session rather than the argument,
 * so an actor shown here is the account that actually did it.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/components/admin/auth";
import { TransitionControls } from "@/components/admin/consignments/TransitionControls";
import { statusLabel, statusTone } from "@/components/admin/consignments/transitions";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { getConsignment } from "@/lib/api/contract";
import type { ItemStatus } from "@/lib/db/types";

export const metadata: Metadata = {
  title: "Consignment — FlexSoar admin",
};

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

function formatMoney(cents: number | null): string {
  if (cents == null) return "—";
  return `${(cents / 100).toFixed(2)} FSC`;
}

/** Photos are jsonb; anything that is not an array of strings is shown as absent. */
function photoCount(photos: unknown): number {
  return Array.isArray(photos) ? photos.length : 0;
}

const ITEM_STATUS_LABELS: Readonly<Record<ItemStatus, string>> = {
  pending_intake: "Pending intake",
  in_custody: "In custody",
  pending_review: "Pending review",
  awaiting_seller_shipment: "Awaiting seller shipment",
  minted: "Minted",
  redemption_hold: "Redemption hold",
  shipped: "Shipped",
  released: "Released",
  returned_to_consignor: "Returned",
};

export default async function ConsignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminPage(`/admin/consignments/${id}`);

  const consignment = await getConsignment(id);
  if (!consignment) notFound();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <nav className="font-mono text-[10px] uppercase tracking-tight text-muted">
        <Link href="/admin/consignments" className="hover:text-foreground">
          ← Consignments
        </Link>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-lg uppercase tracking-tight">
              {consignment.consignor.handle}
            </h1>
            <Badge tone={statusTone(consignment.status)}>
              {statusLabel(consignment.status)}
            </Badge>
          </div>
          <p className="font-mono text-[10px] tracking-tight text-muted">
            {consignment.id}
          </p>
        </div>

        <TransitionControls
          consignmentId={consignment.id}
          status={consignment.status}
        />
      </header>

      <dl className="grid grid-cols-2 gap-2 border border-line bg-raised p-3 font-mono text-[11px] tracking-tight sm:grid-cols-4">
        <Field label="Items" value={String(consignment.item_count)} />
        <Field label="Intake fee" value={formatMoney(consignment.intake_fee_cents)} />
        <Field label="Consignor level" value={`L${consignment.consignor.level}`} />
        <Field label="Created" value={formatTimestamp(consignment.created_at)} />
        <Field label="Submitted" value={formatTimestamp(consignment.submitted_at)} />
        <Field label="Received" value={formatTimestamp(consignment.received_at)} />
        <Field label="Completed" value={formatTimestamp(consignment.completed_at)} />
      </dl>

      {consignment.notes && (
        <div className="border border-line bg-raised p-3">
          <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Notes
          </p>
          <p className="font-mono text-[11px] leading-snug tracking-tight whitespace-pre-wrap">
            {consignment.notes}
          </p>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Items ({consignment.items.length})
        </h2>
        {consignment.items.length === 0 ? (
          <EmptyState
            title="No items"
            description="Nothing has been booked into this consignment yet."
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>SKU</Th>
                <Th>Status</Th>
                <Th className="text-right">Float</Th>
                <Th>Graded</Th>
                <Th>Authenticated</Th>
                <Th>Custody</Th>
                <Th className="text-right">Photos</Th>
              </Tr>
            </THead>
            <TBody>
              {consignment.items.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    <span className="text-foreground">
                      {item.sku.brand} {item.sku.model}
                    </span>
                    <span className="text-muted"> · US {item.sku.size_us}</span>
                  </Td>
                  <Td>{ITEM_STATUS_LABELS[item.status]}</Td>
                  <Td className="text-right tabular-nums">
                    {item.float_value == null ? (
                      <span className="text-muted">ungraded</span>
                    ) : (
                      Number(item.float_value).toFixed(3)
                    )}
                  </Td>
                  <Td className="text-muted tabular-nums">
                    {formatTimestamp(item.graded_at)}
                  </Td>
                  <Td className="text-muted tabular-nums">
                    {formatTimestamp(item.authenticated_at)}
                  </Td>
                  <Td className="text-muted">{item.custody_location ?? "—"}</Td>
                  <Td className="text-right tabular-nums text-muted">
                    {photoCount(item.photos)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          History ({consignment.events.length})
        </h2>
        {consignment.events.length === 0 ? (
          <EmptyState
            title="No events"
            description="This consignment has not moved since it was created."
          />
        ) : (
          <ol className="flex flex-col">
            {consignment.events.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-2 border-line py-1.5 pl-3 font-mono text-[11px] tracking-tight"
              >
                <span className="tabular-nums text-muted">
                  {formatTimestamp(event.created_at)}
                </span>
                <span>
                  {event.from_status ? statusLabel(event.from_status) : "—"}
                  <span className="text-muted"> → </span>
                  <span className="font-bold">{statusLabel(event.to_status)}</span>
                </span>
                <span className="text-muted">
                  actor {event.actor_id ?? "unknown"}
                </span>
                {event.note && (
                  <span className="w-full whitespace-pre-wrap text-muted">
                    {event.note}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
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
