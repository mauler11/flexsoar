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
import { getListings, getPlatformConfig } from "@/lib/api/contract";
import {
  currentUserId,
  getHiddenCardIds,
  getPublicProfileByHandle,
  getTradeHistory,
} from "@/app/(market)/queries";
import { toggleTradeHistoryAction } from "@/app/(market)/actions";
import { MarketTile } from "@/components/market/MarketTile";
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

  const [live, trades, hiddenIds, platformConfig] = await Promise.all([
    holdingsVisible ? getListings({ sellerId: profile.id }) : Promise.resolve([]),
    holdingsVisible ? getTradeHistory(profile.id) : Promise.resolve([]),
    getHiddenCardIds(profile.id),
    getPlatformConfig(),
  ]);

  // 046: per-shoe hiding applies on top of the master switch.
  const visibleLive = live.filter((l) => !hiddenIds.has(l.card_id));
  const visibleTrades = trades.filter((t) => !hiddenIds.has(t.cardId));
  const tradesVisible = profile.show_trade_history || isOwner;

  const joined = profile.created_at.slice(0, 10);

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
        <dl className="flex gap-6 font-mono text-[10px] uppercase tracking-tight">
          <div>
            <dt className="text-muted">Xp</dt>
            <dd className="text-foreground">{profile.xp_total.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted">Portfolio</dt>
            <dd className="text-foreground">{formatMyr(profile.portfolio_value_cents)}</dd>
          </div>
        </dl>
      </section>

      {!holdingsVisible && (
        <EmptyState
          title="Private collection"
          description="This seller keeps their holdings hidden."
        />
      )}

      {holdingsVisible && (
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
      )}

      {holdingsVisible && tradesVisible && (
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Trade history ({visibleTrades.length})
          </h2>
          {isOwner && (
            <div className="flex items-center gap-1 text-xs text-muted">
              <span>Show trade history:</span>
              <form action={toggleTradeHistoryAction.bind(null, true, `/u/${handle}`)}>
                <button
                  type="submit"
                  aria-pressed={profile.show_trade_history}
                  className={
                    profile.show_trade_history
                      ? "rounded-md bg-accent px-2 py-0.5 font-bold text-[#0B0B0B]"
                      : "rounded-md px-2 py-0.5 hover:text-foreground"
                  }
                >
                  Yes
                </button>
              </form>
              <form action={toggleTradeHistoryAction.bind(null, false, `/u/${handle}`)}>
                <button
                  type="submit"
                  aria-pressed={!profile.show_trade_history}
                  className={
                    !profile.show_trade_history
                      ? "rounded-md bg-accent px-2 py-0.5 font-bold text-[#0B0B0B]"
                      : "rounded-md px-2 py-0.5 hover:text-foreground"
                  }
                >
                  No
                </button>
              </form>
            </div>
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
      )}
    </div>
  );
}