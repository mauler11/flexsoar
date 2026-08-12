/**
 * components/admin/r2.ts
 *
 * The Cloudflare R2 upload helpers, built config-first: everything reads real
 * environment variables, nothing is hardcoded, and missing config fails with
 * a sentence instead of a crash. SERVER ONLY — it imports the AWS SDK and is
 * never imported from a client component (same rule as the contract).
 *
 * Two callers, one signer:
 *   - getItemPhotoUploadUrl(itemId, …)  -> keys under `items/<itemId>/`
 *   - getSkuArtUploadUrl(skuId, …)      -> keys under `sku-art/<skuId>/`
 *
 * The flow is a presigned PUT, not a server-proxied upload:
 *
 *  1. The action asks for an upload URL. Next's server-action body limit
 *     (1MB, and next.config.ts is outside this track's lane to raise) would
 *     reject real files, so the browser signs a URL and uploads the bytes
 *     straight to R2. The R2 access keys never leave this module.
 *  2. R2 must allow the browser to PUT cross-origin. That is a bucket-level
 *     CORS policy, configured in the R2 dashboard, not code — filed in
 *     docs/handoff/admin.md with the other environment needs.
 *  3. The public URL returned here is what a screen would persist (item
 *     photos into items.photos, SKU art into skus.art_url). Those write
 *     paths are handoff needs too: `items` has no UPDATE policy and no
 *     contract write for photos, and `skus.art_url` is not yet on the
 *     contract's Sku/UpsertSkuInput surface — see docs/handoff/admin.md.
 *
 * skus.art_url is https-only, so the SKU signer refuses to hand back a
 * public URL that is not https — the bucket must be served over https.
 *
 * Env vars read (see DEPS.md):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 *   R2_PUBLIC_URL (public base the rendered <img> uses).
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

/** image/jpeg -> jpg and friends, for the object key extension. */
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

/** Map from key prefix to its parent directory — for key building only. */
type R2Scope = "items" | "sku-art";

/**
 * Sign a presigned PUT URL for one object under `scope/<id>/`. The filename
 * is only consulted for its extension; the object key is namespaced by id and
 * uuid, so two uploads of `toe.jpg` for the same id cannot collide.
 */
async function signUploadUrl(
  scope: R2Scope,
  id: string,
  filename: string,
  contentType: string,
  httpsOnly: boolean,
): Promise<R2Upload> {
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

  const ext = extFor(filename, contentType);
  const key = `${scope}/${id}/${randomUUID()}.${ext}`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: 120 },
  );

  const builtUrl = `${publicUrl.replace(/\/+$/, "")}/${key}`;
  if (httpsOnly && !builtUrl.startsWith("https://")) {
    throw new Error(
      `R2_PUBLIC_URL must be https for ${scope} — got ${publicUrl}`,
    );
  }

  return { uploadUrl, key, publicUrl: builtUrl };
}

/** One intake photo of an item — keys under `items/<itemId>/`. */
export function getItemPhotoUploadUrl(
  itemId: string,
  filename: string,
  contentType: string,
): Promise<R2Upload> {
  return signUploadUrl("items", itemId, filename, contentType, false);
}

/**
 * One SKU's pixel art — keys under `sku-art/<skuId>/`. skus.art_url is
 * https-only, so the public URL is enforced https here (config-first mirror
 * of the column constraint).
 */
export function getSkuArtUploadUrl(
  skuId: string,
  filename: string,
  contentType: string,
): Promise<R2Upload> {
  return signUploadUrl("sku-art", skuId, filename, contentType, true);
}

/** The extension for the object key: from the filename, else the MIME type. */
function extFor(filename: string, contentType: string): string {
  const fromName = filename.split(".").pop()?.toLowerCase();
  if (fromName && ALLOWED_EXTS.has(fromName)) return fromName;
  const fromMime = EXT_BY_MIME[contentType];
  if (fromMime) return fromMime;
  throw new Error(`unsupported image type: ${contentType}`);
}
