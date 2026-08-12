/**
 * lib/r2/sign.ts
 *
 * The shared Cloudflare R2 presigned-upload signer, promoted from
 * `components/admin/r2.ts` so BOTH tracks (admin uploads and the market
 * intake) sign with one piece of server code. SERVER ONLY — imports the AWS
 * SDK and is never imported from a client component.
 *
 * One signer, two scopes-of-work:
 *   - admin track today: `components/admin/r2.ts` still holds its own copy.
 *     migraion = delete that file's signer and re-export from here (filed in
 *     docs/handoff/market.md — when merged, delete the copy and import this).
 *   - market intake (/list): this module signs `intake/<userId>/<uuid>.<ext>`
 *     directly in the Server Action. There is NO database function involved:
 *     getUploadTargetAction signs and returns the PUT URL; the browser PUTs
 *     bytes straight to R2; the public URL is what gets persisted.
 *
 * The key is built ENTIRELY server-side: `scope`, the caller's id, and a
 * randomUUID — the client's filename is never consulted (the client can't
 * choose its namespace). Upload policy (image types, size caps, signing-in)
 * lives in the callers; this module only maps a known contentType to an
 * extension and signs.
 *
 * The bucket must allow browser cross-origin PUTs (a bucket-level CORS rule in
 * the R2 dashboard — filed in docs/handoff/admin.md). Missing config fails
 * with a sentence, never a crash.
 *
 * Env vars read (see DEPS.md): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL (the public base rendered
 * <img> uses).
 */

import {
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public base for rendered files, e.g. `https://media.flexsoar.com`. */
  publicUrl: string;
}

const REQUIRED_R2_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

/**
 * Read the R2 config through a computed `process.env[name]` lookup — the same
 * pattern as lib/supabase/server.ts — so no bundler can inline the keys into
 * a client bundle if this module is ever mis-imported.
 */
export function readR2Config():
  | { ok: true; config: R2Config }
  | { ok: false; missing: readonly string[] } {
  const values = REQUIRED_R2_ENV.map((name) => process.env[name]);
  const missing = REQUIRED_R2_ENV.filter((_, index) => !values[index]);
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      accountId: values[0]!,
      accessKeyId: values[1]!,
      secretAccessKey: values[2]!,
      bucket: values[3]!,
      publicUrl: process.env["R2_PUBLIC_URL"] ?? "",
    },
  };
}

const ALLOWED_EXTS = new Set([
  "avif",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

/** contentType -> object-key extension. */
const EXT_BY_MIME: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface R2Upload {
  /** Short-lived PUT target; the browser uploads the file straight here. */
  uploadUrl: string;
  /** Object key under the caller's prefix; the bucket-relative address. */
  key: string;
  /** The stable public URL — what a screen would persist. */
  publicUrl: string;
}

/** Key namespaces. Callers pick their own; a client never does. */
export type R2Scope = "items" | "sku-art" | "intake";

/**
 * Sign a presigned PUT URL for one object under `scope/<id>/`. Keyed by
 * randomUUID, so two uploads of the same-named file for the same id cannot
 * collide — the client's filename only survives in the ContentType header.
 */
export async function signUploadUrl(input: {
  scope: R2Scope;
  id: string;
  contentType: string;
  httpsOnly?: boolean;
}): Promise<R2Upload> {
  const read = readR2Config();
  if (!read.ok) {
    throw new Error(
      `R2 upload is not configured — set ${read.missing.join(", ")}`,
    );
  }
  const { accountId, accessKeyId, secretAccessKey, bucket, publicUrl } =
    read.config;
  if (!publicUrl) {
    throw new Error(
      "R2_PUBLIC_URL is not set — the public base used to render uploaded files",
    );
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  const ext = extFor(input.contentType);
  const key = `${input.scope}/${input.id}/${randomUUID()}.${ext}`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: input.contentType,
    }),
    { expiresIn: 120 },
  );

  const builtUrl = `${publicUrl.replace(/\/+$/, "")}/${key}`;
  if (input.httpsOnly && !builtUrl.startsWith("https://")) {
    throw new Error(
      `R2_PUBLIC_URL must be https for ${input.scope} — got ${publicUrl}`,
    );
  }

  return { uploadUrl, key, publicUrl: builtUrl };
}

/** The extension for the object key, from the caller-confirmed contentType. */
function extFor(contentType: string): string {
  const ext = EXT_BY_MIME[contentType];
  if (ext) return ext;
  throw new Error(`unsupported image type: ${contentType}`);
}