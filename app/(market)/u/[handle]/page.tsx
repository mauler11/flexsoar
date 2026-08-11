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
import { getListings } from "@/lib/api/contract";
import {
  currentUserId,
  getPublicProfileByHandle,
  getTradeHistory,
} from "@/app/(market)/queries";
import { MarketTile } from "@/components/market/MarketTile";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatFsc, formatUsd } from "@/components/card/format";

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

  const [live, trades] = await Promise.all([
    getListings({ sellerId: profile.id, viewerId: viewerId ?? undefined }),
    getTradeHistory(profile.id),
  ]);

  const joined = profile.created_at.slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center justify-between gap-3 border border-line bg-overlay p-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center border border-accent bg-accent font-mono text-sm font-black text-[#0B0B0B]"
          >
            {profile.handle.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h1 className="font-mono text-lg font-black tracking-tight">
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
            <dd className="text-foreground">{formatUsd(profile.portfolio_value_cents)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-tight text-muted">
          Live listings ({live.length})
        </h2>
        {live.length === 0 ? (
          <EmptyState
            title="Nothing listed"
            description="This account has no live listings right now."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {live.map((listing) => (
              <MarketTile key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-tight text-muted">
          Trade history ({trades.length})
        </h2>
        {trades.length === 0 ? (
          <EmptyState
            title="No trades yet"
            description="This account hasn't acquired or released any cards."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border border-line bg-overlay font-mono text-[11px] tracking-tight">
              <thead>
                <tr className="border-b border-line text-[9px] uppercase tracking-tight text-muted">
                  <th className="px-2 py-1.5 text-left">Card</th>
                  <th className="px-2 py-1.5 text-left">Mint</th>
                  <th className="px-2 py-1.5 text-left">Acquired</th>
                  <th className="px-2 py-1.5 text-left">Released</th>
                  <th className="px-2 py-1.5 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
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
                      {trade.priceCents != null ? formatFsc(trade.priceCents) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}