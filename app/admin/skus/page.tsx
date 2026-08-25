/**
 * app/admin/skus/page.tsx
 *
 * The catalog, at MODEL grain (027) — brand + model + colourway, one row per
 * model rather than one per size. Rows open the model's detail page, where
 * its size variants live; creation is its own page.
 *
 * Tier is shown from the model's oracle base price via tierForPrice — the
 * same derivation fn_tier_for_sku runs, never a stored value. An unpriced
 * model cannot mint (fn_mint_card refuses on a null tier), so it is the
 * operator's queue: badged, not hidden.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/components/admin/auth";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { listSkuModels } from "@/lib/api/contract";
import { borderColorFor, tierForPrice, tierName } from "@/lib/domain/rarity";

export const metadata: Metadata = {
  title: "Models — FlexSoar admin",
};

function money(cents: number | null): string {
  return cents == null ? "—" : `${(cents / 100).toFixed(2)} FSC`;
}

export default async function SkuModelsPage() {
  await requireAdminPage("/admin/skus");

  const models = await listSkuModels({ limit: 200 });
  const unpricedCount = models.filter((m) => m.base_price_cents == null).length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-mono text-lg uppercase tracking-tight">Models</h1>
          <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
            {models.length} in the catalog
            {unpricedCount > 0 ? ` · ${unpricedCount} unpriced — unmintable until priced` : ""}.
            One art asset and one oracle price per model; sizes live on its page.
          </p>
        </div>
        <Button size="sm" href="/admin/skus/new">
          New model
        </Button>
      </header>

      {models.length === 0 ? (
        <EmptyState
          title="Empty catalog"
          description="No models exist yet."
          action={<Button size="sm" href="/admin/skus/new">Create the first</Button>}
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Model</Th>
              <Th>Tier</Th>
              <Th className="text-right">Base price</Th>
              <Th>Art</Th>
              <Th className="text-right">Sizes</Th>
              <Th className="text-right">Cards</Th>
              <Th>
                <span className="sr-only">Open</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {models.map((model) => {
              const tier =
                model.base_price_cents == null ? null : tierForPrice(model.base_price_cents);
              return (
                <Tr key={model.id}>
                  <Td>
                    <span className="text-foreground">
                      {model.brand} {model.model}
                    </span>
                    <span className="text-muted"> · {model.colorway}</span>
                  </Td>
                  <Td>
                    {tier === null ? (
                      // Unmintable until priced — fn_mint_card raises on it.
                      <Badge tone="warn">unpriced</Badge>
                    ) : (
                      <span
                        className="font-mono text-[10px] uppercase tracking-tight"
                        style={{ color: borderColorFor(tier) }}
                      >
                        ■ {tierName(tier)}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{money(model.base_price_cents)}</Td>
                  <Td>
                    {model.art_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- external host; preview, unoptimised like the grading PhotoViewer
                      <img
                        src={model.art_url}
                        alt={`Art for ${model.brand} ${model.model}`}
                        className="h-8 w-8 border border-line bg-overlay object-contain"
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums text-muted">{model.variant_count}</Td>
                  <Td className="text-right tabular-nums text-muted">{model.card_count}</Td>
                  <Td>
                    <Link
                      href={`/admin/skus/${model.id}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      Open
                    </Link>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </main>
  );
}
