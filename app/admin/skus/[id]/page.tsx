/**
 * app/admin/skus/[id]/page.tsx
 *
 * Edit one MODEL (027): `id` is a sku_models id, not a skus (variant) id.
 * Base price and metadata write through updateSkuModel(); art writes through
 * replaceSkuArt() addressed via the model's first size (fn_replace_sku_art
 * takes a variant id even though it writes the model's art — see
 * ArtUploader.tsx); the size variants beneath it live in VariantsTable.
 *
 * Art is blocked until at least one size exists — fn_replace_sku_art has no
 * variant to address on a model with zero sizes, so there is no id to hand
 * it. Said in the UI, not just enforced by absence.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/components/admin/auth";
import { getVariantCardCounts } from "@/components/admin/db-reads";
import { ArtUploader } from "@/components/admin/skus/ArtUploader";
import { SkuModelForm } from "@/components/admin/skus/SkuModelForm";
import { VariantsTable } from "@/components/admin/skus/VariantsTable";
import { Badge } from "@/components/ui/Badge";
import { getSkuModel } from "@/lib/api/contract";
import { borderColorFor, tierForPrice, tierName } from "@/lib/domain/rarity";

export const metadata: Metadata = {
  title: "Edit model — FlexSoar admin",
};

export default async function EditSkuModelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminPage(`/admin/skus/${id}`);

  const model = await getSkuModel(id);
  if (!model) notFound();

  const cardCounts = await getVariantCardCounts(model.variants.map((v) => v.id));
  const totalCards = [...cardCounts.values()].reduce((sum, n) => sum + n, 0);

  const tier =
    model.base_price_cents == null ? null : tierForPrice(model.base_price_cents);
  const firstVariantId = model.variants[0]?.id ?? null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
      <nav className="font-mono text-[10px] uppercase tracking-tight text-muted">
        <Link href="/admin/skus" className="hover:text-foreground">
          ← Models
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-lg uppercase tracking-tight">
            {model.brand} {model.model}
          </h1>
          {tier === null ? (
            <Badge tone="warn">unpriced — unmintable</Badge>
          ) : (
            <span
              className="font-mono text-[10px] uppercase tracking-tight"
              style={{ color: borderColorFor(tier) }}
            >
              ■ {tierName(tier)}
            </span>
          )}
        </div>
        <p className="font-mono text-[10px] tracking-tight text-muted">
          {model.colorway} · {model.variants.length} size
          {model.variants.length === 1 ? "" : "s"} · {totalCards} card
          {totalCards === 1 ? "" : "s"} minted · {model.id}
        </p>
      </header>

      <SkuModelForm model={model} />

      {firstVariantId ? (
        <ArtUploader skuId={firstVariantId} currentArtUrl={model.art_url} />
      ) : (
        <div className="flex flex-col gap-2 border border-dashed border-line-strong bg-raised p-3">
          <h2 className="font-mono text-[13px] uppercase tracking-tight">Pixel art</h2>
          <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
            No size exists yet. fn_replace_sku_art writes this model&apos;s
            art through one of its size variants — with none, there is
            nothing to address it through. Add a size below first.
          </p>
        </div>
      )}

      <VariantsTable
        modelId={model.id}
        modelBrand={`${model.brand} ${model.model}`}
        modelBasePriceCents={model.base_price_cents}
        variants={model.variants}
        cardCounts={Object.fromEntries(cardCounts)}
      />
    </main>
  );
}
