/**
 * app/admin/skus/new/page.tsx
 *
 * Create a catalog MODEL (027) — brand + model + colourway + oracle price.
 * Sizes are added on the model's own page, not here: fn_ensure_sku_variant
 * needs a model_id to attach to, so a size cannot be authored before the
 * model exists.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/components/admin/auth";
import { SkuModelForm } from "@/components/admin/skus/SkuModelForm";

export const metadata: Metadata = {
  title: "New model — FlexSoar admin",
};

export default async function NewSkuModelPage() {
  await requireAdminPage("/admin/skus/new");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <nav className="font-mono text-[10px] uppercase tracking-tight text-muted">
        <Link href="/admin/skus" className="hover:text-foreground">
          ← Models
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-lg uppercase tracking-tight">New model</h1>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          brand + model + colorway is the unique catalog key. Add its first
          size and its art on the model&apos;s page once it exists.
        </p>
      </header>

      <SkuModelForm model={null} />
    </main>
  );
}
