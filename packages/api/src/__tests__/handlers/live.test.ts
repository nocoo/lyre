/**
 * Tests for `handlers/live.ts`.
 */

import { describe, expect, it } from "vitest";
import { liveHandler } from "../../handlers/live";

describe("liveHandler", () => {
  it("returns ok when probe succeeds", () => {
    const res = liveHandler(() => {});
    expect(res.status).toBe(200);
    if (res.kind !== "json") throw new Error();
    const body = res.body as { status: string; database: { connected: boolean } };
    expect(body.status).toBe("ok");
    expect(body.database.connected).toBe(true);
  });
  it("returns 503 when probe throws", () => {
    const res = liveHandler(() => {
      throw new Error("DB down ok");
    });
    expect(res.status).toBe(503);
    if (res.kind !== "json") throw new Error();
    const body = res.body as {
      database: { connected: boolean; error: string };
    };
    expect(body.database.connected).toBe(false);
    // sanitize() must replace "ok" → "***"
    expect(body.database.error).not.toContain("ok");
    expect(body.database.error).toContain("***");
  });
  it("returns 503 when probe throws a non-Error value", () => {
    const res = liveHandler(() => {
      throw "boom";
    });
    expect(res.status).toBe(503);
    if (res.kind !== "json") throw new Error();
    const body = res.body as { database: { error: string } };
    expect(body.database.error).toBe("unexpected database failure");
  });
  it("uptime defaults to 0 when process.uptime is unavailable", () => {
    const g = globalThis as Record<string, unknown>;
    const orig = g["process"];
    g["process"] = undefined;
    try {
      const res = liveHandler(() => {});
      if (res.kind !== "json") throw new Error();
      expect((res.body as { uptime: number }).uptime).toBe(0);
    } finally {
      g["process"] = orig;
    }
  });
});
