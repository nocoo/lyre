/**
 * Convert a framework-agnostic `HandlerResponse` (from `@lyre/api`) to
 * a Hono `Response`.
 */

import type { HandlerResponse } from "@lyre/api/handlers/http";
import type { Context } from "hono";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";

type BodyData = string | ArrayBuffer | ReadableStream | Uint8Array<ArrayBuffer>;

export function toResponse(c: Context, r: HandlerResponse): Response {
	switch (r.kind) {
		case "json":
			return c.json(r.body, r.status as ContentfulStatusCode, r.headers);
		case "text":
			return c.text(r.body, r.status as ContentfulStatusCode, r.headers);
		case "bytes": {
			const headers = {
				"content-type": "application/octet-stream",
				...(r.headers ?? {}),
			};
			return c.body(r.body as BodyData, r.status as ContentfulStatusCode, headers);
		}
		case "empty":
			return c.body(null, r.status as StatusCode, r.headers);
		default:
			return c.json({ error: "internal" }, 500);
	}
}
