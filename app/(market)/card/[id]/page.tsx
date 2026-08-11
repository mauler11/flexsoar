/**
 * app/(market)/card/[id]/page.tsx
 *
 * The detail page: the hero card, the oracle fair value and provenance, and —
 * depending on who the caller is — the buy panel, the seller's list/cancel
 * tools, or the redemption form. Early-access gating is enforced upstream in
 * getCard/getListing; this page only renders what those made visible.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCard, getListing } from "@/lib/api/contract";
import {
  currentUserId,
  currentUserLevel,
  REDEMPTION_HANDLING_FEE_CENTS,
} from "@/app/(market)/queries";
import { cancelListingAction } from "@/app/(market)/actions";
import { toCardWithReason, toListing, toSku } from "@/components/market/bridge";
import { CardDetail } from "@/components/card/CardDetail";
import { Banner } from "@/components/market/Banner";
import { BuyPanel } from "@/components/market/BuyPanel";
import { ListForm } from "@/components/market/ListForm";
import { RedeemForm } from "@/components/market/RedeemForm";
import { ProvenanceChain } from "@/components/market/ProvenanceChain";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatFsc } from "@/components/card/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await getCard(id).catch(() => null);
  const label = detail
    ? `${detail.sku.brand} ${detail.sku.model} — ${detail.sku.colorway}`
    : "Card";
  return { title: `${label} · FlexSoar` };
}

interface CardSearchParams {
  error?: string;
  order?: string;
  redeemed?: string;
}

export default async function CardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<CardSearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const detail = await getCard(id);
  if (!detail) notFound();

  const meId = await currentUserId();
  const viewerLevel = await currentUserLevel();
  const isOwner = meId != null && detail.owner.id === meId;

  const listing = detail.listing
    ? await getListing(detail.listing.id).catch(() => null)
    : null;

  const card = toCardWithReason(detail);
  const sku = toSku(detail.sku);
  const listingForCard = listing
    ? toListing(listing, {
        cardId: listing.card_id,
        sellerId: listing.seller_id,
        createdAt: listing.created_at,
        soldAt: listing.sold_at,
      })
    : null;
  const oracleCents = detail.oracle_value_cents;
  const item = detail.item;

  return (
    <div className="flex flex-col gap-5">
      {sp.error && (
        <Banner tone="error" title="Couldn't do that">
          {sp.error}
        </Banner>
      )}
      {!sp.error && sp.redeemed === "1" && (
        <Banner tone="success" title="Redemption requested">
          The card claim is burned and the physical item is on the redemption
          hold for shipping.
        </Banner>
      )}

      <CardDetail
        card={card}
        sku={sku}
        priceCents={listing?.price_cents}
        listing={listingForCard}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-tight text-muted">
              Provenance
            </h2>
            <ProvenanceChain provenance={detail.provenance} />
          </div>

          {(oracleCents != null || item.grading_notes) && (
            <div className="flex flex-col gap-2 border border-line bg-overlay p-3">
              {oracleCents != null && (
                <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-tight text-muted">
                  <span>Oracle fair value</span>
                  <span className="text-foreground">
                    {formatFsc(oracleCents)}
                  </span>
                </div>
              )}
              {item.grading_notes && (
                <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                  {item.grading_notes}
                </p>
              )}
              <p className="font-mono text-[9px] uppercase tracking-tight text-muted">
                Graded {item.graded_at?.slice(0, 10) ?? "—"} · Authenticated{" "}
                {item.authenticated_at?.slice(0, 10) ?? "—"}
              </p>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          {isOwner ? (
            listing ? (
              <OwnerListingPanel listing={listing} />
            ) : detail.status === "active" ? (
              <>
                <ListForm cardId={detail.id} oracleValueCents={oracleCents} />
                <div>
                  <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-tight text-muted">
                    Redeem the physical card
                  </h2>
                  <RedeemForm
                    cardId={detail.id}
                    feeCents={REDEMPTION_HANDLING_FEE_CENTS}
                  />
                </div>
              </>
            ) : (
              <Banner tone="info" title={`Card is ${detail.status}`}>
                This card is not on the market and can&apos;t be listed or
                redeemed right now.
              </Banner>
            )
          ) : listing ? (
            <BuyPanel
              listing={{
                id: listing.id,
                cardId: listing.card_id,
                priceCents: listing.price_cents,
                oracleValueCents: listing.oracle_value_cents,
                status: listing.status,
                earlyAccessLevel: listing.early_access_level,
                publicAt: listing.public_at,
                sellerId: listing.seller_id,
              }}
              viewerId={meId}
              viewerLevel={viewerLevel}
              checkoutActive={sp.order === listing.id}
            />
          ) : (
            <Banner tone="info" title="Not on the market">
              This card is held by{" "}
              <a
                href={`/u/${detail.owner.handle}`}
                className="text-accent hover:underline"
              >
                @{detail.owner.handle}
              </a>{" "}
              and isn&apos;t listed for sale.
            </Banner>
          )}
        </section>
      </div>
    </div>
  );
}

function OwnerListingPanel({
  listing,
}: {
  listing: NonNullable<Awaited<ReturnType<typeof getListing>>>;
}) {
  const sold = listing.order != null;
  return (
    <div className="flex flex-col gap-3 border border-line bg-overlay p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={listing.status === "public" ? "accent" : "info"}>
          {listing.status}
        </Badge>
        {listing.status === "early_access" && (
          <Badge tone="info">early access LV {listing.early_access_level}</Badge>
        )}
        {sold && <Badge tone="warn">sold</Badge>}
      </div>

      <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-tight text-muted">
        <span>Ask</span>
        <span className="text-lg font-bold tracking-tight text-foreground">
          {formatFsc(listing.price_cents)}
        </span>
      </div>
      {listing.oracle_value_cents != null && (
        <p className="font-mono text-[10px] tracking-tight text-muted">
          Oracle fair value {formatFsc(listing.oracle_value_cents)}
        </p>
      )}

      {sold && listing.order && (
        <div className="flex flex-col gap-1 border border-line px-2 py-1.5 font-mono text-[10px] tracking-tight text-muted">
          <span>Order {listing.order.id.slice(0, 8)}… · {listing.order.status}</span>
          <span>
            Gross {formatFsc(listing.order.gross_cents)} · fee{" "}
            {formatFsc(listing.order.fee_cents)} · net{" "}
            {formatFsc(listing.order.net_cents)}
          </span>
        </div>
      )}

      {!sold ? (
        <form action={cancelListingAction} className="mt-1">
          <input type="hidden" name="listing_id" value={listing.id} />
          <Button type="submit" variant="danger" size="sm">
            Cancel listing
          </Button>
        </form>
      ) : (
        <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
          Listed {listing.created_at.slice(0, 10)} · the payment already
          settled and the card is theirs.
        </p>
      )}
    </div>
  );
}