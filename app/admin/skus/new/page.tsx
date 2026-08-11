/**
 * app/admin/skus/new/page.tsx
 *
 * Create a catalog SKU. On success the form routes to the edit screen, where
 * the float curve lives — a curve needs a sku_id to attach to, so it cannot
 * be authored here.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/components/admin/auth";
import { SkuForm } from "@/components/admin/skus/SkuForm";

export const metadata: Metadata = {
  title: "New SKU — FlexSoar admin",
};

export default async function NewSkuPage() {
  await requireAdminPage("/admin/skus/new");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <nav className="font-mono text-[10px] uppercase tracking-tight text-muted">
        <Link href="/admin/skus" className="hover:text-foreground">
          ← Catalog
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-lg uppercase tracking-tight">New SKU</h1>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          brand + model + colorway + size is the unique catalog key.
        </p>
      </header>

      <SkuForm sku={null} />
    </main>
  );
}
