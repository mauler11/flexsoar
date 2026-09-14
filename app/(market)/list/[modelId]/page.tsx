/**
 * app/(market)/list/[modelId]/page.tsx
 *
 * The sell product page: the model's art on the left, the size run on the
 * right. Every size carries MAKE LIST into the intake (missing variants are
 * ensured on continue — sellers never see a dead size). SIZE CHART and
 * SELLER GUIDE open popups; neither navigates away mid-flow.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSkuModel, getPriceHistory, getModelRetail } from "@/lib/api/contract";
import { SizeChartButton } from "@/components/market/SizeChartModal";
import { SellerGuideButton } from "@/components/market/SellerGuideModal";
import { SizeGrid } from "@/components/market/SizeGrid";
import { PriceChart } from "@/components/market/PriceChart";
import { marketRead } from "@/lib/market/pricing";
import { formatMyr } from "@/components/card/format";
import type { UUID } from "@/lib/db/types";

export const metadata: Metadata = {
  title: "Sell your pair — FlexSoar Market",
};



export default async function ListProductPage({
  params,
}: {
  params: Promise<{ modelId: string }>;
}) {
  const { modelId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(modelId)) notFound();

  const model = await getSkuModel(modelId as UUID).catch(() => null);
  if (!model) notFound();

  const art =
    model.art_url ?? model.variants.find((v) => v.art_url)?.art_url ?? null;
  const existingSizes = new Set(model.variants.map((v) => v.size_us));

  // Trading tape: settled FlexSoar sales plus admin market refs, oldest
  // first. Empty until 053 lands or the first point is entered — the chart
  // renders its own empty state, never an error. The header's Fair Market
  // Price is derived from the same tape (median, trailing 90d) — nobody
  // types it — opening at the retail you entered while the tape is empty
  // (bootstrap: your ask stays yours regardless), then the base, then
  // nothing.
  const history = await getPriceHistory(model.id).catch(() => []);
  const retailCents = await getModelRetail(model.id).catch(() => null);
  const read = marketRead(history, retailCents);
  const marketPrice = read.fairMarket ?? retailCents ?? model.base_price_cents;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/list"
        className="w-fit text-[13px] font-semibold text-muted hover:text-foreground"
      >
        ← Back to search
      </Link>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-2xl border border-line bg-raised">
            {art ? (
              // eslint-disable-next-line @next/next/no-img-element -- external host, same call as CardArt
              <img
                src={art}
                alt={`${model.brand} ${model.model} ${model.colorway}`}
                className="aspect-square w-full object-contain"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center bg-overlay text-4xl font-extrabold text-muted">
                {model.brand.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              {model.brand} {model.model}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {model.colorway}
              {marketPrice != null
                ? ` · Fair Market Price ${formatMyr(marketPrice)}`
                : " · Unpriced — needs a fair price before it can mint"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-extrabold tracking-tight">
              Select size (US)
            </h2>
            <Link
              href="/list"
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-xl leading-none text-muted hover:bg-raised hover:text-foreground"
            >
              ×
            </Link>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <SizeChartButton />
            <span aria-hidden="true" className="text-muted">
              |
            </span>
            <SellerGuideButton />
          </div>

          <SizeGrid
            modelId={model.id}
            existingSizes={[...existingSizes]}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-line bg-raised px-4 py-3 text-[12px]">
            <span className="font-extrabold tracking-tight">Market read</span>
            {read.trend.direction !== "flat" ? (
              <span className={`font-bold tabular-nums ${read.trend.direction === "up" ? "text-accent" : "text-[#FF4444]"}`}>
                {read.trend.direction === "up" ? "▲" : "▼"}{" "}
                {Math.abs((read.trend.bps ?? 0) / 100).toFixed(1)}%
              </span>
            ) : (
              <span className="font-semibold text-muted">steady</span>
            )}
            {read.volatility.band && (
              <span className="tabular-nums text-muted">
                {read.volatility.band} · {read.volatility.pct?.toFixed(0)}% range
              </span>
            )}
            <span className="tabular-nums text-muted">
              {read.sales30d === 1 ? "1 sale" : `${read.sales30d} sales`} / 30d
            </span>
            {read.vsRetailPct != null && (
              <span className="tabular-nums text-muted">
                {read.vsRetailPct >= 0 ? "+" : ""}
                {read.vsRetailPct.toFixed(0)}% vs retail
              </span>
            )}
          </div>
          <p className="text-[12px] text-muted">{read.summary}</p>
        </div>
      </div>

      <PriceChart points={history} retailCents={retailCents} />
    </div>
  );
}
