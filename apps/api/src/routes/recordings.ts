import { Hono } from "hono";
import {
  listRecordingsHandler,
  createRecordingHandler,
  getRecordingHandler,
  updateRecordingHandler,
  deleteRecordingHandler,
  batchDeleteRecordingsHandler,
  playUrlHandler,
  downloadUrlHandler,
  wordsHandler,
  type ListRecordingsInput,
} from "@lyre/api/handlers/recordings";
import { toResponse } from "../lib/to-response";
import type { Bindings, Variables } from "../bindings";

export const recordings = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

recordings.get("/", async (c) => {
  const q = c.req.query();
  const input: ListRecordingsInput = {
    query: q.query ?? null,
    status: q.status ?? null,
    sortBy: q.sortBy ?? null,
    sortDir: q.sortDir ?? null,
    page: q.page ?? null,
    pageSize: q.pageSize ?? null,
    folderId: q.folderId ?? null,
  };
  return toResponse(c, await listRecordingsHandler(c.get("runtime"), input));
});

recordings.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(c, await createRecordingHandler(c.get("runtime"), body));
});

recordings.post("/batch-delete", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(
    c,
    await batchDeleteRecordingsHandler(c.get("runtime"), body),
  );
});

recordings.get("/:id", async (c) =>
  toResponse(
    c,
    await getRecordingHandler(c.get("runtime"), c.req.param("id")),
  ),
);

recordings.put("/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return toResponse(
    c,
    await updateRecordingHandler(c.get("runtime"), c.req.param("id"), body),
  );
});

recordings.delete("/:id", async (c) =>
  toResponse(
    c,
    await deleteRecordingHandler(c.get("runtime"), c.req.param("id")),
  ),
);

recordings.get("/:id/play-url", async (c) =>
  toResponse(c, await playUrlHandler(c.get("runtime"), c.req.param("id"))),
);

recordings.get("/:id/download-url", async (c) =>
  toResponse(c, await downloadUrlHandler(c.get("runtime"), c.req.param("id"))),
);

recordings.get("/:id/words", async (c) =>
  toResponse(c, await wordsHandler(c.get("runtime"), c.req.param("id"))),
);
