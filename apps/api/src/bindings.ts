/**
 * Cloudflare Worker bindings expected by the Hono app.
 *
 * `DB` is the D1 binding. The remaining string fields are populated via
 * `wrangler secret put` (in production) or `[vars]` (for non-secret
 * config). Any new env-var read in `@lyre/api` should be mirrored here
 * AND in `runtime-context.ts` so the worker can pass it through.
 */

export interface Bindings {
  DB: D1Database;
  ASSETS?: Fetcher;

  // Auth bypass for E2E.
  E2E_SKIP_AUTH?: string;

  NODE_ENV?: string;
  SKIP_OSS_ARCHIVE?: string;

  // Aliyun OSS
  OSS_ACCESS_KEY_ID?: string;
  OSS_ACCESS_KEY_SECRET?: string;
  OSS_BUCKET?: string;
  OSS_REGION?: string;
  OSS_ENDPOINT?: string;

  // DashScope (ASR)
  DASHSCOPE_API_KEY?: string;
}

import type { RuntimeContext } from "@lyre/api/runtime/context";

export type Variables = {
  runtime: RuntimeContext;
};
