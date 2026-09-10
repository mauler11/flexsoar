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
import { getSkuModel } from "@/lib/api/contract";
import { SizeChartButton } from "@/components/market/SizeChartModal";
import { SellerGuideButton } from "@/components/market/SellerGuideModal";
import { formatMyr } from "@/components/card/format";
import type { UUID } from "@/lib/db/types";

export const metadata: Metadata = {
  title: "Sell your pair — FlexSoar Market",
};

/** Standard US men's run,matching the size chart. Whole + half sizes 3–13. */
export const SIZE_RUN: readonly number[] = Array.from(
  { length: 21 },
  (_, i) => 3 + i * 0.5,
);

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
              {model.base_price_cents != null
                ? ` · Oracle ${formatMyr(model.base_price_cents)}`
                : " · Unpriced — admin sets the oracle before it can mint"}
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

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SIZE_RUN.map((size) => (
              <Link
                key={size}
                href={`/list/new?modelId=${model.id}&sizeUs=${size}`}
                aria-label={`List US size ${size}`}
                className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 text-center transition ${
                  existingSizes.has(size)
                    ? "border-line-strong bg-raised hover:border-accent"
                    : "border-dashed border-line-strong bg-raised/40 hover:border-accent"
                }`}
              >
                <span className="text-sm font-extrabold">US M {size}</span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Make list
                </span>
              </Link>
            ))}
          </div>
          <p className="text-xs text-muted">
            Dashed sizes aren&apos;t in the catalog yet — picking one creates
            the variant as part of your submission.
          </p>
        </div>
      </div>
    </div>
  );
}
