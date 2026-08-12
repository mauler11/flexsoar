/**
 * components/admin/mint/MintTable.tsx
 *
 * The mintable list with checkboxes and the batch confirm.
 *
 * MINT_CAP_REACHED is the one failure an operator cannot fix by retrying, so
 * it gets its own loud badge; every other failure shows the server's words
 * verbatim. Successes drop out of the list on the revalidate; failures stay
 * on view next to their rows until the next attempt.
 */
"use client";

import { useState, useTransition } from "react";
import { batchMintAction, type BatchMintResult } from "@/app/admin/mint/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import type { ItemSummary } from "@/lib/api/contract";
import type { UUID } from "@/lib/db/types";

export function MintTable({ items }: { items: ItemSummary[] }) {
  const [selected, setSelected] = useState<ReadonlySet<UUID>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<BatchMintResult | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: UUID) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) =>
      current.size === items.length
        ? new Set()
        : new Set(items.map((item) => item.id)),
    );
  }

  function confirm() {
    const requests = items
      .filter((item) => selected.has(item.id))
      .map((item) => ({ itemId: item.id, consignorId: item.consignor_id }));
    startTransition(async () => {
      const outcome = await batchMintAction(requests);
      setResult(outcome);
      setConfirming(false);
      // Failed rows stay selected for the retry; minted ones leave the list.
      setSelected(new Set(outcome.outcomes.filter((o) => !o.ok).map((o) => o.itemId)));
    });
  }

  const failureFor = (itemId: UUID) =>
    result?.outcomes.find((o) => o.itemId === itemId && !o.ok);
  const minted = result?.outcomes.filter((o) => o.ok).length ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={pending || selected.size === 0}
        >
          {pending ? "Minting…" : `Mint ${selected.size || ""} card${selected.size === 1 ? "" : "s"}`}
        </Button>
        <span className="font-mono text-[10px] tracking-tight text-muted">
          Each mint is its own transaction; a failure on one item does not roll
          back the others.
        </span>
      </div>

      <div aria-live="polite" className="flex flex-col gap-1">
        {result?.message && (
          <p className="border border-[#FF4444] bg-overlay p-2 font-mono text-[11px] tracking-tight text-[#FF4444]">
            {result.message}
          </p>
        )}
        {result && minted > 0 && (
          <p className="border border-accent bg-overlay p-2 font-mono text-[11px] tracking-tight text-accent">
            {minted} card{minted === 1 ? "" : "s"} minted.
          </p>
        )}
      </div>

      <Table>
        <THead>
          <Tr>
            <Th>
              <input
                type="checkbox"
                aria-label="Select all"
                checked={items.length > 0 && selected.size === items.length}
                onChange={toggleAll}
                disabled={pending}
              />
            </Th>
            <Th>SKU</Th>
            <Th className="text-right">Float</Th>
            <Th className="text-right">Oracle</Th>
            <Th>Result</Th>
          </Tr>
        </THead>
        <TBody>
          {items.map((item) => {
            const fail = failureFor(item.id);
            return (
              <Tr key={item.id}>
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.sku.brand} ${item.sku.model}`}
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    disabled={pending}
                  />
                </Td>
                <Td>
                  <span className="text-foreground">
                    {item.sku.brand} {item.sku.model}
                  </span>
                  <span className="text-muted">
                    {" "}
                    · {item.sku.colorway} · US {item.sku.size_us}
                  </span>
                </Td>
                <Td className="text-right tabular-nums">
                  {item.float_value == null ? "—" : Number(item.float_value).toFixed(3)}
                </Td>
                <Td className="text-right tabular-nums text-muted">
                  {item.sku.market_price_cents == null ? (
                    // fn_mint_card refuses a SKU with no oracle price; flag it
                    // here so the failure is expected rather than surprising.
                    <span className="text-[#E8B33A]">no oracle price</span>
                  ) : (
                    `${(item.sku.market_price_cents / 100).toFixed(2)} FSC`
                  )}
                </Td>
                <Td>
                  {fail ? (
                    <div className="flex flex-col gap-0.5">
                      {fail.code === "MINT_CAP_REACHED" ? (
                        <Badge tone="danger">MINT CAP REACHED</Badge>
                      ) : (
                        <span className="font-mono text-[10px] uppercase tracking-tight text-[#FF4444]">
                          Failed{fail.code ? ` — ${fail.code}` : ""}
                        </span>
                      )}
                      <span className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                        {fail.message}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>

      <Modal
        open={confirming}
        onClose={() => !pending && setConfirming(false)}
        title={`Mint ${selected.size} card${selected.size === 1 ? "" : "s"}`}
        footer={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={confirm} disabled={pending}>
              {pending ? "Minting…" : "Confirm mint"}
            </Button>
          </>
        }
      >
        <p className="font-mono text-[11px] leading-snug tracking-tight">
          Each item becomes a card owned by its consignor, with the float copied
          across immutably and tier taken from the SKU&apos;s oracle price. A
          mint writes the append-only ledger — there is no unmint.
        </p>
      </Modal>
    </div>
  );
}
