/**
 * Test helper: build a tiny Hono app that mounts the worker's route
 * tree on top of a stub runtime middleware. The stub injects a
 * pre-built `RuntimeContext` (backed by the in-memory SQLite singleton
 * inside `@lyre/api`) so we exercise routing + handler glue without
 * needing a D1 binding or wrangler.
 */

import { Hono } from "hono";
import type { RuntimeContext } from "@lyre/api/runtime/context";
import { setupAuthedCtx, setupAnonCtx } from "../../../../packages/api/src/__tests__/_fixtures/runtime-context";

import type { Bindings, Variables } from "../bindings";
import { live } from "../routes/live";
import { me } from "../routes/me";
import { folders } from "../routes/folders";
import { tags } from "../routes/tags";
import { recordings } from "../routes/recordings";
import { jobs } from "../routes/jobs";
import { dashboard } from "../routes/dashboard";
import { search } from "../routes/search";
import { upload } from "../routes/upload";
import { settingsAi } from "../routes/settings/ai";
import { settingsBackup } from "../routes/settings/backup";
import { settingsBacky } from "../routes/settings/backy";
import { settingsOss } from "../routes/settings/oss";
import { settingsTokens } from "../routes/settings/tokens";
import { backy } from "../routes/backy";

export function buildAppWithCtx(ctx: RuntimeContext) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("runtime", ctx);
    await next();
  });
  app.route("/api/live", live);
  app.route("/api/me", me);
  app.route("/api/folders", folders);
  app.route("/api/tags", tags);
  app.route("/api/recordings", recordings);
  app.route("/api/jobs", jobs);
  app.route("/api/dashboard", dashboard);
  app.route("/api/search", search);
  app.route("/api/upload", upload);
  app.route("/api/settings/ai", settingsAi);
  app.route("/api/settings/backup", settingsBackup);
  app.route("/api/settings/backy", settingsBacky);
  app.route("/api/settings/oss", settingsOss);
  app.route("/api/settings/tokens", settingsTokens);
  app.route("/api/backy", backy);
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  return app;
}

export { setupAuthedCtx, setupAnonCtx };
