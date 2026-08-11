/**
 * components/admin/skus/FloatCurveEditor.tsx
 *
 * Edit a SKU's value-by-condition curve. Save REPLACES the whole curve —
 * setFloatCurve() is replace-all because fn_float_multiplier takes the first
 * matching band and stale leftovers would silently change valuations. An
 * empty table clears the curve back to the linear fallback, which is a real
 * state, so clearing gets its own confirm rather than being an accident.
 *
 * Validation mirrors the contract's exactly (0 ≤ min < max ≤ 1, no overlaps,
 * non-negative multiplier) so the operator hears about a bad band before the
 * save instead of from the thrown UNKNOWN.
 */
"use client";

import { useState, useTransition } from "react";
import { setFloatCurveAction } from "@/app/admin/skus/actions";
import type { ActionResult } from "@/components/admin/action-result";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import type { FloatCurveBand } from "@/lib/api/contract";
import type { UUID } from "@/lib/db/types";

interface BandDraft {
  float_min: string;
  float_max: string;
  value_multiplier: string;
}

function draftsFrom(bands: FloatCurveBand[]): BandDraft[] {
  return bands.map((band) => ({
    float_min: Number(band.float_min).toFixed(3),
    float_max: Number(band.float_max).toFixed(3),
    value_multiplier: Number(band.value_multiplier).toFixed(3),
  }));
}

type ParsedBands =
  | { ok: true; bands: FloatCurveBand[] }
  | { ok: false; error: string };

/** Same rules setFloatCurve() enforces; numeric(4,3) precision throughout. */
function parseBands(drafts: BandDraft[]): ParsedBands {
  const bands: FloatCurveBand[] = [];
  for (const [index, draft] of drafts.entries()) {
    const three = /^\d(\.\d{1,3})?$/;
    if (
      !three.test(draft.float_min.trim()) ||
      !three.test(draft.float_max.trim()) ||
      !three.test(draft.value_multiplier.trim())
    ) {
      return { ok: false, error: `row ${index + 1}: three decimals, 0.000 style` };
    }
    const band = {
      float_min: Number(draft.float_min),
      float_max: Number(draft.float_max),
      value_multiplier: Number(draft.value_multiplier),
    };
    if (!(band.float_min >= 0 && band.float_min < band.float_max && band.float_max <= 1)) {
      return { ok: false, error: `row ${index + 1}: need 0 ≤ min < max ≤ 1` };
    }
    bands.push(band);
  }
  const sorted = [...bands].sort((a, b) => a.float_min - b.float_min);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].float_min < sorted[i - 1].float_max) {
      return {
        ok: false,
        error: `bands overlap at ${sorted[i].float_min.toFixed(3)}`,
      };
    }
  }
  return { ok: true, bands: sorted };
}

