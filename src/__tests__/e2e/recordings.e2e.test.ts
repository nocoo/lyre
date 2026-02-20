import { describe, expect, test, beforeAll } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "7026"}`;

// ── Helpers ──

interface Recording {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  fileSize: number | null;
  format: string | null;
  ossKey: string;
  status: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

interface PaginatedResponse {
  items: Recording[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface RecordingDetail extends Recording {
  transcription: unknown;
  latestJob: unknown;
}

async function createRecording(data: {
  title: string;
  description?: string;
  fileName: string;
  fileSize?: number;
  format?: string;
  ossKey: string;
  tags?: string[];
}): Promise<Recording> {
  const res = await fetch(`${BASE_URL}/api/recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Recording;
}

// ── Seed data ──

const seedRecordings: Parameters<typeof createRecording>[0][] = [
  {
    title: "Team Standup Monday",
    description: "Weekly standup recording",
    fileName: "standup-monday.mp3",
    fileSize: 5_200_000,
    format: "mp3",
    ossKey: "uploads/e2e/standup-monday.mp3",
    tags: ["meeting", "standup"],
  },
  {
    title: "Podcast Episode 42",
    description: "The meaning of life",
    fileName: "podcast-ep42.mp3",
    fileSize: 45_000_000,
    format: "mp3",
    ossKey: "uploads/e2e/podcast-ep42.mp3",
    tags: ["podcast"],
  },
  {
    title: "Customer Interview",
    fileName: "customer-interview.wav",
    fileSize: 120_000_000,
    format: "wav",
    ossKey: "uploads/e2e/customer-interview.wav",
  },
  {
    title: "Audio Note Alpha",
    fileName: "note-alpha.m4a",
    fileSize: 1_000_000,
    format: "m4a",
    ossKey: "uploads/e2e/note-alpha.m4a",
  },
  {
    title: "Audio Note Beta",
    fileName: "note-beta.m4a",
    fileSize: 2_000_000,
    format: "m4a",
    ossKey: "uploads/e2e/note-beta.m4a",
  },
];

const createdIds: string[] = [];

beforeAll(async () => {
  for (const data of seedRecordings) {
    const rec = await createRecording(data);
    createdIds.push(rec.id);
  }
});

// ── Tests ──

