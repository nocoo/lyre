/**
 * Test helper: build a tiny Hono app that mounts the worker's route
 * tree on top of a stub runtime middleware. The stub injects a
 * pre-built `RuntimeContext` (backed by the in-memory SQLite singleton
 * inside `@lyre/api`) so we exercise routing + handler glue without
 * needing a D1 binding or wrangler.
 */

import type { RuntimeContext } from "@lyre/api/runtime/context";
import { Hono } from "hono";
import {
	setupAnonCtx,
	setupAuthedCtx,
} from "../../../../packages/api/src/__tests__/_fixtures/runtime-context";

import type { Bindings, Variables } from "../bindings";
import { backy } from "../routes/backy";
import { dashboard } from "../routes/dashboard";
import { folders } from "../routes/folders";
import { jobs } from "../routes/jobs";
import { live } from "../routes/live";
import { me } from "../routes/me";
import { recordings } from "../routes/recordings";
import { search } from "../routes/search";
import { settingsAi } from "../routes/settings/ai";
import { settingsAsr } from "../routes/settings/asr";
import { settingsBackup } from "../routes/settings/backup";
import { settingsBacky } from "../routes/settings/backy";
import { settingsOss } from "../routes/settings/oss";
import { settingsTokens } from "../routes/settings/tokens";
import { tags } from "../routes/tags";
import { upload } from "../routes/upload";

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
	app.route("/api/settings/asr", settingsAsr);
	app.route("/api/settings/backup", settingsBackup);
	app.route("/api/settings/backy", settingsBacky);
	app.route("/api/settings/oss", settingsOss);
	app.route("/api/settings/tokens", settingsTokens);
	app.route("/api/backy", backy);
	app.notFound((c) => c.json({ error: "not_found" }, 404));
	return app;
}

export { setupAnonCtx, setupAuthedCtx };
