/**
 * Aliyun OSS service.
 *
 * Zero external SDK — uses Node.js crypto for V1 signature.
 * Generates presigned URLs for direct client-side upload/download
 * and handles server-side object deletion.
 */

import { createHmac } from "crypto";

// ── Config ──

export interface OssConfig {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  endpoint: string;
}

function getConfig(): OssConfig {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;
  const region = process.env.OSS_REGION;
  const endpoint = process.env.OSS_ENDPOINT;

  if (!accessKeyId || !accessKeySecret || !bucket || !region || !endpoint) {
    throw new Error(
      "Missing OSS config. Required env vars: OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET, OSS_REGION, OSS_ENDPOINT",
    );
  }

  return { accessKeyId, accessKeySecret, bucket, region, endpoint };
}

// ── V1 Signature ──

/**
 * Compute Aliyun OSS Signature V1.
 *
 * StringToSign = VERB + "\n" + Content-MD5 + "\n" + Content-Type + "\n"
 *              + Expires + "\n" + CanonicalizedOSSHeaders + CanonicalizedResource
 */
export function signV1(
  secret: string,
  method: string,
  resource: string,
  expires: number,
  contentType: string = "",
  contentMd5: string = "",
): string {
  const stringToSign = [
    method,
    contentMd5,
    contentType,
    expires.toString(),
    resource,
  ].join("\n");

  return createHmac("sha1", secret).update(stringToSign, "utf8").digest("base64");
}

// ── OSS Key helpers ──

/**
 * Generate the OSS object key for a recording upload.
 * Format: uploads/{userId}/{recordingId}/{fileName}
 */
export function makeUploadKey(
  userId: string,
  recordingId: string,
  fileName: string,
): string {
  return `uploads/${userId}/${recordingId}/${fileName}`;
}

/**
 * Generate the OSS object key for ASR result archival.
 * Format: results/{jobId}/{fileName}
 */
export function makeResultKey(jobId: string, fileName: string): string {
  return `results/${jobId}/${fileName}`;
}

// ── Presigned URL generation ──

/**
 * Build bucket-style URL: https://{bucket}.{region}.aliyuncs.com/{key}
 */
function buildBucketUrl(config: OssConfig, key: string): string {
  return `https://${config.bucket}.${config.region}.aliyuncs.com/${key}`;
}

/**
 * Generate a presigned PUT URL for direct client-side upload.
 *
 * @param key - The OSS object key
 * @param contentType - MIME type (must match client's Content-Type header)
 * @param expiresInSec - URL validity in seconds (default 15 min)
 * @returns Presigned URL string
 */
export function presignPut(
  key: string,
  contentType: string,
  expiresInSec: number = 900,
  config?: OssConfig,
): string {
  const cfg = config ?? getConfig();
  const expires = Math.floor(Date.now() / 1000) + expiresInSec;
  const resource = `/${cfg.bucket}/${key}`;

  const signature = signV1(
    cfg.accessKeySecret,
    "PUT",
    resource,
    expires,
    contentType,
  );

  const url = new URL(buildBucketUrl(cfg, key));
  url.searchParams.set("OSSAccessKeyId", cfg.accessKeyId);
  url.searchParams.set("Expires", expires.toString());
  url.searchParams.set("Signature", signature);

  return url.toString();
}

/**
 * Generate a presigned GET URL for audio playback / file download.
 *
 * @param key - The OSS object key
 * @param expiresInSec - URL validity in seconds (default 1 hour)
 * @param responseOverrides - Optional response header overrides (e.g. response-content-disposition)
 * @param config - Optional OSS config override
 * @returns Presigned URL string
 */
export function presignGet(
  key: string,
  expiresInSec: number = 3600,
  responseOverrides?: Record<string, string>,
  config?: OssConfig,
): string {
  const cfg = config ?? getConfig();
  const expires = Math.floor(Date.now() / 1000) + expiresInSec;

  // Build canonical resource — must include response override params for V1 signature
  let resource = `/${cfg.bucket}/${key}`;
  if (responseOverrides && Object.keys(responseOverrides).length > 0) {
    const overrideParts = Object.entries(responseOverrides)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`);
    resource += `?${overrideParts.join("&")}`;
  }

  const signature = signV1(cfg.accessKeySecret, "GET", resource, expires);

  const url = new URL(buildBucketUrl(cfg, key));
  url.searchParams.set("OSSAccessKeyId", cfg.accessKeyId);
  url.searchParams.set("Expires", expires.toString());
  url.searchParams.set("Signature", signature);

  // Append response override params to URL
  if (responseOverrides) {
    for (const [k, v] of Object.entries(responseOverrides)) {
      url.searchParams.set(k, v);
    }
  }

  return url.toString();
}

/**
 * Delete an object from OSS (server-side).
 *
 * @param key - The OSS object key
 * @returns true if deleted (2xx response), false otherwise
 */
export async function deleteObject(
  key: string,
  config?: OssConfig,
): Promise<boolean> {
  const cfg = config ?? getConfig();
  const date = new Date().toUTCString();
  const resource = `/${cfg.bucket}/${key}`;

  // For non-presigned requests, use Authorization header with date
  const stringToSign = ["DELETE", "", "", date, resource].join("\n");
  const signature = createHmac("sha1", cfg.accessKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");

  const url = buildBucketUrl(cfg, key);
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Date: date,
      Authorization: `OSS ${cfg.accessKeyId}:${signature}`,
    },
  });

  // 204 No Content is the success response for DELETE
  return response.status >= 200 && response.status < 300;
}

// ── Service barrel ──

export const ossService = {
  makeUploadKey,
  makeResultKey,
  presignPut,
  presignGet,
  deleteObject,
  signV1,
};
