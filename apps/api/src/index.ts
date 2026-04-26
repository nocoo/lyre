/**
 * Hono Worker entry — mounts middleware + route trees and exports the
 * Cloudflare Workers `fetch` + `scheduled` handlers.
 *
 * Middleware order (request flow):
 *   secureHeaders          — defensive HTTP headers
 *   runtimeContext          — build per-request RuntimeContext (env + db)
 *   bearerAuth              — populate user from Authorization: Bearer
 *   accessAuth              — populate user from CF Access JWT (or E2E bypass)
 *
 * `/api/live` runs through the middleware too — it's harmless (DB probe
 * is independent of auth) and keeps the path layout uniform.
 *
 * `scheduled()` is wired directly to `cronTickHandler` from `@lyre/api`
 * with a freshly-built `RuntimeContext` (no auth, just env + db).
 */

import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { cronTickHandler } from "@lyre/api/handlers/jobs";

import type { Bindings, Variables } from "./bindings";
import { runtimeContext } from "./middleware/runtime-context";
import { bearerAuth } from "./middleware/bearer-auth";
import { accessAuth } from "./middleware/access-auth";
import { buildCronCtx } from "./lib/cron-ctx";

import { live } from "./routes/live";
import { me } from "./routes/me";
import { folders } from "./routes/folders";
import { tags } from "./routes/tags";
import { recordings } from "./routes/recordings";
import { jobs } from "./routes/jobs";
import { dashboard } from "./routes/dashboard";
import { search } from "./routes/search";
import { upload } from "./routes/upload";
import { settingsAi } from "./routes/settings/ai";
import { settingsBackup } from "./routes/settings/backup";
import { settingsBacky } from "./routes/settings/backy";
import { settingsOss } from "./routes/settings/oss";
import { settingsTokens } from "./routes/settings/tokens";

export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", secureHeaders());
app.use("/api/*", runtimeContext());
app.use("/api/*", bearerAuth());
app.use("/api/*", accessAuth());

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

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  console.error("[hono] unhandled error", err);
  return c.json({ error: "internal" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    const runtime = buildCronCtx(env);
    ctx.waitUntil(
      cronTickHandler(runtime).catch((e) => {
        console.error("[cron] tick failed", e);
      }),
    );
  },
};
