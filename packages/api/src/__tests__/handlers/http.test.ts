/**
 * Tests for `handlers/http.ts` — response helpers.
 */

import { describe, expect, it } from "vitest";
import {
  json,
  text,
  bytes,
  empty,
  badRequest,
  notFound,
  unauthorized,
  serverError,
} from "../../handlers/http";

describe("http helpers", () => {
  it("json() defaults to 200", () => {
    const r = json({ a: 1 });
    expect(r.status).toBe(200);
    expect(r.kind).toBe("json");
    if (r.kind !== "json") throw new Error();
    expect(r.body).toEqual({ a: 1 });
  });
  it("json() accepts status + headers", () => {
    const r = json({ x: 1 }, 418, { "x-h": "v" });
    expect(r.status).toBe(418);
    expect(r.headers).toEqual({ "x-h": "v" });
  });
  it("text() builds text response", () => {
    const r = text("hello", 201);
    expect(r.kind).toBe("text");
    expect(r.status).toBe(201);
    if (r.kind !== "text") throw new Error();
    expect(r.body).toBe("hello");
  });
  it("text() attaches headers when provided", () => {
    const r = text("hi", 200, { "x-h": "v" });
    expect(r.headers).toEqual({ "x-h": "v" });
  });
  it("bytes() builds binary response", () => {
    const buf = new Uint8Array([1, 2, 3]);
    const r = bytes(buf);
    expect(r.kind).toBe("bytes");
    expect(r.status).toBe(200);
  });
  it("bytes() attaches headers when provided", () => {
    const r = bytes(new Uint8Array([0]), 200, { "content-type": "image/png" });
    expect(r.headers).toEqual({ "content-type": "image/png" });
  });
  it("empty() builds empty response", () => {
    const r = empty(204);
    expect(r.kind).toBe("empty");
    expect(r.status).toBe(204);
  });
  it("empty() attaches headers when provided", () => {
    const r = empty(204, { "x-trace": "1" });
    expect(r.headers).toEqual({ "x-trace": "1" });
  });
  it("error helpers", () => {
    expect(badRequest("bad").status).toBe(400);
    expect(unauthorized().status).toBe(401);
    expect(notFound().status).toBe(404);
    expect(serverError("oops").status).toBe(500);
    const r = badRequest("custom msg");
    if (r.kind !== "json") throw new Error();
    expect((r.body as { error: string }).error).toBe("custom msg");
  });
});
