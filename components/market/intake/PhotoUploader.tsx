"use client";

/**
 * components/market/intake/PhotoUploader.tsx
 *
 * Step 2 of the intake wizard: collect the photo angles, upload each to object
 * storage via a presigned PUT, and report the uploaded { url, angle } payload
 * up to the wizard.
 *
 * Upload protocol (server action -> presigned URL -> direct PUT):
 *   1. getUploadTargetAction({ contentType, sizeBytes }) signs the URL
 *      directly in the action (lib/r2/sign.ts, key `intake/<userId>/…`)
 *   2. the browser PUTs the bytes to target.uploadUrl (client-side, direct to R2)
 *   3. the rendered URL is target.publicUrl, stored in the photos payload
 *
 * No database function is involved: the seam that called fn_get_upload_target
 * is gone. The submit action re-validates that every required photo actually
 * has an https URL, so a local-only selection can never slip through.
 */

import { useEffect, useRef, useState } from "react";
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

function toPayload(photos: Record<string, StagedPhoto>): IntakePhoto[] {
  return Object.values(photos)
    .filter((p): p is StagedPhoto & { url: string } => p.url != null)
    .map((p) => ({ url: p.url, angle: p.angleKey }));
}

export interface PhotoUploaderProps {
  onChange: (photos: IntakePhoto[]) => void;
}

export function PhotoUploader({ onChange }: PhotoUploaderProps) {
  const [photos, setPhotos] = useState<Record<string, StagedPhoto>>({});
  const [uploading, setUploading] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const countUploaded = Object.values(photos).filter(
    (p) => p.status === "uploaded",
  ).length;

  // Parent notification fires AFTER commit, never during another component's
  // render. Calling onChange inside a setPhotos updater (as this file once did)
  // mutates the wizard mid-render — React 19 warns and the payload is flaky.
  // onChange is the wizard's setPhotos, a stable setter, so this effect runs
  // once per staged-photo change.
  useEffect(() => {
    onChange(toPayload(photos));
  }, [photos, onChange]);

  async function pickFile(angleKey: string, file: File) {
    const id = `p${nextId++}`;
    const put: StagedPhoto = { id, angleKey, url: null, status: "local", error: null };
    setPhotos((prev) => ({ ...prev, [angleKey]: put }));
    setUploading(true);

    const target = await getUploadTargetAction({
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });

    if (!target.ok) {
      setPhotos((prev) => ({
        ...prev,
        [angleKey]: {
          ...prev[angleKey],
          status: "failed" as const,
          error: target.message,
        },
      }));
      setUploading(false);
      return;
    }

    setPhotos((prev) => ({
      ...prev,
      [angleKey]: { ...prev[angleKey], status: "uploading" as const },
    }));

    try {
      const res = await fetch(target.target.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error(`upload returned ${res.status}`);

      setPhotos((prev) => ({
        ...prev,
        [angleKey]: {
          ...prev[angleKey],
          url: target.target.publicUrl,
          status: "uploaded" as const,
          error: null,
        },
      }));
    } catch (thrown) {
      setPhotos((prev) => ({
        ...prev,
        [angleKey]: {
          ...prev[angleKey],
          status: "failed" as const,
          error: thrown instanceof Error ? thrown.message : "upload failed",
        },
      }));
    } finally {
      setUploading(false);
    }
  }

  function clearAngle(angleKey: string) {
    setPhotos((prev) => {
      const next = { ...prev };
      delete next[angleKey];
      return next;
    });
    if (inputRefs.current[angleKey]) inputRefs.current[angleKey]!.value = "";
  }

  return (
    <div className="flex flex-col gap-3">
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
                ) : photo.status === "failed" ? (
                  <div className="mt-1 flex aspect-square w-full flex-col items-center justify-center gap-1 border border-dashed border-[#FF4444] bg-[#FF4444]/10 px-2 py-4 text-center">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-tight text-[#FF4444]">
                      upload failed
                    </span>
                    <span className="font-mono text-[9px] tracking-tight text-[#FF4444]">
                      {photo.error ?? "unknown error"}
                    </span>
                    <span className="font-mono text-[9px] tracking-tight text-muted">
                      remove above and choose the photo again
                    </span>
                  </div>
                ) : photo.status === "uploading" ? (
                  <div className="mt-1 flex aspect-square w-full items-center justify-center border border-dashed border-line-strong px-2 py-4 font-mono text-[10px] tracking-tight text-muted">
                    uploading…
                  </div>
                ) : (
                  <div className="mt-1 flex aspect-square w-full items-center justify-center border border-dashed border-line-strong px-2 py-4 font-mono text-[10px] tracking-tight text-muted">
                    photo selected locally
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
        {countUploaded}/{REQUIRED_PHOTO_COUNT} photos uploaded — toe, both
        sides, and the outsole. All four are required.
      </div>
    </div>
  );
}