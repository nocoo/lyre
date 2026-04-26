import { Hono } from "hono";
import type { Bindings, Variables } from "../bindings";

export const me = new Hono<{ Bindings: Bindings; Variables: Variables }>();

me.get("/", (c) => {
  const runtime = c.get("runtime");
  if (!runtime.user) return c.json({ error: "unauthorized" }, 401);
  return c.json({
    email: runtime.user.email,
    name: runtime.user.name,
    avatarUrl: runtime.user.avatarUrl,
  });
});
