/**
 * components/admin/skus/ArtUploader.tsx
 *
 * Uploads one SKU's pixel-art to Cloudflare R2, reusing the grading bench's
 * presigned-PUT pattern: the server action signs a short-lived URL and this
 * component PUTs the raw file bytes straight to R2 with fetch(). No base64,
 * no server-action body — art files can be large without touching Next's 1MB
 * action limit. The R2 access keys never leave the server.
 *
 * WHAT GETS SAVED: nothing, yet. The contract's Sku/UpsertSkuInput surface
 * does not carry art_url, so this track cannot persist the public URL into
 * skus.art_url (docs/handoff/admin.md). The component therefore stages the
 * upload — the admin sees the art land in R2 and the URL to copy — and hands
 * each uploaded URL to `onUploaded`. The day a contract write lands, the
 * wiring is one line and the staging note goes away.
 */

"use client";

import { useRef, useState, useTransition } from "react";
import { getSkuArtUploadUrlAction } from "@/app/admin/skus/actions";
import { Button } from "@/components/ui/Button";
import type { UUID } from "@/lib/db/types";

const MAX_ART_BYTES = 5 * 1024 * 1024;

export interface ArtUploaderProps {
  skuId: UUID;
  /** The current art_url, shown as a preview until a replacement lands. */
  currentArtUrl: string | null;
  onUploaded?: (url: string) => void;
}

export function ArtUploader({
  skuId,
  currentArtUrl,
  onUploaded,
}: ArtUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function upload(file: File) {
    if (file.size > MAX_ART_BYTES) {
      setError(
        `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)}MB; cap is ${MAX_ART_BYTES / (1024 * 1024)}MB`,
      );
      return;
    }

    startTransition(async () => {
      setUploading(true);
      setError(null);
      try {
        const outcome = await getSkuArtUploadUrlAction({
          skuId,
          filename: file.name,
          contentType: file.type || "image/png",
        });
        if (!outcome.ok) {
          setError(outcome.message);
          return;
        }

        const put = await fetch(outcome.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "image/png" },
          body: file,
        });
        if (!put.ok) {
          setError(
            `R2 refused the upload (HTTP ${put.status}) — check the bucket CORS policy, filed in docs/handoff/admin.md`,
          );
          return;
        }

        setUploadedUrl(outcome.publicUrl);
        onUploaded?.(outcome.publicUrl);
      } catch (thrown) {
        setError(thrown instanceof Error ? thrown.message : String(thrown));
      } finally {
        setUploading(false);
      }
    });
  }

  const preview = uploadedUrl ?? currentArtUrl;

  return (
    <div className="flex flex-col gap-2 border border-line bg-raised p-3">
      <h2 className="font-mono text-[13px] uppercase tracking-tight">
        Pixel art
      </h2>
      <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
        The card&apos;s artwork. Uploads go to Cloudflare R2; saving the URL onto
        the SKU awaits a contract write (docs/handoff/admin.md).
      </p>

      {preview ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- external host; see grading PhotoViewer */}
          <img
            src={preview}
            alt={`Art for this SKU: ${uploadedUrl ? "new upload" : "current"}`}
            className="h-20 w-20 border border-line bg-overlay object-contain"
          />
          <span className="font-mono text-[10px] tracking-tight text-muted">
            {uploadedUrl ? "New upload" : "Current"}
          </span>
        </div>
      ) : (
        <div className="flex h-20 w-20 items-center justify-center border border-dashed border-line-strong bg-overlay font-mono text-[10px] tracking-tight text-muted">
          no art
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Uploading…" : uploadedUrl ? "Replace art" : "Choose art"}
        </Button>
      </div>

      <div aria-live="polite">
        {error && (
          <div className="flex flex-col gap-1 border border-[#FF4444] bg-overlay p-2">
            <p className="font-mono text-[10px] uppercase tracking-tight text-[#FF4444]">
              Upload failed
            </p>
            <p className="font-mono text-[11px] leading-snug tracking-tight text-foreground">
              {error}
            </p>
          </div>
        )}
        {uploadedUrl && (
          <p className="border border-accent bg-overlay p-2 font-mono text-[11px] leading-snug tracking-tight break-all text-accent">
            Uploaded — {uploadedUrl}
          </p>
        )}
      </div>
    </div>
  );
}
