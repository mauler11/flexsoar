"use client";

/**
 * components/market/SkuRequestForm.tsx
 *
 * Product Request: brand + model + colorway only. The goal is growing the
 * catalog — sizes are picked later from the product page, photos and grading
 * happen at submission time. Submit files the row; an admin approval creates
 * the model and notifies the requester.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { submitSkuRequestAction } from "@/app/(market)/list/actions";

export function SkuRequestForm() {
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [colorway, setColorway] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitSkuRequestAction({
        brand,
        model,
        colorway,
        sizeUs: null,
        notes: "",
        photos: [],
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-accent bg-accent/10 p-4">
        <h3 className="text-sm font-extrabold uppercase tracking-tight text-foreground">
          Request received
        </h3>
        <p className="text-[13px] leading-relaxed text-muted">
          Our catalog team reviews every request. Once approved, the shoe
          appears in search with every size ready to list — you&apos;ll get a
          bell notification either way.
        </p>
        <div className="flex gap-2">
          <Button variant="primary" size="md" href="/list">
            Back to search
          </Button>
          <Button variant="secondary" size="md" href="/dashboard">
            Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="e.g. Nike"
          required
        />
        <Input
          label="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. Air Force 1 '07"
          required
        />
      </div>
      <Input
        label="Colorway"
        value={colorway}
        onChange={(e) => setColorway(e.target.value)}
        placeholder="e.g. Triple White"
        hint="The exact colourway name as it appears on the box or product page."
      />

      {error && (
        <p role="alert" className="text-[13px] text-[#FF4444]">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? "Sending…" : "Send Product Request"}
      </Button>
    </form>
  );
}
