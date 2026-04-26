/**
 * Convert a framework-agnostic `HandlerResponse` (from `@lyre/api`) to
 * a Hono `Response`.
 */

import type { Context } from "hono";
import type { HandlerResponse } from "@lyre/api/handlers/http";

export function toResponse(c: Context, r: HandlerResponse): Response {
  switch (r.kind) {
    case "json":
      // Hono's c.json signature accepts (body, status, headers).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(r.body, r.status as any, r.headers);
    case "text":
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.text(r.body, r.status as any, r.headers);
    case "bytes": {
      const headers = {
        "content-type": "application/octet-stream",
        ...(r.headers ?? {}),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.body(r.body as any, r.status as any, headers);
    }
    case "empty":
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.body(null, r.status as any, r.headers);
    default:
      return c.json({ error: "internal" }, 500);
  }
}
