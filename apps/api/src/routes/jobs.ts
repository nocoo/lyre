import { getJobHandler, listJobsHandler } from "@lyre/api/handlers/jobs";
import { Hono } from "hono";
import type { Bindings, Variables } from "../bindings";
import { toResponse } from "../lib/to-response";

export const jobs = new Hono<{ Bindings: Bindings; Variables: Variables }>();

jobs.get("/", async (c) =>
	toResponse(c, await listJobsHandler(c.get("runtime"), c.req.query("recordingId") ?? null)),
);

jobs.get("/:id", async (c) =>
	toResponse(c, await getJobHandler(c.get("runtime"), c.req.param("id"))),
);
