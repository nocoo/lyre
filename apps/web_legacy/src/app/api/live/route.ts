/**
 * Lightweight liveness / health-check endpoint (no auth).
 *
 * Delegates to `liveHandler` from `@lyre/api`. `checkHealth` is preserved
 * as a re-export wrapper for legacy unit tests in `src/__tests__/live-route.test.ts`.
 */

import { toNextResponse } from "@/lib/handler-adapter";
import { liveHandler } from "@lyre/api/handlers/live";

export const dynamic = "force-dynamic";

export function GET() {
  return toNextResponse(liveHandler());
}

/** Legacy test surface — wraps liveHandler with an injectable probe. */
export function checkHealth(probeDb: () => void) {
  return toNextResponse(liveHandler(probeDb));
}
