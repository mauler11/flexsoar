/**
 * components/admin/skus/VariantsTable.tsx
 *
 * The size variants beneath one model (027). Each row is a `skus` row now
 * that size stopped being SKU identity: size, size curve multiplier, an
 * optional per-size price override, the DERIVED price (read from the row,
 * never recomputed here), and how many cards exist at that size.
 *
 * brand/model/colorway are deliberately NOT shown per row — they are the
 * model's, mirrored onto every variant by a trigger that overwrites whatever
 * is written there with no error. Showing them here would invite editing a
 * copy that cannot actually diverge.
 *
 * The override is the one field styled as an exception (task instruction):
 * collapsed behind a "Set override" control rather than sitting open like
 * the multiplier, and — while set — shown next to the model's own raw
 * base_price_cents rather than a recomputed number, because multiplying
 * base x multiplier in this file is exactly the "derived price in
 * TypeScript" AGENT_RULES forbids. The database's own market_price_cents
 * (always visible in the Price column) is the only real derived value.
 */
"use client";

import { useState, useTransition } from "react";
import {
  ensureSkuVariantAction,
  getSkuFloatCurveAction,
  updateSkuVariantAction,
} from "@/app/admin/skus/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import type { FloatCurveBand, Sku } from "@/lib/api/contract";
import type { Cents, UUID } from "@/lib/db/types";
import { FloatCurveEditor } from "./FloatCurveEditor";

function money(cents: Cents | null): string {
  return cents == null ? "—" : `${(cents / 100).toFixed(2)} FSC`;
}

interface RowDraft {
  multiplier: string;
  overrideOpen: boolean;
  override: string;
}

function draftFor(v: Sku): RowDraft {
  return {
    multiplier: v.size_multiplier == null ? "1.000" : Number(v.size_multiplier).toFixed(3),
    overrideOpen: v.price_override_cents != null,
    override: v.price_override_cents == null ? "" : String(v.price_override_cents),
  };
}

interface ParsedRow {
  ok: boolean;
  error: string | null;
  size_multiplier: number;
  price_override_cents: Cents | null;
}

function parseRow(draft: RowDraft): ParsedRow {
  const multText = draft.multiplier.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(multText) || Number(multText) <= 0 || Number(multText) > 10) {
    return { ok: false, error: "multiplier: 0 < x <= 10, three decimals", size_multiplier: 1, price_override_cents: null };
  }
  const multiplier = Number(multText);

  if (!draft.overrideOpen || draft.override.trim() === "") {
    return { ok: true, error: null, size_multiplier: multiplier, price_override_cents: null };
  }
  const overrideText = draft.override.trim();
  if (!/^\d+$/.test(overrideText) || Number(overrideText) <= 0) {
    return { ok: false, error: "override: integer cents only, > 0", size_multiplier: multiplier, price_override_cents: null };
  }
  return { ok: true, error: null, size_multiplier: multiplier, price_override_cents: Number(overrideText) };
}

export interface VariantsTableProps {
  modelId: UUID;
  modelBrand: string;
  modelBasePriceCents: Cents | null;
  variants: Sku[];
  cardCounts: Record<string, number>;
}

