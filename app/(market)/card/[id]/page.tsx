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
import { getCard, getListing, getItem, getCreditAvailable, getPayoutMethodForUser, getUser } from "@/lib/api/contract";
import type { CardStatus } from "@/lib/db/types";
import {
  currentUserId,
  currentUserLevel,
  REDEMPTION_HANDLING_FEE_CENTS,
  getVaultIntakeForCard,
  type VaultIntakeStatus,
} from "@/app/(market)/queries";
import { cancelListingAction } from "@/app/(market)/actions";
import { toCardWithReason, toListing, toSku } from "@/components/market/bridge";
import { CardDetail } from "@/components/card/CardDetail";
import { Banner } from "@/components/market/Banner";
import { BuyPanel } from "@/components/market/BuyPanel";
import { ListForm } from "@/components/market/ListForm";
import { RedeemForm } from "@/components/market/RedeemForm";
import { ProvenanceChain } from "@/components/market/ProvenanceChain";
import { Countdown } from "@/components/market/Countdown";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatUsd } from "@/components/card/format";

/**
 * 023a_card_status_pending_vault.sql added 'pending_vault' to the live
 * `card_status` enum, but `CardStatus` in lib/db/types.ts (track/data's
 * lane) still only lists 'active' | 'locked' | 'burned' | 'redeemed' — the
 * mirror hasn't caught up. Filed in docs/handoff/market.md. Rather than a
 * cast, this widens the TYPE the value is read as (CardStatus is a subtype
 * of this union, so the assignment below needs no `as`), which is enough to
 * compare against the real runtime value the database actually sends.
 */
type CardStatusWithVault = CardStatus | "pending_vault";

/**
 * A plain `someCardStatus === "pending_vault"` inline comparison still fails
 * type-checking even after widening a variable to `CardStatusWithVault` —
 * TypeScript's literal-comparability check (TS2367) narrows a `const` back to
 * its initializer's literal type for that specific diagnostic, ignoring the
 * wider declared annotation. Routing the comparison through a function
 * parameter sidesteps it (a parameter's declared type is what's compared
 * against, not the literal type of whatever was passed in) with no cast.
 */
function isPendingVault(status: CardStatusWithVault): boolean {
  return status === "pending_vault";
}

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

  // Buyer-only reads. Skipped entirely for the owner and for signed-out
  // visitors — neither can buy this listing, so there's nothing to fetch.
  const isBuyerViewing = !isOwner && listing != null;
  const [availableCreditCents, itemCustody] = await Promise.all([
    isBuyerViewing && meId != null ? getCreditAvailable().catch(() => null) : null,
    isBuyerViewing ? getItem(detail.item.id).catch(() => null) : null,
  ]);
  const firstSalePending = itemCustody?.custody === "seller";

  // Seller-only read: how THEY will be paid, before they commit to listing.
  // fn_payout_method_for_user is geography-derived and never a client choice
  // (AGENT_RULES.md §5) — this is read-only disclosure, not a control.
  const canListNow = isOwner && !listing && detail.status === "active";
  const sellerPayoutMethod = canListNow
    ? await getPayoutMethodForUser(detail.owner.id).catch(() => null)
    : null;
  // fn_list_card calls fn_payout_method_for_user internally and (025) raises
  // COUNTRY_NOT_SET for a seller with none on file. This screen is the only
  // place a card the owner already holds (not one filed through the intake
  // wizard) can be listed, so ListForm needs the on-file value directly —
  // not just the derived payout method above, which the catch(() => null)
  // above can't distinguish from any other read failure.
  const ownerCountryCode = canListNow
    ? (await getUser({ id: detail.owner.id }).catch(() => null))?.country_code ?? null
    : null;

  const vaultIntake: VaultIntakeStatus | null =
    isOwner && isPendingVault(detail.status)
      ? await getVaultIntakeForCard(detail.id).catch(() => null)
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
                    {formatUsd(oracleCents)}
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
            ) : isPendingVault(detail.status) ? (
              <PendingVaultPanel intake={vaultIntake} />
            ) : detail.status === "active" ? (
              <>
                <ListForm
                  cardId={detail.id}
                  oracleValueCents={oracleCents}
                  sellerPayoutMethod={sellerPayoutMethod}
                  countryCode={ownerCountryCode}
                />
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
              availableCreditCents={availableCreditCents}
              firstSalePending={firstSalePending}
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

/**
 * The card's owner (the buyer of a first sale) sees this while the shoe is
 * in transit to FlexSoar. Deliberately not a Banner tone="error" — this is
 * an expected, temporary state (023c_vault_custody.sql), not a failure.
 */
function PendingVaultPanel({ intake }: { intake: VaultIntakeStatus | null }) {
  return (
    <div className="flex flex-col gap-3 border border-line bg-overlay p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">Pending vault</Badge>
        {intake && <Badge tone="info">{intake.status.replace("_", " ")}</Badge>}
      </div>

      <Banner tone="info" title="Yours — waiting on the vault">
        This card is yours, but it&apos;s frozen until the physical shoe
        reaches FlexSoar. It can&apos;t be resold, traded, or redeemed while
        pending vault — that&apos;s not an error, it&apos;s the 48-hour window
        every first sale goes through so no one after you is trusting a
        stranger they&apos;ve never dealt with.
      </Banner>

      {intake && intake.status !== "received" && (
        <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-tight text-muted">
          <span>Seller must ship by</span>
          <Countdown target={intake.dueBy} className="text-accent" />
        </div>
      )}

      {intake?.trackingNumber ? (
        <p className="font-mono text-[10px] tracking-tight text-muted">
          Shipped via {intake.carrier ?? "carrier"} · tracking{" "}
          {intake.trackingNumber}
        </p>
      ) : (
        <p className="font-mono text-[10px] tracking-tight text-muted">
          Not yet marked shipped by the seller.
        </p>
      )}

      <p className="font-mono text-[9px] uppercase tracking-tight text-muted">
        If the seller misses the deadline, this sale is cancelled and you are
        refunded in full and in kind — no action needed from you.
      </p>
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
          {formatUsd(listing.price_cents)}
        </span>
      </div>
      {listing.oracle_value_cents != null && (
        <p className="font-mono text-[10px] tracking-tight text-muted">
          Oracle fair value {formatUsd(listing.oracle_value_cents)}
        </p>
      )}

      {sold && listing.order && (
        <div className="flex flex-col gap-1 border border-line px-2 py-1.5 font-mono text-[10px] tracking-tight text-muted">
          <span>Order {listing.order.id.slice(0, 8)}… · {listing.order.status}</span>
          <span>
            Gross {formatUsd(listing.order.gross_cents)} · fee{" "}
            {formatUsd(listing.order.fee_cents)} · net{" "}
            {formatUsd(listing.order.net_cents)}
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