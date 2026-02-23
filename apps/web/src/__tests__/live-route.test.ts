import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@/db/index";
import { GET, checkHealth } from "@/app/api/live/route";

describe("GET /api/live", () => {
  beforeEach(() => {
    resetDb();
  });

  // ── Happy path (full integration via GET handler) ──

  test("returns 200 with status ok when database is healthy", async () => {
    const response = GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("returns version string", async () => {
    const body = await GET().json();
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });

  test("returns a numeric timestamp close to now", async () => {
    const before = Date.now();
    const body = await GET().json();
    const after = Date.now();

    expect(typeof body.timestamp).toBe("number");
    expect(body.timestamp).toBeGreaterThanOrEqual(before);
    expect(body.timestamp).toBeLessThanOrEqual(after);
  });

  test("returns a non-negative integer uptime", async () => {
    const body = await GET().json();
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.uptime).toBe(Math.round(body.uptime));
  });

  test("returns db.connected as true", async () => {
    const body = await GET().json();
    expect(body.db).toBeDefined();
    expect(body.db.connected).toBe(true);
  });

  test("sets Cache-Control to no-store", async () => {
    const response = GET();
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
  });

  test("does not require authentication", async () => {
    // No auth mocks set up — if auth were required this would fail
    const response = GET();
    expect(response.status).toBe(200);
  });

  test("response contains all expected top-level keys", async () => {
    const body = await GET().json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("db");
  });
});

describe("checkHealth", () => {
  // ── Happy path ──

  test("returns 200 when probe succeeds", async () => {
    const response = checkHealth(() => {});
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.db.connected).toBe(true);
  });

  test("includes version, timestamp, and uptime on success", async () => {
    const before = Date.now();
    const body = await checkHealth(() => {}).json();
    const after = Date.now();

    expect(typeof body.version).toBe("string");
    expect(body.timestamp).toBeGreaterThanOrEqual(before);
    expect(body.timestamp).toBeLessThanOrEqual(after);
    expect(typeof body.uptime).toBe("number");
  });

  test("sets no-cache headers on success", () => {
    const response = checkHealth(() => {});
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
  });

  // ── Error path ──

  test("returns 503 when probe throws an Error", async () => {
    const response = checkHealth(() => {
      throw new Error("SQLITE_CANTOPEN: unable to open database file");
    });

    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.reason).toContain("database unreachable");
    expect(body.reason).toContain("SQLITE_CANTOPEN");
  });

  test("returns 503 with generic message when probe throws a non-Error", async () => {
    const response = checkHealth(() => {
      throw "string error"; // not an Error instance
    });

    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.reason).toContain("unexpected database failure");
  });

  test("error response includes timestamp", async () => {
    const before = Date.now();
    const body = await checkHealth(() => {
      throw new Error("fail");
    }).json();
    const after = Date.now();

    expect(body.timestamp).toBeGreaterThanOrEqual(before);
    expect(body.timestamp).toBeLessThanOrEqual(after);
  });

  test("error response does not contain the word ok", async () => {
    const body = await checkHealth(() => {
      throw new Error("something went wrong");
    }).json();

    const serialized = JSON.stringify(body).toLowerCase();
    // "ok" must not appear as a value anywhere in the error response
    expect(serialized).not.toContain('"ok"');
  });

  test("error response sets no-cache headers", () => {
    const response = checkHealth(() => {
      throw new Error("disk I/O error");
    });

    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
  });

  test("error response does not include db.connected field", async () => {
    const body = await checkHealth(() => {
      throw new Error("connection lost");
    }).json();

    expect(body.db).toBeUndefined();
  });

  test("error response does not include version or uptime", async () => {
    const body = await checkHealth(() => {
      throw new Error("broken");
    }).json();

    expect(body.version).toBeUndefined();
    expect(body.uptime).toBeUndefined();
  });
});
