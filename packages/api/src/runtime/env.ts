/**
 * Strongly-typed runtime environment for `@lyre/api`.
 *
 * This module is the single source of truth for env-var access inside
 * the package. All other modules MUST receive an already-snapshotted
 * `LyreEnv` (via service signatures or `RuntimeContext.env`) and MUST
 * NOT read the host process env themselves.
 *
 * Audit rule: exactly one host-env access is allowed below — the
 * single line inside `loadEnvFromProcess()` that reads it.
 *
 * On Cloudflare Workers, `loadEnvFromProcess` is never called; the
 * worker constructs `LyreEnv` directly from `c.env` (D1 binding etc.).
 * On Node.js / Bun (legacy), callers either pass an explicit `LyreEnv`
 * or fall back to `loadEnvFromProcess()` for back-compat.
 */

export interface LyreEnv {
  /** "production" | "development" | "test" | undefined */
  NODE_ENV: string | undefined;
  /** "1" enables Playwright auth bypass + DB reset. */
  PLAYWRIGHT: string | undefined;
  /** "1" disables uploading the raw ASR JSON to OSS (used in tests). */
  SKIP_OSS_ARCHIVE: string | undefined;
  /** Override SQLite database path (legacy only). */
  LYRE_DB: string | undefined;
  /** "test" forces in-memory DB (legacy only). */
  BUN_ENV: string | undefined;

  // Aliyun OSS
  OSS_ACCESS_KEY_ID: string | undefined;
  OSS_ACCESS_KEY_SECRET: string | undefined;
  OSS_BUCKET: string | undefined;
  OSS_REGION: string | undefined;
  OSS_ENDPOINT: string | undefined;

  // DashScope (ASR)
  DASHSCOPE_API_KEY: string | undefined;
}

/**
 * Read the host env into a strongly-typed snapshot.
 *
 * This is the only function in `packages/api` that reads from the host
 * runtime env. All other modules receive a `LyreEnv` from their caller.
 *
 * On Cloudflare Workers this function is never invoked — the worker
 * builds `LyreEnv` directly from `c.env`.
 */
export function loadEnvFromProcess(): LyreEnv {
  const e = process.env as Record<string, string | undefined>;
  return {
    NODE_ENV: e.NODE_ENV,
    PLAYWRIGHT: e.PLAYWRIGHT,
    SKIP_OSS_ARCHIVE: e.SKIP_OSS_ARCHIVE,
    LYRE_DB: e.LYRE_DB,
    BUN_ENV: e.BUN_ENV,
    OSS_ACCESS_KEY_ID: e.OSS_ACCESS_KEY_ID,
    OSS_ACCESS_KEY_SECRET: e.OSS_ACCESS_KEY_SECRET,
    OSS_BUCKET: e.OSS_BUCKET,
    OSS_REGION: e.OSS_REGION,
    OSS_ENDPOINT: e.OSS_ENDPOINT,
    DASHSCOPE_API_KEY: e.DASHSCOPE_API_KEY,
  };
}

/** Build a fresh `LyreEnv` with all fields undefined (useful for tests). */
export function emptyEnv(): LyreEnv {
  return {
    NODE_ENV: undefined,
    PLAYWRIGHT: undefined,
    SKIP_OSS_ARCHIVE: undefined,
    LYRE_DB: undefined,
    BUN_ENV: undefined,
    OSS_ACCESS_KEY_ID: undefined,
    OSS_ACCESS_KEY_SECRET: undefined,
    OSS_BUCKET: undefined,
    OSS_REGION: undefined,
    OSS_ENDPOINT: undefined,
    DASHSCOPE_API_KEY: undefined,
  };
}
