/**
 * Framework-agnostic HTTP response protocol used by handlers in
 * `packages/api/src/handlers/`.
 *
 * Patterned after backy's `HandlerResponse` — handlers return a plain
 * data object describing the response, and the host framework (Next.js
 * legacy adapter / Hono worker) converts it to its native Response.
 *
 * Branches:
 * - `json` — JSON body (default content-type `application/json`)
 * - `text` — plain text body
 * - `bytes` — raw binary body
 * - `empty` — no body, status only
 *
 * SSE is intentionally absent (decision 3 + 8 in the migration plan):
 * the new worker does NOT implement `/api/jobs/events`; legacy keeps
 * its own SSE route untouched.
 */

export type HandlerResponse =
  | {
      kind: "json";
      status: number;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: any;
      headers?: Record<string, string>;
    }
  | {
      kind: "text";
      status: number;
      body: string;
      headers?: Record<string, string>;
    }
  | {
      kind: "bytes";
      status: number;
      body: ArrayBuffer | Uint8Array;
      headers?: Record<string, string>;
    }
  | {
      kind: "empty";
      status: number;
      headers?: Record<string, string>;
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function json(body: any, status = 200, headers?: Record<string, string>): HandlerResponse {
  const result: HandlerResponse = { kind: "json", status, body };
  if (headers) result.headers = headers;
  return result;
}

export function text(body: string, status = 200, headers?: Record<string, string>): HandlerResponse {
  const result: HandlerResponse = { kind: "text", status, body };
  if (headers) result.headers = headers;
  return result;
}

export function bytes(body: ArrayBuffer | Uint8Array, status = 200, headers?: Record<string, string>): HandlerResponse {
  const result: HandlerResponse = { kind: "bytes", status, body };
  if (headers) result.headers = headers;
  return result;
}

export function empty(status = 204, headers?: Record<string, string>): HandlerResponse {
  const result: HandlerResponse = { kind: "empty", status };
  if (headers) result.headers = headers;
  return result;
}

/** Standard error helpers. */
export function unauthorized(message = "Unauthorized"): HandlerResponse {
  return json({ error: message }, 401);
}

export function notFound(message = "Not found"): HandlerResponse {
  return json({ error: message }, 404);
}

export function badRequest(message: string): HandlerResponse {
  return json({ error: message }, 400);
}

export function serverError(message: string): HandlerResponse {
  return json({ error: message }, 500);
}
