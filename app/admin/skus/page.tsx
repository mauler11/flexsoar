/**
 * app/admin/skus/page.tsx
 *
 * The catalog. READ-ONLY for now, deliberately: 009 gave skus and
 * sku_float_curve admin write policies, but AGENT_RULES routes every write
 * through the contract and the contract has no SKU write functions — the
 * create/edit forms arrive with createSku()/updateSku(), filed in
 * docs/handoff/admin.md. Building the forms against a direct table write
 * would work today and be the exact second write path the contract exists
 * to prevent.
 *
 * Tier is shown from the oracle price via tierForPrice — display of the same
 * derivation fn_mint_card runs, never a stored value.
 */

import type { Metadata } from "next";
import { requireAdminPage } from "@/components/admin/auth";
import { Badge } from "@/components/ui/Badge";
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
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-lg uppercase tracking-tight">SKUs</h1>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          {skus.length} in the catalog. Tier derives from the oracle price —
          the float never changes it.
        </p>
      </header>

      <p className="border border-[#E8B33A] bg-overlay p-2 font-mono text-[10px] leading-snug tracking-tight text-[#E8B33A]">
        Read-only. 009 unblocked SKU writes at the database, but all writes go
        through the contract and it has no createSku()/updateSku() yet — the
        CRUD forms arrive with them. Filed in docs/handoff/admin.md.
      </p>

      {skus.length === 0 ? (
        <EmptyState title="Empty catalog" description="No SKUs exist yet." />
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
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </main>
  );
}
