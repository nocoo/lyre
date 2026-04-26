/**
 * Lightweight fetch wrapper for the SPA → Worker API.
 *
 * - All requests carry credentials so the CF Access JWT cookie is sent.
 * - Non-2xx responses raise `ApiError` with the parsed body when JSON.
 * - 401 anywhere triggers `window.location.reload()` so Cloudflare Access
 *   can intercept the navigation and bounce the user through SSO.
 */

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

let reloadHandler: () => void = () => {
  if (typeof window !== "undefined") window.location.reload();
};

/** Test seam — override the reload behavior in unit tests. */
export function setUnauthorizedHandler(fn: () => void): () => void {
  const prev = reloadHandler;
  reloadHandler = fn;
  return () => {
    reloadHandler = prev;
  };
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
  });
  if (res.status === 401) {
    reloadHandler();
    throw new ApiError(401, null, "Unauthorized");
  }
  return res;
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await apiFetch(path, init);
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}
