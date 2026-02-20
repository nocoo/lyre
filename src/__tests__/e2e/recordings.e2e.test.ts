import { describe, expect, test } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "7026"}`;

describe("GET /api/recordings", () => {
  test("returns paginated recordings", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("pageSize");
    expect(body).toHaveProperty("totalPages");
    expect(body.total).toBe(5);
    expect(body.items.length).toBeGreaterThan(0);
  });

  test("filters by status", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings?status=completed`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(2);
    for (const item of body.items) {
      expect(item.status).toBe("completed");
    }
  });

  test("searches by query", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings?q=podcast`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].title).toContain("Podcast");
  });

  test("sorts by title ascending", async () => {
    const res = await fetch(
      `${BASE_URL}/api/recordings?sortBy=title&sortDir=asc`,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    const titles = body.items.map((r: { title: string }) => r.title);
    const sorted = [...titles].sort();
    expect(titles).toEqual(sorted);
  });

  test("paginates correctly", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings?page=1&pageSize=2`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items.length).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    expect(body.totalPages).toBe(3);
    expect(body.total).toBe(5);
  });

  test("returns empty for no matches", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings?q=nonexistent`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  test("handles invalid params gracefully", async () => {
    const res = await fetch(
      `${BASE_URL}/api/recordings?status=invalid&sortBy=bad&page=-1`,
    );
    expect(res.status).toBe(200);

    // Should fall back to defaults
    const body = await res.json();
    expect(body.total).toBe(5); // "all" status fallback
    expect(body.page).toBe(1); // clamped to 1
  });
});

describe("GET /api/recordings/[id]", () => {
  test("returns recording detail for valid id", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings/rec-001`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("rec-001");
    expect(body.title).toBe("Q4 Product Review Meeting");
    expect(body).toHaveProperty("transcription");
    expect(body).toHaveProperty("latestJob");
  });

  test("returns transcription for completed recording", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings/rec-001`);
    const body = await res.json();

    expect(body.transcription).not.toBeNull();
    expect(body.transcription.fullText).toContain("Welcome");
    expect(body.transcription.sentences.length).toBe(5);
  });

  test("returns null transcription for uploaded recording", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings/rec-003`);
    const body = await res.json();

    expect(body.transcription).toBeNull();
    expect(body.latestJob).toBeNull();
  });

  test("returns running job for transcribing recording", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings/rec-002`);
    const body = await res.json();

    expect(body.status).toBe("transcribing");
    expect(body.latestJob).not.toBeNull();
    expect(body.latestJob.status).toBe("RUNNING");
  });

  test("returns 404 for unknown id", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings/nonexistent`);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});
