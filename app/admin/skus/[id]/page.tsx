/**
 * app/admin/skus/[id]/page.tsx
 *
 * Edit one SKU: the catalog fields and the float curve, both writing through
 * the contract. The SKU and its curve are read through local adapters —
 * neither has a single-row contract read yet (docs/handoff/admin.md items
 * 2-adjacent and 4).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/components/admin/auth";
import { getAdminSku, getSkuFloatCurve } from "@/components/admin/db-reads";
import { ArtUploader } from "@/components/admin/skus/ArtUploader";
import { FloatCurveEditor } from "@/components/admin/skus/FloatCurveEditor";
import { SkuForm } from "@/components/admin/skus/SkuForm";
import { Badge } from "@/components/ui/Badge";
import { borderColorFor, tierForPrice, tierName } from "@/lib/domain/rarity";

export const metadata: Metadata = {
  title: "Edit SKU — FlexSoar admin",
};

export default async function EditSkuPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminPage(`/admin/skus/${id}`);

  const [sku, curve] = await Promise.all([getAdminSku(id), getSkuFloatCurve(id)]);
  if (!sku) notFound();

  const tier =
    sku.market_price_cents == null ? null : tierForPrice(sku.market_price_cents);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
      <nav className="font-mono text-[10px] uppercase tracking-tight text-muted">
        <Link href="/admin/skus" className="hover:text-foreground">
          ← Catalog
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-lg uppercase tracking-tight">
            {sku.brand} {sku.model}
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
          {sku.colorway} · US {sku.size_us} · {sku.id}
        </p>
      </header>

      <SkuForm sku={sku} />

      <ArtUploader skuId={sku.id} currentArtUrl={sku.art_url} />

      <FloatCurveEditor skuId={sku.id} initialBands={curve} />
    </main>
  );
}
