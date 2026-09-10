/**
 * app/(market)/list/page.tsx
 *
 * The sell landing: a centered product search over the live catalog. Pick a
 * result to open its product page (sizes live there); a miss offers the
 * Product Request path. The steps below describe the real flow — submit
 * with photos, authentication, live listing, ship on sale, payout after
 * the hold — never instant offers or prepaid labels, which don't exist here.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ListSearch } from "@/components/market/ListSearch";

export const metadata: Metadata = {
  title: "Sell — FlexSoar Market",
};

const STEPS: ReadonlyArray<{ title: string }> = [
  { title: "Search for the product you'd like to sell." },
  { title: "Submit your pair — photos, honest condition, your price." },
  { title: "We authenticate it and your listing goes live." },
  { title: "Ship within 48 hours when it sells." },
  { title: "Receive your payout after the clearing hold." },
  { title: "Sell more, level up, unlock lower selling fees." },
];

export default function ListLandingPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-8">
      <ListSearch />

      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex items-center gap-3 text-[15px]">
            <span className="font-bold text-foreground">{i + 1}.</span>
            <span className="text-muted">{step.title}</span>
          </li>
        ))}
      </ol>

      <p className="text-center text-sm">
        <Link href="/terms" className="font-semibold text-accent hover:underline">
          Seller FAQ
        </Link>
      </p>
    </div>
  );
}
