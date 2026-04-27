/**
 * Strongly-typed runtime environment for `@lyre/api`.
 *
 * The Worker constructs `LyreEnv` directly from `c.env` and injects it
 * into `RuntimeContext.env`. Handlers and services MUST receive an
 * already-snapshotted `LyreEnv` and MUST NOT read host env directly.
 */

export interface LyreEnv {
  /** "production" | "development" | "test" | undefined */
  NODE_ENV: string | undefined;
  /** "1" enables Playwright auth bypass. */
  PLAYWRIGHT: string | undefined;
  /** "1" disables uploading the raw ASR JSON to OSS (used in tests). */
  SKIP_OSS_ARCHIVE: string | undefined;

  // Aliyun OSS
  OSS_ACCESS_KEY_ID: string | undefined;
  OSS_ACCESS_KEY_SECRET: string | undefined;
  OSS_BUCKET: string | undefined;
  OSS_REGION: string | undefined;
  OSS_ENDPOINT: string | undefined;

  // DashScope (ASR)
  DASHSCOPE_API_KEY: string | undefined;
}

/** Build a fresh `LyreEnv` with all fields undefined (useful for tests). */
export function emptyEnv(): LyreEnv {
  return {
    NODE_ENV: undefined,
    PLAYWRIGHT: undefined,
    SKIP_OSS_ARCHIVE: undefined,
    OSS_ACCESS_KEY_ID: undefined,
    OSS_ACCESS_KEY_SECRET: undefined,
    OSS_BUCKET: undefined,
    OSS_REGION: undefined,
    OSS_ENDPOINT: undefined,
    DASHSCOPE_API_KEY: undefined,
  };
}
