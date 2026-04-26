import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@lyre/api/db";
import { GET, checkHealth } from "@/app/api/live/route";

describe("GET /api/live", () => {
  beforeEach(async () => {
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

  test("returns an ISO8601 timestamp", async () => {
    const before = new Date().toISOString();
    const body = await GET().json();
    const after = new Date().toISOString();

    expect(typeof body.timestamp).toBe("string");
    expect(body.timestamp >= before).toBe(true);
    expect(body.timestamp <= after).toBe(true);
    // Validate ISO8601 format
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  test("returns a non-negative integer uptime", async () => {
    const body = await GET().json();
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.uptime).toBe(Math.floor(body.uptime));
  });

  test("returns database.connected as true", async () => {
    const body = await GET().json();
    expect(body.database).toBeDefined();
    expect(body.database.connected).toBe(true);
  });

  test("sets Cache-Control to no-store", async () => {
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("does not require authentication", async () => {
    const response = GET();
    expect(response.status).toBe(200);
  });

  test("returns component as lyre", async () => {
    const body = await GET().json();
    expect(body.component).toBe("lyre");
  });

  test("response contains all expected top-level keys", async () => {
    const body = await GET().json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("component");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("database");
  });
});

describe("checkHealth", () => {
  // ── Happy path ──

  test("returns 200 when probe succeeds", async () => {
    const response = checkHealth(() => {});
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.database.connected).toBe(true);
  });

  test("includes version, timestamp, uptime, and component on success", async () => {
    const before = new Date().toISOString();
    const body = await checkHealth(() => {}).json();
    const after = new Date().toISOString();

    expect(typeof body.version).toBe("string");
    expect(body.component).toBe("lyre");
    expect(body.timestamp >= before).toBe(true);
    expect(body.timestamp <= after).toBe(true);
    expect(typeof body.uptime).toBe("number");
  });

  test("sets no-cache headers on success", async () => {
    const response = checkHealth(() => {});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  // ── Error path ──

  test("returns 503 when probe throws an Error", async () => {
    const response = checkHealth(() => {
      throw new Error("SQLITE_CANTOPEN: unable to open database file");
    });

    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.database.connected).toBe(false);
    expect(body.database.error).toContain("SQLITE_CANTOPEN");
  });

  test("returns 503 with generic message when probe throws a non-Error", async () => {
    const response = checkHealth(() => {
      throw "string error";
    });

    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.database.connected).toBe(false);
    expect(body.database.error).toContain("unexpected database failure");
  });

  test("error response includes timestamp as ISO8601", async () => {
    const before = new Date().toISOString();
    const body = await checkHealth(() => {
      throw new Error("fail");
    }).json();
    const after = new Date().toISOString();

    expect(body.timestamp >= before).toBe(true);
    expect(body.timestamp <= after).toBe(true);
  });

  test("error response sanitizes the word ok", async () => {
    const body = await checkHealth(() => {
      throw new Error("ok connection ok failed");
    }).json();

    expect(body.database.error).not.toMatch(/\bok\b/i);
    expect(body.database.error).toContain("***");
  });

  test("error response sets no-cache headers", async () => {
    const response = checkHealth(() => {
      throw new Error("disk I/O error");
    });

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("error response includes version and uptime", async () => {
    const body = await checkHealth(() => {
      throw new Error("connection lost");
    }).json();

    expect(typeof body.version).toBe("string");
    expect(typeof body.uptime).toBe("number");
  });

  test("error response includes component", async () => {
    const body = await checkHealth(() => {
      throw new Error("broken");
    }).json();

    expect(body.component).toBe("lyre");
  });
});
