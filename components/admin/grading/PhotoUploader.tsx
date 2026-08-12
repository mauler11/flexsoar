/**
 * components/admin/grading/PhotoUploader.tsx
 *
 * Uploads one intake photo for an item to Cloudflare R2.
 *
 * HOW: the server action signs a short-lived presigned PUT URL, and this
 * component PUTs the raw file bytes straight to R2 with fetch(). No base64,
 * no server-action body — photos can be megabytes without touching Next's
 * 1MB action limit. The R2 access keys never leave the server.
 *
 * WHAT GETS SAVED: nothing, yet. `items` has no UPDATE policy and the
 * contract has no write for photos, so this track cannot persist the public
 * URL into items.photos (docs/handoff/admin.md). The component therefore
 * stages uploads in local state — the grader sees the shot land in R2 and the
 * URL to copy — and passes each uploaded URL to `onUploaded`. The day a
 * contract write lands, the page wires it through and this becomes a normal
 * save-then-refresh flow; the staging list is the honest interim.
 */

"use client";

import { useRef, useState, useTransition } from "react";
import {
  getItemPhotoUploadUrlAction,
  type PhotoUploadResult,
} from "@/app/admin/grading/actions";
import { Button } from "@/components/ui/Button";
import type { UUID } from "@/lib/db/types";

/** Mirror of the cap in the signed-URL action. */
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export interface StagedUpload {
  url: string;
  label: string;
}

export interface PhotoUploaderProps {
  itemId: UUID;
  /** Why uploads are off (minted, wrong status, …) — shown on the button. */
  blocked?: string | null;
  /** Called with each successfully uploaded public URL. */
  onUploaded?: (upload: StagedUpload) => void;
}

export function PhotoUploader({ itemId, blocked, onUploaded }: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<PhotoUploadResult | null>(null);
  const [, startTransition] = useTransition();
  const disabled = Boolean(blocked) || uploading;

  async function upload(file: File) {
    if (file.size > MAX_PHOTO_BYTES) {
      setResult({
        ok: false,
        message: `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)}MB; cap is ${MAX_PHOTO_BYTES / (1024 * 1024)}MB`,
      });
      return;
    }

    startTransition(async () => {
      setUploading(true);
      setResult(null);
      try {
        const outcome = await getItemPhotoUploadUrlAction({
          itemId,
          filename: file.name,
          contentType: file.type || "image/jpeg",
        });
        if (!outcome.ok) {
          setResult(outcome);
          return;
        }

        const put = await fetch(outcome.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "image/jpeg" },
          body: file,
        });
        if (!put.ok) {
          setResult({
            ok: false,
            message: `R2 refused the upload (HTTP ${put.status}) — check the bucket CORS policy, filed in docs/handoff/admin.md`,
          });
          return;
        }

        setResult(outcome);
        const staged = { url: outcome.publicUrl, label: file.name };
        onUploaded?.(staged);
      } catch (thrown) {
        setResult({
          ok: false,
          message: thrown instanceof Error ? thrown.message : String(thrown),
        });
      } finally {
        setUploading(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 border border-line bg-raised p-3">
      <h2 className="font-mono text-[13px] uppercase tracking-tight">
        Intake photos
      </h2>
      <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
        Upload the 8-shot set here. Photos go to Cloudflare R2; saving them
        onto the item awaits a contract write (docs/handoff/admin.md).
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        title={blocked ?? undefined}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? "Uploading…" : "Choose photo"}
      </Button>
      {blocked && (
        <span className="font-mono text-[10px] tracking-tight text-muted">
          {blocked}
        </span>
      )}
      <div aria-live="polite">
        {result && !result.ok && (
          <div className="flex flex-col gap-1 border border-[#FF4444] bg-overlay p-2">
            <p className="font-mono text-[10px] uppercase tracking-tight text-[#FF4444]">
              Upload failed
            </p>
            <p className="font-mono text-[11px] leading-snug tracking-tight text-foreground">
              {result.message}
            </p>
          </div>
        )}
        {result && result.ok && (
          <p className="border border-line bg-overlay p-2 font-mono text-[11px] leading-snug tracking-tight break-all">
            Uploaded — {result.publicUrl}
          </p>
        )}
      </div>
    </div>
  );
}
