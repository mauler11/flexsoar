import type { Metadata } from "next";
import { MarketSearchView } from "@/components/market/MarketSearchOverlay";

export const metadata: Metadata = {
  title: "Search — FlexSoar Market",
};

export default function SearchPage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
      <MarketSearchView />
    </div>
  );
}
