import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRedemptions } from "@/lib/api/contract";
import {
  currentUserId,
  getMyShipmentIntakes,
  type ShipmentIntake,
} from "@/app/(market)/queries";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatMyr } from "@/components/card/format";

export const metadata: Metadata = {
  title: "Shipments — FlexSoar Market",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function intakeTone(status: ShipmentIntake["status"]): BadgeTone {
  if (status === "received") return "accent";
  if (status === "defaulted" || status === "cancelled") return "danger";
  return "warn";
}

function intakeLabel(intake: ShipmentIntake): string {
  switch (intake.status) {
    case "awaiting_shipment":
      return intake.role === "seller" ? "Ship now" : "Seller is preparing";
    case "in_transit":
      return "In transit";
    case "received":
      return "Received";
    case "defaulted":
      return "Defaulted";
    case "cancelled":
      return "Cancelled";
  }
}

export default async function ShipmentsPage() {
  const me = await currentUserId();
  if (!me) redirect("/sign-in?next=/shipments");

  const [intakes, redemptions] = await Promise.all([
    getMyShipmentIntakes().catch(() => []),
    getRedemptions({ userId: me }).catch(() => []),
  ]);

  const open = intakes.filter(
    (i) => i.status === "awaiting_shipment" || i.status === "in_transit",
  );
  const toShip = open.filter((i) => i.role === "seller");
  const arriving = open.filter((i) => i.role === "buyer");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">My shipments</h1>
        <Link
          href="/market"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-[13px] font-bold transition hover:border-muted"
        >
          Shop sneakers
        </Link>
      </div>

      {open.length === 0 && redemptions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-raised px-4 py-10 text-center">
          <p className="text-base font-extrabold">None in progress</p>
          <p className="max-w-sm text-sm text-muted">
            Can&apos;t find your shipment?{" "}
            <Link href="/contact" className="font-semibold text-accent hover:underline">
              Contact us
            </Link>{" "}
            and let&apos;s get it sorted.
          </p>
        </div>
      ) : (
        <>
          {toShip.length > 0 && (
            <section aria-label="Parcels you must ship" className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                To ship ({toShip.length})
              </h2>
              {toShip.map((i) => (
                <div key={i.id} className="flex flex-col gap-1 rounded-2xl border border-[#E8B33A]/50 bg-raised p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/card/${i.cardId}`} className="text-sm font-bold hover:underline">
                      {i.cardLabel}
                    </Link>
                    <Badge tone={intakeTone(i.status)}>{intakeLabel(i)}</Badge>
                  </div>
                  <p className="text-xs text-muted">
                    Due by {fmtDate(i.dueBy)} — arrange tracked courier at your
                    own cost. Miss it and the sale cancels with a full buyer refund.
                  </p>
                  {i.trackingNumber && (
                    <p className="font-mono text-xs text-muted">
                      {i.carrier ?? "Courier"} · {i.trackingNumber}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}

          {arriving.length > 0 && (
            <section aria-label="Parcels arriving to you" className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Arriving ({arriving.length})
              </h2>
              {arriving.map((i) => (
                <div key={i.id} className="flex flex-col gap-1 rounded-2xl border border-line bg-raised p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/card/${i.cardId}`} className="text-sm font-bold hover:underline">
                      {i.cardLabel}
                    </Link>
                    <Badge tone={intakeTone(i.status)}>{intakeLabel(i)}</Badge>
                  </div>
                  <p className="font-mono text-xs text-muted">
                    {i.trackingNumber
                      ? `${i.carrier ?? "Courier"} · ${i.trackingNumber}`
                      : "Tracking appears here once it ships."}
                  </p>
                </div>
              ))}
            </section>
          )}

          {redemptions.length > 0 && (
            <section aria-label="Redemption shipments" className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Redemptions ({redemptions.length})
              </h2>
              {redemptions.map((r) => (
                <div key={r.id} className="flex flex-col gap-1 rounded-2xl border border-line bg-raised p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/card/${r.card_id}`} className="text-sm font-bold hover:underline">
                      {r.card.sku.brand} {r.card.sku.model}
                    </Link>
                    <Badge tone={r.status === "delivered" || r.status === "completed" ? "accent" : "warn"}>
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted">
                    Requested {fmtDate(r.requested_at)} · handling {formatMyr(r.handling_fee_cents)}
                  </p>
                  {r.tracking_number && (
                    <p className="font-mono text-xs text-muted">
                      {r.carrier ?? "Courier"} · {r.tracking_number}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
