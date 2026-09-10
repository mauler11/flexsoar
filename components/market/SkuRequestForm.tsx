"use client";

/**
 * components/market/SkuRequestForm.tsx
 *
 * Product Request: brand/model/colorway/size/notes plus at least one photo
 * (reuses the intake PhotoUploader + its R2 presigned flow). Submits to
 * submitSkuRequestAction — the row sits pending until an admin approves
 * (model + variant get created) or rejects with a note.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PhotoUploader } from "@/components/market/intake/PhotoUploader";
import type { IntakePhoto } from "@/components/market/intake/intake-config";
import { submitSkuRequestAction } from "@/app/(market)/list/actions";

export function SkuRequestForm() {
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [colorway, setColorway] = useState("");
  const [size, setSize] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<IntakePhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const uploaded = photos.filter((p) => p.url.startsWith("https://")).length;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const sizeUs = size.trim() === "" ? null : Number(size);
    startTransition(async () => {
      const result = await submitSkuRequestAction({
        brand,
        model,
        colorway,
        sizeUs,
        notes,
        photos: photos.map((p) => ({ url: p.url, angle: p.angle })),
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
          Our catalog team reviews every request. If your shoe checks out,
          it appears in search — you&apos;ll get a bell notification either
          way.
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
        <Input
          label="Colorway"
          value={colorway}
          onChange={(e) => setColorway(e.target.value)}
          placeholder="e.g. Triple White"
        />
        <Input
          label="US size"
          type="number"
          min="3"
          max="20"
          step="0.5"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="e.g. 9.5"
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Photos (at least one)
        </span>
        <PhotoUploader onChange={setPhotos} />
        <p className="text-xs text-muted">{uploaded} uploaded</p>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="request-notes"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          Notes for the catalog team (optional)
        </label>
        <textarea
          id="request-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="SKU/style code, where you saw it, anything identifying…"
          className="rounded-xl border border-line-strong bg-raised px-3 py-2 text-[13px] text-foreground placeholder:text-muted/50"
        />
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-[#FF4444]">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? "Sending…" : "Send product request"}
      </Button>
    </form>
  );
}
