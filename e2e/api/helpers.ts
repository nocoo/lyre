/**
 * Shared helpers for L2 E2E tests.
 *
 * All tests run against a real wrangler dev server with E2E_SKIP_AUTH=true,
 * which synthesizes a stable test user via the access-auth middleware.
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:7017";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = `${BASE}${path}`;
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return fetch(url, init);
}

export async function get(path: string): Promise<Response> {
  return request("GET", path);
}

export async function post(path: string, body?: unknown): Promise<Response> {
  return request("POST", path, body);
}

export async function put(path: string, body?: unknown): Promise<Response> {
  return request("PUT", path, body);
}

export async function del(path: string, body?: unknown): Promise<Response> {
  return request("DELETE", path, body);
}

export async function head(path: string): Promise<Response> {
  return request("HEAD", path);
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export async function json<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
