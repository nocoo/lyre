import { Hono } from "hono";
import { presignUploadHandler } from "@lyre/api/handlers/upload";
import { toResponse } from "../lib/to-response";
import type { Bindings, Variables } from "../bindings";

export const upload = new Hono<{ Bindings: Bindings; Variables: Variables }>();

upload.post("/presign", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(c, presignUploadHandler(c.get("runtime"), body));
});
