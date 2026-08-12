"use client";

/**
 * components/market/intake/SkuRequestForm.tsx
 *
 * The "not listed" path: file a request (handoff M2 → fn_file_sku_request).
 * Called with the already-selected brand/model if the seller searched first —
 * that prefills the form so the least amount of retyping happens.
 */

import { useState, useTransition } from "react";
import { fileSkuRequestAction } from "@/app/(market)/list/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export interface SkuRequestFormProps {
  /** Prefilled when the seller typed a brand/model that didn't match. */
  initialBrand?: string;
  initialModel?: string;
  onDone: (requestId: string) => void;
  onBack: () => void;
}

export function SkuRequestForm({
  initialBrand = "",
  initialModel = "",
  onDone,
  onBack,
}: SkuRequestFormProps) {
  const [brand, setBrand] = useState(initialBrand);
  const [model, setModel] = useState(initialModel);
  const [colorway, setColorway] = useState("");
  const [size, setSize] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await fileSkuRequestAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDone(result.requestId);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="border border-dashed border-[#E8B33A]/60 bg-[#E8B33A]/5 px-3 py-2 font-mono text-[10px] tracking-tight text-muted">
        We price new SKUs in batches. Filing a request adds this shoe to the
        queue — we&apos;ll notify you once it&apos;s in the catalog.
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Brand"
          name="brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          required
        />
        <Input
          label="Model"
          name="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          required
        />
        <Input
          label="Colorway"
          name="colorway"
          placeholder="e.g. Chicago"
          value={colorway}
          onChange={(e) => setColorway(e.target.value)}
        />
        <Input
          label="US size"
          name="size"
          type="number"
          min="0.5"
          step="0.5"
          placeholder="e.g. 9.5"
          value={size}
          onChange={(e) => setSize(e.target.value)}
        />
      </div>

      <Input
        label="Notes (optional)"
        name="notes"
        placeholder="Box included, rare release, anything helpful"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && (
        <p className="font-mono text-[10px] tracking-tight text-[#FF4444]">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          back
        </Button>
        <Button type="submit" size="md" disabled={isPending}>
          {isPending ? "filing…" : "file request"}
        </Button>
      </div>
    </form>
  );
}