/**
 * Framework-agnostic HTTP response protocol used by handlers in
 * `packages/api/src/handlers/`.
 *
 * Handlers return a plain data object describing the response, and the
 * Hono worker converts it to a native `Response`.
 *
 * Branches:
 * - `json` — JSON body (default content-type `application/json`)
 * - `text` — plain text body
 * - `bytes` — raw binary body
 * - `empty` — no body, status only
 */

export type HandlerResponse =
	| {
			kind: "json";
			status: number;
			body: unknown;
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

export function json(
	body: unknown,
	status = 200,
	headers?: Record<string, string>,
): HandlerResponse {
	const result: HandlerResponse = { kind: "json", status, body };
	if (headers) result.headers = headers;
	return result;
}

export function text(
	body: string,
	status = 200,
	headers?: Record<string, string>,
): HandlerResponse {
	const result: HandlerResponse = { kind: "text", status, body };
	if (headers) result.headers = headers;
	return result;
}

export function bytes(
	body: ArrayBuffer | Uint8Array,
	status = 200,
	headers?: Record<string, string>,
): HandlerResponse {
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
