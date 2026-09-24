/**
 * app/(market)/u/[handle]/page.tsx
 *
 * A public profile: the public_profiles view stats, the account's live
 * listings (visibility-filtered for the caller), and its trade history from
 * card_provenance. Never reads the `users` table — every read here is shared
 * with the anon key or granted on the view.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCards, getListings, getPlatformConfig, getRedemptions, getPriceHistory, listSkuModels } from "@/lib/api/contract";
import {
  currentUserId,
  getHiddenCardIds,
  getMySubmittedItems,
  getPublicProfileByHandle,
  getTradeHistory,
} from "@/app/(market)/queries";
import { MarketTile } from "@/components/market/MarketTile";
import { HeldCard } from "@/components/market/HeldCard";
import { DashboardTabs } from "@/components/market/DashboardTabs";
import { PlGraph } from "@/components/market/PlGraph";
import { ProfileTabs } from "@/components/market/ProfileTabs";
import { TradeToggle } from "@/components/market/TradeToggle";
import { portfolioSeries } from "@/lib/market/portfolio";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatMyr } from "@/components/card/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const profile = await getPublicProfileByHandle(handle).catch(() => null);
  return {
    title: profile ? `@${profile.handle} · FlexSoar` : "Profile · FlexSoar",
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const viewerId = await currentUserId();

  const profile = await getPublicProfileByHandle(handle);
  if (!profile) notFound();

  // 045: hidden collections show holdings to nobody but the owner.
  const isOwner = viewerId != null && viewerId === profile.id;
  const holdingsVisible = profile.show_collection || isOwner;

  const [live, trades, ownedCards, hiddenIds, platformConfig] = await Promise.all([
    holdingsVisible ? getListings({ sellerId: profile.id }) : Promise.resolve([]),
    holdingsVisible ? getTradeHistory(profile.id) : Promise.resolve([]),
    holdingsVisible
      ? getCards({
          ownerId: profile.id,
          // Pending-vault cards are still yours — see dashboard's
          // HELD_CARD_STATUSES note on the CardStatus/023a gap.
          status: ["active", "locked", "pending_vault"] as NonNullable<
            Parameters<typeof getCards>[0]
          >["status"],
          limit: 200,
        }).catch(() => [])
      : Promise.resolve([]),
    getHiddenCardIds(profile.id),
    getPlatformConfig(),
  ]);

  // Owner-only seller sections (absorbed from /dashboard): submissions and
  // redemptions. Visitors never fetch these.
  const [submittedItems, redemptions] = isOwner
    ? await Promise.all([
        getMySubmittedItems(profile.id).catch(() => []),
        getRedemptions({ userId: profile.id }).catch(() => []),
      ])
    : [[], []];

  // 046: per-shoe hiding applies on top of the master switch. Owners see
  // their own hidden shoes ghosted (so the toggle visibly does something);
  // everyone else never sees them at all.
  const visibleLive = live.filter((l) => !hiddenIds.has(l.card_id));
  const listedCardIds = new Set(visibleLive.map((l) => l.card_id));
  const collection = ownedCards.filter((c) => !listedCardIds.has(c.id));
  const visibleCollection = collection.filter((c) => !hiddenIds.has(c.id));
  const shownCollection = isOwner
    ? collection.map((c) => ({ card: c, hidden: hiddenIds.has(c.id) }))
    : visibleCollection.map((c) => ({ card: c, hidden: false }));
  const visibleTrades = trades.filter((t) => !hiddenIds.has(t.cardId));
  const tradesVisible = profile.show_trade_history || isOwner;

  const livePriceByCardId = new Map(visibleLive.map((l) => [l.card_id, l.price_cents]));

  // Portfolio matches exactly what the profile shows: live ask prices plus
  // the oracle market price of unlisted collection shoes on display.
  const visiblePortfolioCents =
    visibleLive.reduce((sum, l) => sum + l.price_cents, 0) +
    shownCollection
      .filter((s) => !s.hidden)
      .reduce((sum, s) => sum + (s.card.sku.market_price_cents ?? 0), 0);

  const joined = profile.created_at.slice(0, 10);

  // Owner-only portfolio graph inputs: open-hop cost/acquired date per
  // card plus each distinct model's tape (resolved once, cached per model).
  // Visitors never pay for these reads. Empty book → flat zero line.
  let series = {
    points: [] as Array<{ tMs: number; valueCents: number }>,
    valuedCount: 0,
    totalCount: 0,
    costCents: 0,
    currentCents: 0,
  };
  if (isOwner && holdingsVisible && ownedCards.length > 0) {
    const openHop = new Map<string, { cost: number | null; acquiredAtMs: number }>();
    for (const t of trades) {
      if (t.releasedAt == null && !openHop.has(t.cardId)) {
        openHop.set(t.cardId, {
          cost: t.priceCents,
          acquiredAtMs: new Date(t.acquiredAt).getTime(),
        });
      }
    }
    const distinct = new Map<string, { brand: string; model: string; colorway: string }>();
    for (const c of ownedCards) {
      distinct.set(`${c.sku.brand}|${c.sku.model}|${c.sku.colorway}`, c.sku);
    }
    const tapeByKey = new Map<string, Array<{ tMs: number; priceCents: number }>>();
    await Promise.all(
      [...distinct.entries()].map(async ([key, sku]) => {
        const models = await listSkuModels({ brand: sku.brand, model: sku.model }).catch(() => []);
        const match = models.find((m) => m.colorway === sku.colorway) ?? null;
        const history = match ? await getPriceHistory(match.id).catch(() => []) : [];
        tapeByKey.set(
          key,
          history.map((p) => ({ tMs: new Date(p.observedAt).getTime(), priceCents: p.priceCents })),
        );
      }),
    );
    series = portfolioSeries(
      ownedCards.map((c) => {
        const hop = openHop.get(c.id);
        return {
          cardId: c.id,
          acquiredAtMs: hop ? hop.acquiredAtMs : Date.now(),
          costCents: hop?.cost ?? null,
          tape: tapeByKey.get(`${c.sku.brand}|${c.sku.model}|${c.sku.colorway}`) ?? [],
          fallbackCents: livePriceByCardId.get(c.id) ?? c.sku.market_price_cents ?? null,
        };
      }),
      30,
      Date.now(),
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center justify-between gap-3 border border-line bg-overlay p-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-full border border-accent bg-accent text-sm font-black text-[#0B0B0B]"
          >
            {profile.handle.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">
              @{profile.handle}
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
              {profile.rankName} · LV {profile.level} · joined {joined}
            </p>
          </div>
        </div>
        <dl className="flex gap-6 text-xs">
          <div>
            <dt className="uppercase tracking-wide text-muted">Xp</dt>
            <dd className="font-semibold text-foreground">{profile.xp_total.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-muted">Cards</dt>
            <dd className="font-semibold text-foreground">{visibleLive.length + collection.length}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-muted">Portfolio</dt>
            <dd className="font-semibold text-foreground" title="Live asks plus shown collection value">
              {formatMyr(visiblePortfolioCents)}
            </dd>
          </div>
        </dl>
      </section>

      {isOwner && holdingsVisible && (
        <PlGraph
          points30={series.points}
          costCents={series.costCents}
          valuedCount={series.valuedCount}
          totalCount={series.totalCount}
        />
      )}

      {!holdingsVisible ? (
        <EmptyState
          title="Private collection"
          description="This seller keeps their holdings hidden."
        />
      ) : (
        <ProfileTabs
          tabs={[
            {
              id: "collections",
              label: "Collections",
              count: shownCollection.length,
              content: (
                <>
              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Collection ({shownCollection.length})
                  </h2>
                </div>
                {shownCollection.length === 0 ? (
                  <EmptyState
                    title="No shoes on display"
                    description="Nothing in the collection right now."
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {shownCollection.map(({ card, hidden }) => {
                      const ask = livePriceByCardId.get(card.id) ?? null;
                      const oracle = card.sku.market_price_cents ?? null;
                      return (
                        <div key={card.id} className="relative">
                          {hidden && (
                            <span className="absolute left-2 top-2 z-10 rounded-md bg-overlay/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted">
                              Hidden
                            </span>
                          )}
                          <div className={hidden ? "opacity-60" : undefined}>
                            <HeldCard
                              card={card}
                              statusLabel="In collection"
                              shownInProfile={!hidden}
                              showToggle={isOwner}
                              priceCents={ask ?? oracle}
                              priceCaption={ask != null ? "Ask" : oracle != null ? "Market" : undefined}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
                </>
              ),
            },
            {
              id: "listings",
              label: "Listings",
              count: visibleLive.length,
              content: (
                <>
                  <section>
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      Live listings ({visibleLive.length})
                    </h2>
                    {visibleLive.length === 0 ? (
                      <EmptyState
                        title="Nothing listed"
                        description="This account has no live listings right now."
                      />
                    ) : (
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                        {visibleLive.map((listing) => (
                          <MarketTile
                            key={listing.id}
                            listing={listing}
                            showNumericFloat={platformConfig.show_numeric_float}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                </>
              ),
            },
            {
              id: "activity",
              label: "Activity",
              count: tradesVisible ? visibleTrades.length : 0,
              content: (
            tradesVisible ? (
              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Trade history ({visibleTrades.length})
                  </h2>
                  {/* The toggle only earns its space when there is something to
                      hide — at zero trades it is clutter with no function. It
                      returns the moment trades (or a hidden history) exist. */}
                  {isOwner && (visibleTrades.length > 0 || !profile.show_trade_history) && (
                    <TradeToggle handle={handle} initial={profile.show_trade_history} />
                  )}
                </div>
                {visibleTrades.length === 0 ? (
                  <EmptyState
                    title="No trades yet"
                    description="This account hasn't acquired or released any cards."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border border-line bg-overlay text-[11px]">
                      <thead>
                        <tr className="border-b border-line text-[9px] uppercase tracking-wide text-muted">
                          <th className="px-2 py-1.5 text-left">Card</th>
                          <th className="px-2 py-1.5 text-left">Mint</th>
                          <th className="px-2 py-1.5 text-left">Acquired</th>
                          <th className="px-2 py-1.5 text-left">Released</th>
                          <th className="px-2 py-1.5 text-right">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTrades.map((trade) => (
                          <tr key={`${trade.cardId}-${trade.acquiredAt}`} className="border-b border-line last:border-b-0">
                            <td className="px-2 py-1.5">
                              <a
                                href={`/card/${trade.cardId}`}
                                className="text-accent hover:underline"
                              >
                                {trade.cardLabel}
                              </a>
                            </td>
                            <td className="px-2 py-1.5">
                              #{String(trade.mintNumber).padStart(2, "0")}
                            </td>
                            <td className="px-2 py-1.5 text-muted">
                              {trade.acquiredAt.slice(0, 10)}
                            </td>
                            <td className="px-2 py-1.5 text-muted">
                              {trade.releasedAt ? trade.releasedAt.slice(0, 10) : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              {trade.priceCents != null ? formatMyr(trade.priceCents) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : (
              <EmptyState
                title="Trade history is private"
                description="This seller keeps their trading activity hidden."
              />
              )),
            },
          ]}
        />
      )}

      {isOwner && (
        <DashboardTabs
          submittedItems={submittedItems}
          heldItems={[]}
          heldCards={[]}
          redemptions={redemptions}
          visibility={{}}
          visibleTabs={["submissions", "redemptions"]}
        />
      )}
    </div>
  );
}