export function VariantsTable({
  modelId,
  modelBrand,
  modelBasePriceCents,
  variants,
  cardCounts,
}: VariantsTableProps) {
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() =>
    Object.fromEntries(variants.map((v) => [v.id, draftFor(v)])),
  );
  const [rowResult, setRowResult] = useState<Record<string, string | null>>({});
  const [confirmingRow, setConfirmingRow] = useState<Sku | null>(null);
  const [pending, startTransition] = useTransition();

  const [newSize, setNewSize] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, startAddTransition] = useTransition();

  const [curveFor, setCurveFor] = useState<Sku | null>(null);
  const [curveBands, setCurveBands] = useState<FloatCurveBand[] | null>(null);
  const [curveError, setCurveError] = useState<string | null>(null);
  const [curveLoading, startCurveTransition] = useTransition();

  function draftOf(v: Sku): RowDraft {
    return drafts[v.id] ?? draftFor(v);
  }

  function patch(skuId: UUID, changes: Partial<RowDraft>) {
    setDrafts((current) => ({
      ...current,
      [skuId]: { ...(current[skuId] ?? draftFor(variants.find((v) => v.id === skuId)!)), ...changes },
    }));
    setRowResult((current) => ({ ...current, [skuId]: null }));
  }

  function requestSave(v: Sku) {
    const parsed = parseRow(draftOf(v));
    if (!parsed.ok) {
      setRowResult((current) => ({ ...current, [v.id]: parsed.error }));
      return;
    }
    setConfirmingRow(v);
  }

  function confirmSave() {
    if (!confirmingRow) return;
    const v = confirmingRow;
    const parsed = parseRow(draftOf(v));
    if (!parsed.ok) return;
    startTransition(async () => {
      const outcome = await updateSkuVariantAction(v.id, modelId, {
        size_multiplier: parsed.size_multiplier,
        price_override_cents: parsed.price_override_cents,
      });
      setRowResult((current) => ({
        ...current,
        [v.id]: outcome.ok ? null : `${outcome.message}${outcome.code ? ` (${outcome.code})` : ""}`,
      }));
      setConfirmingRow(null);
    });
  }

  function addSize() {
    setAddError(null);
    const text = newSize.trim();
    if (!/^\d{1,2}(\.\d)?$/.test(text)) {
      setAddError("US size, whole or half — e.g. 9 or 9.5");
      return;
    }
    const size = Number(text);
    if (size < 3 || size > 20) {
      setAddError("size must be between 3 and 20");
      return;
    }
    if (size * 2 !== Math.floor(size * 2)) {
      setAddError("size must be a whole or half size");
      return;
    }
    startAddTransition(async () => {
      const outcome = await ensureSkuVariantAction(modelId, size);
      if (!outcome.ok) {
        setAddError(`${outcome.message}${outcome.code ? ` (${outcome.code})` : ""}`);
        return;
      }
      setNewSize("");
    });
  }

  function openCurve(v: Sku) {
    setCurveFor(v);
    setCurveBands(null);
    setCurveError(null);
    startCurveTransition(async () => {
      const outcome = await getSkuFloatCurveAction(v.id);
      if (!outcome.ok) {
        setCurveError(outcome.message);
        return;
      }
      setCurveBands(outcome.bands);
    });
  }

  const cellClass =
    "w-24 border border-line-strong bg-overlay px-1.5 py-1 font-mono text-[12px] tracking-tight text-foreground disabled:opacity-40";

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-mono text-[13px] uppercase tracking-tight">Sizes</h2>
      <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
        One row per size variant. Multiplier and override change this
        size&apos;s price only — never brand, model or colorway, which are the
        model&apos;s and are overwritten here on write, silently, by design.
      </p>

      {variants.length === 0 ? (
        <p className="border border-dashed border-line-strong bg-overlay p-3 font-mono text-[11px] leading-snug tracking-tight text-muted">
          No sizes yet. Add one below — this model cannot mint or carry art
          until it has at least one.
        </p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Size</Th>
              <Th>Multiplier</Th>
              <Th>Override</Th>
              <Th className="text-right">Price</Th>
              <Th className="text-right">Cards</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {variants.map((v) => {
              const draft = draftOf(v);
              const error = rowResult[v.id];
              return (
                <Tr key={v.id}>
                  <Td className="tabular-nums">US {v.size_us}</Td>
                  <Td>
                    <input
                      aria-label={`US ${v.size_us} multiplier`}
                      value={draft.multiplier}
                      onChange={(e) => patch(v.id, { multiplier: e.target.value })}
                      inputMode="decimal"
                      disabled={pending}
                      className={cellClass}
                    />
                  </Td>
                  <Td>
                    {draft.overrideOpen ? (
                      <div className="flex flex-col gap-0.5">
                        <input
                          aria-label={`US ${v.size_us} price override, cents`}
                          value={draft.override}
                          onChange={(e) => patch(v.id, { override: e.target.value })}
                          inputMode="numeric"
                          placeholder="cents"
                          disabled={pending}
                          className={cellClass}
                        />
                        <div className="flex items-center gap-1">
                          {modelBasePriceCents != null && (
                            <span className="font-mono text-[9px] tracking-tight text-muted">
                              model base {money(modelBasePriceCents)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => patch(v.id, { overrideOpen: false, override: "" })}
                            disabled={pending}
                            className="font-mono text-[9px] uppercase tracking-tight text-muted underline-offset-2 hover:text-foreground hover:underline"
                          >
                            clear
                          </button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => patch(v.id, { overrideOpen: true })} disabled={pending}>
                        Set override
                      </Button>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{money(v.market_price_cents)}</Td>
                  <Td className="text-right tabular-nums">{cardCounts[v.id] ?? 0}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => requestSave(v)} disabled={pending}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openCurve(v)} disabled={pending}>
                        Curve
                      </Button>
                    </div>
                    {error && (
                      <p className="mt-1 font-mono text-[10px] tracking-tight text-[#FF4444]">{error}</p>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}

      <div className="flex flex-wrap items-end gap-2 border border-line bg-raised p-2">
        <Input
          label="Add size (US)"
          value={newSize}
          onChange={(e) => {
            setNewSize(e.target.value);
            setAddError(null);
          }}
          inputMode="decimal"
          placeholder="9.5"
          disabled={addPending}
        />
        <Button size="sm" onClick={addSize} disabled={addPending || newSize.trim() === ""}>
          {addPending ? "Adding…" : "Add size"}
        </Button>
        {addError && (
          <span className="font-mono text-[10px] tracking-tight text-[#FF4444]">{addError}</span>
        )}
      </div>

      <Modal
        open={confirmingRow !== null}
        onClose={() => !pending && setConfirmingRow(null)}
        title={confirmingRow ? `Save US ${confirmingRow.size_us}` : undefined}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingRow(null)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmSave} disabled={pending}>
              {pending ? "Saving…" : "Confirm save"}
            </Button>
          </>
        }
      >
        <p className="font-mono text-[11px] leading-snug tracking-tight">
          Changes this size&apos;s derived price immediately — every card
          already minted at US {confirmingRow?.size_us} of {modelBrand} is
          valued off the new number the moment it saves.
        </p>
      </Modal>

      <Modal
        open={curveFor !== null}
        onClose={() => setCurveFor(null)}
        title={curveFor ? `Float curve — US ${curveFor.size_us}` : undefined}
      >
        {curveLoading && curveBands === null && !curveError && (
          <p className="font-mono text-[11px] tracking-tight text-muted">Loading…</p>
        )}
        {curveError && (
          <p className="font-mono text-[11px] tracking-tight text-[#FF4444]">{curveError}</p>
        )}
        {curveFor && curveBands !== null && (
          <FloatCurveEditor skuId={curveFor.id} initialBands={curveBands} />
        )}
      </Modal>
    </section>
  );
}
