/**
 * components/admin/grading/PhotoViewer.tsx
 *
 * The 8-shot intake set: one large view, thumbnails to switch. The photos are
 * what a dispute is settled against, so the viewer's only job is to show them
 * big and let the grader flick through in order.
 *
 * Plain <img>, deliberately: intake photos live on an external host, and
 * next/image would need that host allow-listed in next.config.ts — a file
 * outside this track's lane. Unoptimised is fine for an internal tool.
 */
"use client";

import { useState } from "react";
import { cn } from "@/components/ui/cn";
import type { ItemPhoto } from "./photos";

export function PhotoViewer({ photos }: { photos: ItemPhoto[] }) {
  const [index, setIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 border border-dashed border-line-strong bg-raised px-4 py-10 text-center">
        <p className="font-mono text-[12px] font-bold uppercase tracking-tight">
          No photos
        </p>
        <p className="font-mono text-[10px] tracking-tight text-muted">
          The rubric requires the 8-shot set before a float can be entered.
        </p>
      </div>
    );
  }

  const current = photos[Math.min(index, photos.length - 1)];

  return (
    <figure className="flex flex-col gap-2">
      <div className="border border-line bg-overlay">
        {/* eslint-disable-next-line @next/next/no-img-element -- external host; see header */}
        <img
          src={current.url}
          alt={`Intake photo: ${current.label}`}
          className="max-h-96 w-full object-contain"
        />
      </div>
      <figcaption className="font-mono text-[10px] uppercase tracking-tight text-muted">
        {index + 1}/{photos.length} · {current.label}
      </figcaption>
      <div className="flex flex-wrap gap-1">
        {photos.map((photo, i) => (
          <button
            key={`${photo.url}-${i}`}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show ${photo.label}`}
            aria-current={i === index ? "true" : undefined}
            className={cn(
              "border p-0.5",
              i === index
                ? "border-accent"
                : "border-line-strong hover:border-muted",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- external host; see header */}
            <img
              src={photo.url}
              alt=""
              className="h-14 w-14 object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>
    </figure>
  );
}
