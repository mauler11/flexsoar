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

const STEPS: ReadonlyArray<{ title: string; hot?: boolean }> = [
  { title: "Search for the product you'd like to sell." },
  { title: "Submit your pair — photos, honest condition, your price." },
  { title: "We authenticate it and your listing goes live." },
  { title: "Ship within 48 hours when it sells.", hot: true },
  { title: "Receive your payout after the clearing hold." },
  { title: "One flat 5% platform fee on every sale — no tiers, no surprises." },
];

export default function ListLandingPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-8">
      <ListSearch />

      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex items-center gap-3 text-[15px]">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-black text-[#0B0B0B]"
            >
              {i + 1}
            </span>
            <span className={step.hot ? "font-bold text-foreground" : "text-muted"}>
              {step.title}
            </span>
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
