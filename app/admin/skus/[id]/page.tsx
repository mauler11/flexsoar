/**
 * app/admin/skus/[id]/page.tsx
 *
 * Edit one MODEL (027): `id` is a sku_models id, not a skus (variant) id.
 * Base price and metadata write through updateSkuModel(); art writes through
 * replaceSkuArt() addressed via the model's first size, or straight onto
 * the model (setModelArtAction) when it has no sizes yet — see
 * ArtUploader.tsx. The size variants beneath it live in VariantsTable.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/components/admin/auth";
import { getVariantCardCounts } from "@/components/admin/db-reads";
import { ArtUploader } from "@/components/admin/skus/ArtUploader";
import { ArchiveModelForm } from "./ArchiveModelForm";
import { SkuModelForm } from "@/components/admin/skus/SkuModelForm";
import { VariantsTable } from "@/components/admin/skus/VariantsTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatMyr } from "@/components/card/format";
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

      <ArtUploader
        skuId={firstVariantId}
        modelId={model.id}
        currentArtUrl={model.art_url}
      />

      <VariantsTable
        modelId={model.id}
        modelBrand={`${model.brand} ${model.model}`}
        modelBasePriceCents={model.base_price_cents}
        variants={model.variants}
        cardCounts={Object.fromEntries(cardCounts)}
      />

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">Actions</h2>
        <ArchiveModelForm
          modelId={model.id}
          modelLabel={`${model.brand} ${model.model} · {model.colorway}`}
        />
      </section>
    </main>
  );
}
