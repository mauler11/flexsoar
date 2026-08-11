/**
 * app/admin/fulfilment/page.tsx
 *
 * Redemption requests on getRedemptions(), oldest first — the request that
 * has waited longest is the one to pick up next. Unshipped rows get the
 * carrier/tracking entry via markShipped(); shipped rows are the immutable
 * record of what went out.
 */

import type { Metadata } from "next";
import { requireAdminPage } from "@/components/admin/auth";
import { MarkShippedControl } from "@/components/admin/fulfilment/MarkShippedControl";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { getRedemptions, type RedemptionSummary } from "@/lib/api/contract";
import type { Json } from "@/lib/db/types";

export const metadata: Metadata = {
  title: "Fulfilment — FlexSoar admin",
};

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

/**
 * shipping_address is jsonb written by redeemCard from a ShippingAddress.
 * Render the known fields in postal order; fall back to raw JSON rather than
 * hiding an address a parcel depends on.
 */
function formatAddress(address: Json): string {
  if (typeof address !== "object" || address === null || Array.isArray(address)) {
    return JSON.stringify(address);
  }
  const a = address as Record<string, unknown>;
  const parts = ["name", "line1", "line2", "city", "state", "postal_code", "country"]
    .map((key) => a[key])
    .filter((value): value is string => typeof value === "string" && value !== "");
  return parts.length > 0 ? parts.join(", ") : JSON.stringify(address);
}

export default async function FulfilmentPage() {
  await requireAdminPage("/admin/fulfilment");

  const redemptions = await getRedemptions({ limit: 200 });
  const open = redemptions.filter((r) => r.status !== "shipped");
  const shipped = redemptions.filter((r) => r.status === "shipped");

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-lg uppercase tracking-tight">Fulfilment</h1>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          A redemption burns the card and ships the shoe. The burn already
          happened by the time a row appears here.
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Awaiting shipment ({open.length})
        </h2>
        {open.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="Every requested redemption has shipped."
          />
        ) : (
          <RedemptionTable rows={open} withShipControl />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Shipped ({shipped.length})
        </h2>
        {shipped.length === 0 ? (
          <EmptyState title="None shipped yet" />
        ) : (
          <RedemptionTable rows={shipped} />
        )}
      </section>
    </main>
  );
}

function RedemptionTable({
  rows,
  withShipControl = false,
}: {
  rows: RedemptionSummary[];
  withShipControl?: boolean;
}) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Card</Th>
          <Th>Requested by</Th>
          <Th>Status</Th>
          <Th>Requested</Th>
          <Th className="text-right">Fee</Th>
          <Th>Ship to</Th>
          <Th>{withShipControl ? "Ship" : "Carrier / tracking"}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((redemption) => {
          const sku = redemption.card.sku;
          return (
            <Tr key={redemption.id}>
              <Td>
                <span className="text-foreground">
                  {sku.brand} {sku.model}
                </span>
                <span className="text-muted">
                  {" "}
                  · US {sku.size_us} · #{redemption.card.mint_number} ·{" "}
                  {Number(redemption.card.float_value).toFixed(3)}
                </span>
                <div className="text-muted">
                  held at {redemption.item.custody_location ?? "(no location on record)"}
                </div>
              </Td>
              <Td>
                {redemption.user.handle}
                <span className="text-muted"> · L{redemption.user.level}</span>
              </Td>
              <Td>
                <Badge tone={redemption.status === "shipped" ? "accent" : "warn"}>
                  {redemption.status}
                </Badge>
              </Td>
              <Td className="text-muted tabular-nums">
                {formatTimestamp(redemption.requested_at)}
              </Td>
              <Td className="text-right tabular-nums">
                {(redemption.handling_fee_cents / 100).toFixed(2)} FSC
              </Td>
              <Td className="max-w-56 text-muted">
                {formatAddress(redemption.shipping_address)}
              </Td>
              <Td>
                {withShipControl ? (
                  <MarkShippedControl
                    redemptionId={redemption.id}
                    cardLabel={`${sku.brand} ${sku.model} · US ${sku.size_us} · #${redemption.card.mint_number}`}
                  />
                ) : (
                  <span className="text-muted">
                    {redemption.carrier
                      ? `${redemption.carrier} · ${redemption.tracking_number ?? "no tracking"}`
                      : "—"}
                    {redemption.shipped_at
                      ? ` · ${formatTimestamp(redemption.shipped_at)}`
                      : ""}
                  </span>
                )}
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
