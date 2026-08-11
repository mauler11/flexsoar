/**
 * app/admin/mint/page.tsx
 *
 * Items that have cleared the bench — graded, authenticated, in custody —
 * and not yet minted. Selection and the batch confirm live in the client
 * table; this page is just the read.
 *
 * `card_id === null` filters out the already-minted: an in_custody status
 * with a card should not occur (mint sets status to minted in the same
 * transaction), but the mint is the last irreversible step in the pipeline,
 * and this screen double-checks rather than trusts.
 */

import type { Metadata } from "next";
import { requireAdminPage } from "@/components/admin/auth";
import { MintTable } from "@/components/admin/mint/MintTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { getItems } from "@/lib/api/contract";

export const metadata: Metadata = {
  title: "Mint — FlexSoar admin",
};

export default async function MintPage() {
  await requireAdminPage("/admin/mint");

  const ready = (
    await getItems({
      status: ["in_custody"],
      graded: true,
      authenticated: true,
      limit: 200,
    })
  ).filter((item) => item.card_id === null);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-lg uppercase tracking-tight">Mint</h1>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          Graded, authenticated, unminted. Tier comes from the SKU&apos;s oracle
          price — the float never changes it.
        </p>
      </header>

      {ready.length === 0 ? (
        <EmptyState
          title="Nothing to mint"
          description="No item is graded, authenticated and still cardless."
        />
      ) : (
        <MintTable items={ready} />
      )}
    </main>
  );
}