describe("POST /api/recordings", () => {
  test("creates a new recording and returns 201", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "New Recording",
        description: "Created in test",
        fileName: "new-recording.mp3",
        fileSize: 3_000_000,
        format: "mp3",
        ossKey: "uploads/e2e/new-recording.mp3",
        tags: ["test"],
      }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as Recording;
    expect(body.title).toBe("New Recording");
    expect(body.description).toBe("Created in test");
    expect(body.status).toBe("uploaded");
    expect(body.tags).toEqual(["test"]);
    expect(body.id).toBeTruthy();

    // Clean up — delete it
    const delRes = await fetch(`${BASE_URL}/api/recordings/${body.id}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
  });

  test("returns 400 when required fields are missing", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Incomplete" }),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Missing required fields");
  });
});

describe("GET /api/recordings", () => {
  test("returns paginated recordings", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as PaginatedResponse;
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("pageSize");
    expect(body).toHaveProperty("totalPages");
    expect(body.total).toBeGreaterThanOrEqual(5);
    expect(body.items.length).toBeGreaterThan(0);
  });

  test("searches by query", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings?q=podcast`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as PaginatedResponse;
    expect(body.total).toBe(1);
    expect(body.items[0]!.title).toContain("Podcast");
  });

  test("sorts by title ascending", async () => {
    const res = await fetch(
      `${BASE_URL}/api/recordings?sortBy=title&sortDir=asc`,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as PaginatedResponse;
    const titles = body.items.map((r) => r.title);
    const sorted = [...titles].sort();
    expect(titles).toEqual(sorted);
  });

  test("paginates correctly", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings?page=1&pageSize=2`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as PaginatedResponse;
    expect(body.items.length).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    expect(body.totalPages).toBeGreaterThanOrEqual(3);
  });

  test("returns empty for no matches", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings?q=zzz_nonexistent`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as PaginatedResponse;
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  test("handles invalid params gracefully", async () => {
    const res = await fetch(
      `${BASE_URL}/api/recordings?status=invalid&sortBy=bad&page=-1`,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as PaginatedResponse;
    // Falls back to "all" status, default sort, page clamped to 1
    expect(body.total).toBeGreaterThanOrEqual(5);
    expect(body.page).toBe(1);
  });
});

describe("GET /api/recordings/[id]", () => {
  test("returns recording detail for valid id", async () => {
    const id = createdIds[0]!;
    const res = await fetch(`${BASE_URL}/api/recordings/${id}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as RecordingDetail;
    expect(body.id).toBe(id);
    expect(body.title).toBe("Team Standup Monday");
    expect(body).toHaveProperty("transcription");
    expect(body).toHaveProperty("latestJob");
    // Newly created recordings have no transcription or job
    expect(body.transcription).toBeNull();
    expect(body.latestJob).toBeNull();
  });

  test("returns 404 for unknown id", async () => {
    const res = await fetch(
      `${BASE_URL}/api/recordings/nonexistent-id-12345`,
    );
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not found");
  });
});

describe("PUT /api/recordings/[id]", () => {
  test("updates recording fields", async () => {
    const id = createdIds[0]!;
    const res = await fetch(`${BASE_URL}/api/recordings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Updated Standup",
        description: "Updated description",
        tags: ["updated"],
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Recording;
    expect(body.title).toBe("Updated Standup");
    expect(body.description).toBe("Updated description");
    expect(body.tags).toEqual(["updated"]);

    // Restore original title for other tests
    await fetch(`${BASE_URL}/api/recordings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Team Standup Monday",
        description: "Weekly standup recording",
        tags: ["meeting", "standup"],
      }),
    });
  });

  test("returns 404 for unknown id", async () => {
    const res = await fetch(
      `${BASE_URL}/api/recordings/nonexistent-id-12345`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "X" }),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/recordings/[id]", () => {
  test("deletes a recording and returns success", async () => {
    // Create a throwaway recording to delete
    const rec = await createRecording({
      title: "To Be Deleted",
      fileName: "delete-me.mp3",
      ossKey: "uploads/e2e/delete-me.mp3",
    });

    const res = await fetch(`${BASE_URL}/api/recordings/${rec.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // Verify it's gone
    const getRes = await fetch(`${BASE_URL}/api/recordings/${rec.id}`);
    expect(getRes.status).toBe(404);
  });

  test("returns 404 for unknown id", async () => {
    const res = await fetch(
      `${BASE_URL}/api/recordings/nonexistent-id-12345`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/upload/presign", () => {
  test("returns presigned upload URL", async () => {
    const res = await fetch(`${BASE_URL}/api/upload/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: "test-upload.mp3",
        contentType: "audio/mpeg",
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      uploadUrl: string;
      ossKey: string;
      recordingId: string;
    };
    expect(body.uploadUrl).toContain("https://");
    expect(body.uploadUrl).toContain("OSSAccessKeyId");
    expect(body.ossKey).toContain("test-upload.mp3");
    expect(body.recordingId).toBeTruthy();
  });

  test("accepts custom recordingId", async () => {
    const res = await fetch(`${BASE_URL}/api/upload/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: "test.mp3",
        contentType: "audio/mpeg",
        recordingId: "custom-id-123",
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { recordingId: string };
    expect(body.recordingId).toBe("custom-id-123");
  });

  test("returns 400 for missing fields", async () => {
    const res = await fetch(`${BASE_URL}/api/upload/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "test.mp3" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects non-audio content type", async () => {
    const res = await fetch(`${BASE_URL}/api/upload/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: "image.png",
        contentType: "image/png",
      }),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("audio");
  });
});

describe("GET /api/recordings/[id]/play-url", () => {
  test("returns presigned play URL for existing recording", async () => {
    const id = createdIds[0]!;
    const res = await fetch(`${BASE_URL}/api/recordings/${id}/play-url`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { playUrl: string };
    expect(body.playUrl).toContain("https://");
    expect(body.playUrl).toContain("OSSAccessKeyId");
  });

  test("returns 404 for unknown recording", async () => {
    const res = await fetch(
      `${BASE_URL}/api/recordings/nonexistent-id-12345/play-url`,
    );
    expect(res.status).toBe(404);
  });
});
