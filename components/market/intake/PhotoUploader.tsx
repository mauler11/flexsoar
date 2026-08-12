"use client";

/**
 * components/market/intake/PhotoUploader.tsx
 *
 * Step 2 of the intake wizard: collect the photo angles, upload each to object
 * storage via a presigned PUT, and report the uploaded { url, angle } payload
 * up to the wizard.
 *
 * Upload protocol (server action -> presigned URL -> direct PUT):
 *   1. getUploadTargetAction({ fileName, contentType, sizeBytes })
 *   2. PUT the bytes to target.uploadUrl (client-side, direct to R2)
 *   3. the rendered URL is target.publicUrl, stored in the photos payload
 *
 * The signer is handoff M3. Until it ships, uploads fail with SIGNER_NOT_SHARED
 * and this component shows an honest "being wired" banner instead of pretending
 * the photo was stored. The submit action re-validates that every required
 * photo actually has a URL, so a local-only selection can never slip through.
 */

import { useCallback, useRef, useState } from "react";
import {
  PHOTO_ANGLES,
  REQUIRED_PHOTO_COUNT,
  type IntakePhoto,
} from "@/components/market/intake/intake-config";
import { getUploadTargetAction } from "@/app/(market)/list/actions";
import { Button } from "@/components/ui/Button";

type PhotoStatus = "local" | "uploading" | "uploaded" | "failed";

interface StagedPhoto {
  id: string;
  angleKey: string;
  url: string | null;
  status: PhotoStatus;
  error: string | null;
}

let nextId = 0;

function sanitizeFileName(name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return base.length ? base : "photo.bin";
}

export interface PhotoUploaderProps {
  onChange: (photos: IntakePhoto[]) => void;
}

export function PhotoUploader({ onChange }: PhotoUploaderProps) {
  const [photos, setPhotos] = useState<Record<string, StagedPhoto>>({});
  const [signerPending, setSignerPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const countUploaded = Object.values(photos).filter(
    (p) => p.status === "uploaded",
  ).length;

  const report = useCallback(
    (next: Record<string, StagedPhoto>) => {
      const payload = Object.values(next)
        .filter((p): p is StagedPhoto & { url: string } => p.url != null)
        .map((p) => ({ url: p.url, angle: p.angleKey }));
      onChange(payload);
    },
    [onChange],
  );

  async function pickFile(angleKey: string, file: File) {
    const id = `p${nextId++}`;
    const put: StagedPhoto = { id, angleKey, url: null, status: "local", error: null };
    setPhotos((prev) => {
      const next = { ...prev, [angleKey]: put };
      report(next);
      return next;
    });
    setUploading(true);
    setSignerPending(false);

    const target = await getUploadTargetAction({
      fileName: sanitizeFileName(file.name),
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });

    if (!target.ok) {
      setPhotos((prev) => {
        const next = {
          ...prev,
          [angleKey]: {
            ...prev[angleKey],
            status: "failed" as const,
            error: target.message,
          },
        };
        report(next);
        return next;
      });
      if (target.code === "SIGNER_NOT_SHARED") setSignerPending(true);
      setUploading(false);
      return;
    }

    setPhotos((prev) => {
      const next = {
        ...prev,
        [angleKey]: { ...prev[angleKey], status: "uploading" as const },
      };
      report(next);
      return next;
    });

    try {
      const res = await fetch(target.target.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error(`upload returned ${res.status}`);

      setPhotos((prev) => {
        const next = {
          ...prev,
          [angleKey]: {
            ...prev[angleKey],
            url: target.target.publicUrl,
            status: "uploaded" as const,
            error: null,
          },
        };
        report(next);
        return next;
      });
    } catch (thrown) {
      setPhotos((prev) => {
        const next = {
          ...prev,
          [angleKey]: {
            ...prev[angleKey],
            status: "failed" as const,
            error: thrown instanceof Error ? thrown.message : "upload failed",
          },
        };
        report(next);
        return next;
      });
    } finally {
      setUploading(false);
    }
  }

  function clearAngle(angleKey: string) {
    setPhotos((prev) => {
      const next = { ...prev };
      delete next[angleKey];
      report(next);
      return next;
    });
    if (inputRefs.current[angleKey]) inputRefs.current[angleKey]!.value = "";
  }

  return (
    <div className="flex flex-col gap-3">
      {signerPending && (
        <div className="border border-dashed border-[#E8B33A]/60 bg-[#E8B33A]/5 px-3 py-2 font-mono text-[10px] tracking-tight text-muted">
          Photo upload is being wired to storage (signer not shared yet). Your
          picks are staged here so the flow is ready — nothing has been stored,
          and you can&apos;t submit until uploads work.
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PHOTO_ANGLES.map((angle) => {
          const photo = photos[angle.key];
          return (
            <div
              key={angle.key}
              className="flex flex-col gap-1 border border-line-strong bg-overlay p-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-tight text-foreground">
                  {angle.label}
                  {angle.required && (
                    <span className="text-accent"> · required</span>
                  )}
                </span>
                {photo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => clearAngle(angle.key)}
                  >
                    remove
                  </Button>
                )}
              </div>
              <span className="font-mono text-[9px] tracking-tight text-muted">
                {angle.hint}
              </span>

              {photo ? (
                photo.status === "uploaded" && photo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external R2 host, mirrors components/admin/grading/PhotoViewer
                  <img
                    src={photo.url}
                    alt={`${angle.label} photo`}
                    className="mt-1 aspect-square w-full border border-line-strong object-cover"
                  />
                ) : (
                  <div className="mt-1 flex aspect-square w-full items-center justify-center border border-dashed border-line-strong px-2 py-4 text-center font-mono text-[10px] tracking-tight text-muted">
                    {photo.status === "uploading"
                      ? "uploading…"
                      : photo.status === "failed"
                        ? `upload failed — ${photo.error ?? "try again"}`
                        : "photo selected locally"}
                  </div>
                )
              ) : (
                <label className="mt-1 flex aspect-square w-full cursor-pointer items-center justify-center border border-dashed border-line-strong px-2 py-4 text-center font-mono text-[10px] tracking-tight text-muted hover:border-muted">
                  <input
                    ref={(el) => {
                      inputRefs.current[angle.key] = el;
                    }}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void pickFile(angle.key, file);
                    }}
                  />
                  {uploading ? "uploading…" : "choose photo"}
                </label>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-line-strong pt-2 font-mono text-[10px] tracking-tight text-muted">
        {countUploaded}/{REQUIRED_PHOTO_COUNT} required photos uploaded — the
        four money views. The optional angles help the grader and the buyer.
      </div>
    </div>
  );
}