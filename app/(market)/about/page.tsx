/**
 * app/(market)/about/page.tsx
 *
 * What FlexSoar is, in plain terms: authenticated sneakers where every
 * digital card is backed 1:1 by a physical pair.
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About Us — FlexSoar",
};

export default function AboutPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">About Us</h1>
        <p className="mt-1 text-sm text-muted">
          Buy. Sell. Redeem.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-raised p-5 text-[15px] leading-relaxed">
        <p>
          FlexSoar is a marketplace for authenticated sneakers. Every card on
          the market represents one real, physical pair — nothing here is a
          picture of a shoe.
        </p>
        <p className="text-muted">
          Sellers submit pairs with photos and honest condition. Our graders
          authenticate every submission before it lists. Buyers pay, sellers
          ship within 48 hours, and payouts release after the clearing hold.
          Own a card? Redeem it any time and the actual shoes ship to you.
        </p>
        <p className="text-muted">
          Every price is an ask between people — checked against a fair-price
          reference, never set by us.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/market"
          className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-[#0B0B0B] transition hover:brightness-110"
        >
          Explore the Market
        </Link>
        <Link
          href="/list"
          className="inline-flex items-center justify-center rounded-lg border border-line-strong bg-raised px-4 py-2.5 text-sm font-bold transition hover:border-muted"
        >
          Sell a Pair
        </Link>
      </div>
    </div>
  );
}
