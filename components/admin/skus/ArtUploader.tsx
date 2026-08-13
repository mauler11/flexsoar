/**
 * components/admin/skus/ArtUploader.tsx
 *
 * Uploads one SKU's pixel-art to Cloudflare R2, reusing the grading bench's
 * presigned-PUT pattern: the server action signs a short-lived URL and this
 * component PUTs the raw file bytes straight to R2 with fetch(). No base64,
 * no server-action body — art files can be large without touching Next's 1MB
 * action limit. The R2 access keys never leave the server.
 *
 * Art is stored PER SKU, not per card: every listing of the same model and
 * colourway shares this one image. That is why an overwrite is guarded —
 * replacing it changes cards users already own — and why the submission
 * review bench (mode="review") never offers to overwrite at all.
 */

"use client";

import { useRef, useState, useTransition } from "react";
import {
  getSkuArtUploadUrlAction,
  replaceSkuArtAction,
  setSkuArtUrlAction,
} from "@/app/admin/skus/actions";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { UUID } from "@/lib/db/types";

const MAX_ART_BYTES = 5 * 1024 * 1024;

export interface ArtUploaderProps {
  skuId: UUID;
  /** The current art_url, shown as a preview until a replacement lands. */
  currentArtUrl: string | null;
  /**
   * "edit" (the SKU page) allows a fresh upload freely and an overwrite of
   * existing art behind an explicit confirmation. "review" (a submission's
   * review bench) never overwrites: existing art renders read-only with a
   * note to change it from the SKU page, and upload is offered only when the
   * SKU has none yet.
   */
  mode?: "edit" | "review";
  onUploaded?: (url: string) => void;
}

export function ArtUploader({
  skuId,
  currentArtUrl,
  mode = "edit",
  onUploaded,
}: ArtUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [, startTransition] = useTransition();

  const art = savedUrl ?? currentArtUrl;
  const readOnly = mode === "review" && art !== null;

  function upload(file: File) {
    startTransition(async () => {
      setUploading(true);
      setError(null);
      const replacing = art !== null;
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

        const saved = replacing
          ? await replaceSkuArtAction(skuId, outcome.publicUrl)
          : await setSkuArtUrlAction(skuId, outcome.publicUrl);
        if (!saved.ok) {
          setError(saved.message);
          return;
        }

        setSavedUrl(outcome.publicUrl);
        onUploaded?.(outcome.publicUrl);
      } catch (thrown) {
        setError(thrown instanceof Error ? thrown.message : String(thrown));
      } finally {
        setUploading(false);
        setPendingFile(null);
        setConfirming(false);
      }
    });
  }

  function pickFile(file: File) {
    if (file.size > MAX_ART_BYTES) {
      setError(
        `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)}MB; cap is ${MAX_ART_BYTES / (1024 * 1024)}MB`,
      );
      return;
    }
    setError(null);

    if (art !== null) {
      // Overwriting existing art changes every card of this SKU already in
      // someone's hands — require the explicit step before it writes.
      setPendingFile(file);
      setConfirming(true);
      return;
    }
    upload(file);
  }

  if (readOnly) {
    return (
      <div className="flex flex-col gap-2 border border-line bg-raised p-3">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Pixel art
        </h2>
        <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
          This SKU already has artwork — shared by every card of this model
          and colourway. Change it from the SKU page, not here.
        </p>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- external host; see grading PhotoViewer */}
          <img
            src={art!}
            alt="Current art for this SKU"
            className="h-20 w-20 border border-line bg-overlay object-contain"
          />
          <span className="font-mono text-[10px] tracking-tight text-muted">
            Current
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border border-line bg-raised p-3">
      <h2 className="font-mono text-[13px] uppercase tracking-tight">
        Pixel art
      </h2>
      <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
        The SKU&apos;s artwork — shared by every card of this model and
        colourway, not just one.
      </p>

      {art ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- external host; see grading PhotoViewer */}
          <img
            src={art}
            alt="Art for this SKU"
            className="h-20 w-20 border border-line bg-overlay object-contain"
          />
          <span className="font-mono text-[10px] tracking-tight text-muted">
            {savedUrl ? "Saved" : "Current"}
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
          if (file) pickFile(file);
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
          {uploading ? "Uploading…" : art ? "Replace art" : "Choose art"}
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
        {savedUrl && (
          <p className="border border-accent bg-overlay p-2 font-mono text-[11px] leading-snug tracking-tight break-all text-accent">
            Saved — {savedUrl}
          </p>
        )}
      </div>

      <Modal
        open={confirming}
        onClose={() => {
          if (uploading) return;
          setConfirming(false);
          setPendingFile(null);
        }}
        title="Replace artwork for all cards of this SKU"
        footer={
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={uploading}
              onClick={() => {
                setConfirming(false);
                setPendingFile(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={uploading}
              onClick={() => pendingFile && upload(pendingFile)}
            >
              {uploading ? "Uploading…" : "Replace artwork for all cards of this SKU"}
            </Button>
          </>
        }
      >
        <p className="font-mono text-[11px] leading-snug tracking-tight">
          Every card minted from this SKU — this model, colourway and size —
          shares one artwork. Replacing it changes how cards users already own
          are shown, everywhere they are shown.
        </p>
      </Modal>
    </div>
  );
}
