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

/** Production bucket name. */
export const BUCKET_PROD = "lyre";

/** Development bucket name (used for all non-production environments). */
export const BUCKET_DEV = "lyre-dev";

/**
 * Resolve the OSS bucket name.
 *
 * Priority: OSS_BUCKET env var (explicit override) → NODE_ENV-based default.
 * - production → "lyre"
 * - everything else (development, test, undefined) → "lyre-dev"
 */
export function resolveBucket(): string {
  const explicit = process.env.OSS_BUCKET;
  if (explicit) return explicit;
  return process.env.NODE_ENV === "production" ? BUCKET_PROD : BUCKET_DEV;
}

function getConfig(): OssConfig {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = resolveBucket();
  const region = process.env.OSS_REGION;
  const endpoint = process.env.OSS_ENDPOINT;

  if (!accessKeyId || !accessKeySecret || !region || !endpoint) {
    throw new Error(
      "Missing OSS config. Required env vars: OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_REGION, OSS_ENDPOINT",
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

// ── List objects ──

export interface OssObject {
  key: string;
  size: number;
  lastModified: string;
}

/**
 * List all objects under a given prefix (server-side, handles pagination).
 *
 * Uses the Aliyun OSS GET Bucket (ListObjects) API with V1 Authorization header.
 * Automatically paginates through all results using the marker parameter.
 *
 * @param prefix - Object key prefix (e.g. "uploads/" or "results/")
 * @param config - Optional OSS config override
 * @returns Array of all matching objects
 */
export async function listObjects(
  prefix: string,
  config?: OssConfig,
): Promise<OssObject[]> {
  const cfg = config ?? getConfig();
  const all: OssObject[] = [];
  let marker = "";
  let hasMore = true;

  while (hasMore) {
    const date = new Date().toUTCString();
    const resource = `/${cfg.bucket}/`;

    const stringToSign = ["GET", "", "", date, resource].join("\n");
    const signature = createHmac("sha1", cfg.accessKeySecret)
      .update(stringToSign, "utf8")
      .digest("base64");

    const url = new URL(
      `https://${cfg.bucket}.${cfg.region}.aliyuncs.com/`,
    );
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (marker) url.searchParams.set("marker", marker);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Date: date,
        Authorization: `OSS ${cfg.accessKeyId}:${signature}`,
      },
    });

    if (!response.ok) {
      throw new Error(`OSS listObjects failed: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();

    // Parse <Contents> entries from XML
    const contentsRegex =
      /<Contents>\s*<Key>([^<]+)<\/Key>\s*<LastModified>([^<]+)<\/LastModified>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g;
    let match: RegExpExecArray | null;
    while ((match = contentsRegex.exec(xml)) !== null) {
      all.push({
        key: match[1]!,
        size: parseInt(match[3]!, 10),
        lastModified: match[2]!,
      });
    }

    // Check if truncated
    const truncatedMatch = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(xml);
    const isTruncated = truncatedMatch?.[1] === "true";
    if (isTruncated) {
      const nextMarkerMatch = /<NextMarker>([^<]+)<\/NextMarker>/.exec(xml);
      marker = nextMarkerMatch?.[1] ?? "";
      hasMore = !!marker;
    } else {
      hasMore = false;
    }
  }

  return all;
}

/**
 * Delete multiple objects from OSS in a single batch request (server-side).
 *
 * Uses the Aliyun OSS Delete Multiple Objects API.
 * Processes up to 1000 keys per batch request (OSS limit).
 *
 * @param keys - Array of object keys to delete
 * @param config - Optional OSS config override
 * @returns Number of objects successfully deleted
 */
export async function deleteObjects(
  keys: string[],
  config?: OssConfig,
): Promise<number> {
  if (keys.length === 0) return 0;
  const cfg = config ?? getConfig();
  let totalDeleted = 0;

  // Process in batches of 1000 (OSS limit)
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);

    const objectElements = batch
      .map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`)
      .join("");
    const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>false</Quiet>${objectElements}</Delete>`;

    const bodyBuffer = Buffer.from(body, "utf8");
    const md5 = await computeMd5(bodyBuffer);

    const date = new Date().toUTCString();
    const resource = `/${cfg.bucket}/?delete`;
    const contentType = "application/xml";

    const stringToSign = [
      "POST",
      md5,
      contentType,
      date,
      resource,
    ].join("\n");
    const signature = createHmac("sha1", cfg.accessKeySecret)
      .update(stringToSign, "utf8")
      .digest("base64");

    const url = `https://${cfg.bucket}.${cfg.region}.aliyuncs.com/?delete`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Date: date,
        "Content-Type": contentType,
        "Content-MD5": md5,
        "Content-Length": bodyBuffer.length.toString(),
        Authorization: `OSS ${cfg.accessKeyId}:${signature}`,
      },
      body: bodyBuffer,
    });

    if (response.ok) {
      const xml = await response.text();
      // Count <Deleted> entries
      const deletedMatches = xml.match(/<Deleted>/g);
      totalDeleted += deletedMatches?.length ?? batch.length;
    }
  }

  return totalDeleted;
}

/** Escape special XML characters */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Compute base64-encoded MD5 hash */
async function computeMd5(data: Buffer): Promise<string> {
  // Use Node.js crypto (not HMAC — plain hash)
  const { createHash } = await import("crypto");
  return createHash("md5").update(data).digest("base64");
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
  deleteObjects,
  listObjects,
  signV1,
  resolveBucket,
};
