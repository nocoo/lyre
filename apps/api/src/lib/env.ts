/**
 * Map a `Bindings` object to the strongly-typed `LyreEnv` snapshot used
 * by `@lyre/api`. Single source of truth for the env mapping shared by
 * `runtime-context` middleware and `cron-ctx`.
 */

import type { LyreEnv } from "@lyre/api/runtime/env";
import type { Bindings } from "../bindings";

export function buildLyreEnv(env: Bindings): LyreEnv {
  return {
    NODE_ENV: env.NODE_ENV,
    PLAYWRIGHT: env.E2E_SKIP_AUTH === "true" ? "1" : undefined,
    SKIP_OSS_ARCHIVE: env.SKIP_OSS_ARCHIVE,
    OSS_ACCESS_KEY_ID: env.OSS_ACCESS_KEY_ID,
    OSS_ACCESS_KEY_SECRET: env.OSS_ACCESS_KEY_SECRET,
    OSS_BUCKET: env.OSS_BUCKET,
    OSS_REGION: env.OSS_REGION,
    OSS_ENDPOINT: env.OSS_ENDPOINT,
    DASHSCOPE_API_KEY: env.DASHSCOPE_API_KEY,
  };
}
