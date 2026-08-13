/**
 * app/admin/skus/page.tsx
 *
 * The catalog. Rows open the edit screen; creation is its own page. Writes
 * go through upsertSku()/setFloatCurve() on the edit screens — the read-only
 * era ended when the contract grew them.
 *
 * Tier is shown from the oracle price via tierForPrice — display of the same
 * derivation fn_mint_card runs, never a stored value.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/components/admin/auth";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { getSkus } from "@/lib/api/contract";
import { borderColorFor, tierForPrice, tierName } from "@/lib/domain/rarity";

export const metadata: Metadata = {
  title: "SKUs — FlexSoar admin",
};

function money(cents: number | null): string {
  return cents == null ? "—" : `${(cents / 100).toFixed(2)} FSC`;
}

export default async function SkusPage() {
  await requireAdminPage("/admin/skus");

  const skus = await getSkus({ limit: 200 });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-mono text-lg uppercase tracking-tight">SKUs</h1>
          <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
            {skus.length} in the catalog. Tier derives from the oracle price —
            the float never changes it.
          </p>
        </div>
        <Button size="sm" href="/admin/skus/new">
          New SKU
        </Button>
      </header>

      {skus.length === 0 ? (
        <EmptyState
          title="Empty catalog"
          description="No SKUs exist yet."
          action={<Button size="sm" href="/admin/skus/new">Create the first</Button>}
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>SKU</Th>
              <Th>Tier</Th>
              <Th className="text-right">Retail</Th>
              <Th className="text-right">Oracle</Th>
              <Th className="text-right">Confidence</Th>
              <Th className="text-right">Mint cap</Th>
              <Th>Sprite</Th>
              <Th>Art</Th>
              <Th>
                <span className="sr-only">Edit</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {skus.map((sku) => {
              const tier =
                sku.market_price_cents == null
                  ? null
                  : tierForPrice(sku.market_price_cents);
              return (
                <Tr key={sku.id}>
                  <Td>
                    <span className="text-foreground">
                      {sku.brand} {sku.model}
                    </span>
                    <span className="text-muted">
                      {" "}
                      · {sku.colorway} · US {sku.size_us}
                    </span>
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
                  <Td className="text-right tabular-nums text-muted">
                    {money(sku.retail_price_cents)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {money(sku.market_price_cents)}
                  </Td>
                  <Td className="text-right tabular-nums text-muted">
                    {sku.price_confidence == null
                      ? "—"
                      : Number(sku.price_confidence).toFixed(2)}
                  </Td>
                  <Td className="text-right tabular-nums text-muted">
                    {sku.mint_cap ?? "uncapped"}
                  </Td>
                  <Td className="text-muted">
                    {sku.sprite_key ?? "—"}
                    {sku.palette != null ? " · palette" : " · no palette"}
                  </Td>
                  <Td>
                    {sku.art_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- external host; preview, unoptimised like the grading PhotoViewer
                      <img
                        src={sku.art_url}
                        alt={`Art for ${sku.brand} ${sku.model}`}
                        className="h-8 w-8 border border-line bg-overlay object-contain"
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/skus/${sku.id}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      Edit
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