export function FloatCurveEditor({
  skuId,
  initialBands,
}: {
  skuId: UUID;
  initialBands: FloatCurveBand[];
}) {
  const [drafts, setDrafts] = useState<BandDraft[]>(() => draftsFrom(initialBands));
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseBands(drafts);
  const clearing = drafts.length === 0;

  function setCell(index: number, key: keyof BandDraft, value: string) {
    setDrafts((current) =>
      current.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
    setResult(null);
  }

  function addRow() {
    setDrafts((current) => [
      ...current,
      { float_min: "", float_max: "", value_multiplier: "" },
    ]);
  }

  function removeRow(index: number) {
    setDrafts((current) => current.filter((_, i) => i !== index));
    setResult(null);
  }

  function save() {
    if (!parsed.ok) return;
    startTransition(async () => {
      const outcome = await setFloatCurveAction(skuId, parsed.bands);
      setResult(outcome);
      setConfirming(false);
    });
  }

  const cellClass =
    "w-full border border-line-strong bg-overlay px-1.5 py-1 font-mono text-[12px] tracking-tight text-foreground disabled:opacity-40";

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-mono text-[13px] uppercase tracking-tight">Float curve</h2>
      <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
        Value multiplier by condition band, [min, max). Saving replaces the
        whole curve. No rows = the linear fallback in fn_float_multiplier.
      </p>

      <Table>
        <THead>
          <Tr>
            <Th>Float min (incl.)</Th>
            <Th>Float max (excl.)</Th>
            <Th>Multiplier</Th>
            <Th>
              <span className="sr-only">Remove</span>
            </Th>
          </Tr>
        </THead>
        <TBody>
          {drafts.length === 0 ? (
            <Tr>
              {/* components/ui Td has no colSpan prop; raw cell, same classes */}
              <td className="px-2 py-1.5 align-top text-muted" colSpan={4}>
                No bands — this SKU is on the linear fallback.
              </td>
            </Tr>
          ) : (
            drafts.map((row, index) => (
              <Tr key={index}>
                <Td>
                  <input
                    aria-label={`Band ${index + 1} float min`}
                    value={row.float_min}
                    onChange={(e) => setCell(index, "float_min", e.target.value)}
                    inputMode="decimal"
                    placeholder="0.000"
                    disabled={pending}
                    className={cellClass}
                  />
                </Td>
                <Td>
                  <input
                    aria-label={`Band ${index + 1} float max`}
                    value={row.float_max}
                    onChange={(e) => setCell(index, "float_max", e.target.value)}
                    inputMode="decimal"
                    placeholder="0.070"
                    disabled={pending}
                    className={cellClass}
                  />
                </Td>
                <Td>
                  <input
                    aria-label={`Band ${index + 1} multiplier`}
                    value={row.value_multiplier}
                    onChange={(e) =>
                      setCell(index, "value_multiplier", e.target.value)
                    }
                    inputMode="decimal"
                    placeholder="1.000"
                    disabled={pending}
                    className={cellClass}
                  />
                </Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeRow(index)}
                    disabled={pending}
                  >
                    Remove
                  </Button>
                </Td>
              </Tr>
            ))
          )}
        </TBody>
      </Table>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={addRow} disabled={pending}>
          Add band
        </Button>
        <Button
          size="sm"
          variant={clearing ? "danger" : "primary"}
          onClick={() => setConfirming(true)}
          disabled={pending || !parsed.ok}
        >
          {clearing ? "Clear curve" : "Save curve"}
        </Button>
        {!parsed.ok && (
          <span className="font-mono text-[10px] tracking-tight text-[#FF4444]">
            {parsed.error}
          </span>
        )}
      </div>

      <div aria-live="polite">
        {result?.ok && (
          <p className="border border-accent bg-overlay p-2 font-mono text-[11px] tracking-tight text-accent">
            Curve saved.
          </p>
        )}
        {result && !result.ok && (
          <div className="flex flex-col gap-1 border border-[#FF4444] bg-overlay p-2">
            <p className="font-mono text-[10px] uppercase tracking-tight text-[#FF4444]">
              Curve save failed{result.code ? ` — ${result.code}` : ""}
            </p>
            <p className="font-mono text-[11px] leading-snug tracking-tight text-foreground">
              {result.message}
            </p>
            {result.code === "FORBIDDEN" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                RLS filtered the write to nothing — this session is not an
                admin. The curve is unchanged.
              </p>
            )}
          </div>
        )}
      </div>

      <Modal
        open={confirming}
        onClose={() => !pending && setConfirming(false)}
        title={clearing ? "Clear float curve" : "Replace float curve"}
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
            <Button
              size="sm"
              variant={clearing ? "danger" : "primary"}
              onClick={save}
              disabled={pending}
            >
              {pending ? "Saving…" : "Confirm"}
            </Button>
          </>
        }
      >
        <p className="font-mono text-[11px] leading-snug tracking-tight">
          {clearing
            ? "Removes every band. The SKU falls back to the linear multiplier until a curve is saved again — card valuations change immediately."
            : `Replaces the current curve with ${drafts.length} band${drafts.length === 1 ? "" : "s"}. Valuations of every card on this SKU change immediately.`}
        </p>
      </Modal>
    </section>
  );
}
