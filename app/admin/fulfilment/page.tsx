/**
 * app/admin/fulfilment/page.tsx
 *
 * Three queues, because a redemption can be owed by two different parties and
 * an item can be owed nothing at all but still need checking on:
 *
 *   Warehouse       we hold the shoe. getRedemptions() + markShipped().
 *   Seller-held     a seller holds it and owes it by a deadline.
 *                   getSellerHeldRedemptions() + confirmShipment/markDefault.
 *   Proof overdue   nobody redeemed anything; a seller is simply overdue on
 *                   proving they still have a shoe they listed.
 *
 * THE SPLIT IS LOAD-BEARING, not cosmetic. A seller-held parcel shipped
 * through the warehouse control would be recorded correctly and would silently
 * fail to credit the seller's fulfilment count — the number that gates their
 * cash payout. So seller-held rows are filtered OUT of the warehouse tables by
 * id rather than being left to appear in both, and each section renders only
 * its own control. See app/admin/fulfilment/actions.ts.
 *
 * The warehouse section is unchanged from the 009 build: getRedemptions(),
 * oldest first, unshipped rows get carrier/tracking entry, shipped rows are
 * the immutable record of what went out.
 */

import type { Metadata } from "next";
import { requireAdminPage } from "@/components/admin/auth";
import {
  getPlatformConfig,
  getProofOverdue,
  getSellerHeldRedemptions,
  type SellerHeldRedemption,
} from "@/components/admin/db-reads";
import { MarkShippedControl } from "@/components/admin/fulfilment/MarkShippedControl";
import { SellerHeldControls } from "@/components/admin/fulfilment/SellerHeldControls";
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

  const [redemptions, sellerHeld, proofOverdue, config] = await Promise.all([
    getRedemptions({ limit: 200 }),
    getSellerHeldRedemptions(),
    getProofOverdue(),
    getPlatformConfig(),
  ]);

  // getRedemptions() returns every redemption, seller-held ones included — it
  // has no fulfiller_id to filter on. Remove them by id so no row appears in
  // two sections with two different, non-interchangeable ship buttons.
  const sellerHeldIds = new Set(sellerHeld.map((row) => row.id));
  const warehouse = redemptions.filter((r) => !sellerHeldIds.has(r.id));
  const open = warehouse.filter((r) => r.status !== "shipped");
  const shipped = warehouse.filter((r) => r.status === "shipped");

  // Outstanding = neither shipped nor defaulted. Both stamps are terminal and
  // neither can be cleared, so anything carrying one is history.
  const owed = sellerHeld.filter(
    (row) => !row.shipped_at && !row.defaulted_at,
  );
  const settled = sellerHeld.filter((row) => row.shipped_at || row.defaulted_at);
  const overdueCount = owed.filter((row) => row.days_overdue !== null).length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-lg uppercase tracking-tight">Fulfilment</h1>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          A redemption burns the card and ships the shoe. The burn already
          happened by the time a row appears here.
        </p>
      </header>

      {/* ============ SELLER-HELD ============ */}
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Seller-held ({owed.length})
          {overdueCount > 0 && (
            <span className="text-[#FF4444]"> · {overdueCount} overdue</span>
          )}
        </h2>
        <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
          The shoe never came to the warehouse. A seller owes this parcel to a
          redeemer
          {config.sellerShipmentDays == null
            ? "."
            : ` within ${config.sellerShipmentDays} days of the redemption.`}{" "}
          Confirming shipment credits their fulfilment count; marking a default
          is permanent and marks the person.
        </p>

        {owed.length === 0 ? (
          <EmptyState
            title="Nothing owed"
            description="No seller is currently holding a redeemed shoe."
          />
        ) : (
          <SellerHeldTable rows={owed} withControls />
        )}
      </section>

      {settled.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[13px] uppercase tracking-tight">
            Seller-held, settled ({settled.length})
          </h2>
          <SellerHeldTable rows={settled} />
        </section>
      )}

      {/* ============ PROOF OF POSSESSION ============ */}
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Proof of possession overdue ({proofOverdue.length})
        </h2>
        <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
          Listed shoes whose holder has not proven they still have them
          {config.proofOfPossessionDays == null
            ? ""
            : ` within ${config.proofOfPossessionDays} days`}
          . Nothing has been redeemed yet — this is the queue that stops a
          default from being the first time anyone notices. Read-only here:
          proof is recorded by the holder, and an admin cannot photograph a shoe
          they do not have.
        </p>

        {proofOverdue.length === 0 ? (
          <EmptyState
            title="All proven"
            description="Every seller-held item is inside its proof window."
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Item</Th>
                <Th>Holder</Th>
                <Th>Last proof</Th>
                <Th className="text-right">Days since</Th>
              </Tr>
            </THead>
            <TBody>
              {proofOverdue.map((row) => {
                const since = row.days_since_proof;
                return (
                  <Tr key={row.id}>
                    <Td>
                      <span className="text-foreground">
                        {row.brand} {row.model}
                      </span>
                      <div className="text-muted">{row.id}</div>
                    </Td>
                    <Td>
                      {row.holder ? (
                        <>
                          {row.holder.handle}
                          <span className="text-muted">
                            {" "}
                            · L{row.holder.level}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">
                          {row.custody_holder_id ?? "(no holder on record)"}
                        </span>
                      )}
                    </Td>
                    <Td className="text-muted tabular-nums">
                      {row.last_proof_at ? (
                        formatTimestamp(row.last_proof_at)
                      ) : (
                        <span className="text-[#FF4444]">never proven</span>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {since == null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className="text-[#E8B33A]">{since}</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>

      {/* ============ WAREHOUSE ============ */}
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Awaiting shipment ({open.length})
        </h2>
        {open.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="Every requested redemption from the warehouse has shipped."
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

/**
 * Who owes what, by when. The deadline column is the point of the table, so it
 * carries the overdue state rather than tucking it into a badge elsewhere.
 */
function SellerHeldTable({
  rows,
  withControls = false,
}: {
  rows: SellerHeldRedemption[];
  withControls?: boolean;
}) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Card</Th>
          <Th>Seller owes</Th>
          <Th>Redeemer</Th>
          <Th>Requested</Th>
          <Th>Due by</Th>
          <Th>Ship to</Th>
          <Th>{withControls ? "Action" : "Outcome"}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((row) => {
          const late = row.days_overdue;
          const cardLabel = `${row.sku.brand} ${row.sku.model} · US ${row.sku.size_us} · #${row.card.mint_number}`;

          return (
            <Tr
              key={row.id}
              className={late !== null && withControls ? "bg-[#FF4444]/10" : undefined}
            >
              <Td>
                <span className="text-foreground">
                  {row.sku.brand} {row.sku.model}
                </span>
                <span className="text-muted">
                  {" "}
                  · US {row.sku.size_us} · #{row.card.mint_number} ·{" "}
                  {row.card.float_value.toFixed(3)}
                </span>
                <div className="text-muted">
                  {row.item.custody === "seller"
                    ? "held by the seller"
                    : `held at ${row.item.custody_location ?? "(no location on record)"}`}
                </div>
              </Td>
              <Td>
                {row.fulfiller ? (
                  <>
                    {row.fulfiller.handle}
                    <span className="text-muted"> · L{row.fulfiller.level}</span>
                  </>
                ) : (
                  <span className="text-muted">(no seller on record)</span>
                )}
              </Td>
              <Td>
                {row.requester ? (
                  <>
                    {row.requester.handle}
                    <span className="text-muted"> · L{row.requester.level}</span>
                  </>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
              <Td className="text-muted tabular-nums">
                {formatTimestamp(row.requested_at)}
              </Td>
              <Td className="tabular-nums">
                {row.due_by == null ? (
                  <span className="text-muted">— no deadline</span>
                ) : late !== null ? (
                  <span className="text-[#FF4444]">
                    {formatTimestamp(row.due_by)}
                    <span className="block">
                      {late} day{late === 1 ? "" : "s"} overdue
                    </span>
                  </span>
                ) : (
                  <span className="text-muted">
                    {formatTimestamp(row.due_by)}
                  </span>
                )}
              </Td>
              <Td className="max-w-56 text-muted">
                {formatAddress(row.shipping_address)}
              </Td>
              <Td>
                {withControls ? (
                  <SellerHeldControls
                    redemptionId={row.id}
                    cardLabel={cardLabel}
                    sellerHandle={row.fulfiller?.handle ?? "the seller"}
                    daysOverdue={late}
                  />
                ) : row.defaulted_at ? (
                  <div className="flex flex-col gap-1">
                    <Badge tone="danger">Defaulted</Badge>
                    <span className="text-muted tabular-nums">
                      {formatTimestamp(row.defaulted_at)}
                    </span>
                  </div>
                ) : (
                  <span className="text-muted">
                    {row.carrier
                      ? `${row.carrier} · ${row.tracking_number ?? "no tracking"}`
                      : "shipped"}
                    {row.shipped_at ? ` · ${formatTimestamp(row.shipped_at)}` : ""}
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
