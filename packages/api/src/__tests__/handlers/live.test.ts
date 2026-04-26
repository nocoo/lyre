/**
 * Tests for `handlers/live.ts`.
 */

import { describe, expect, it } from "bun:test";
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
});
