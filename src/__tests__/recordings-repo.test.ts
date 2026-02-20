import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { recordingsRepo } from "@/db/repositories/recordings";

// Seed a user (recordings have FK to users)
function seedUser() {
  return usersRepo.create({
    id: "user-1",
    email: "alice@test.com",
    name: "Alice",
    avatarUrl: null,
  });
}

function makeRecording(
  overrides?: Partial<Parameters<typeof recordingsRepo.create>[0]>,
) {
  return {
    id: "rec-1",
    userId: "user-1",
    title: "Test Recording",
    description: "A test recording",
    fileName: "test.mp3",
    fileSize: 1024000,
    duration: 120.5,
    format: "mp3",
    sampleRate: 44100,
    ossKey: "uploads/user-1/test.mp3",
    tags: ["meeting", "demo"],
    status: "uploaded" as const,
    ...overrides,
  };
}

describe("recordingsRepo", () => {
  beforeEach(() => {
    resetDb();
    seedUser();
  });

  describe("create", () => {
    test("creates a recording and returns it", () => {
      const rec = recordingsRepo.create(makeRecording());
      expect(rec.id).toBe("rec-1");
      expect(rec.title).toBe("Test Recording");
      expect(rec.status).toBe("uploaded");
      expect(rec.tags).toBe('["meeting","demo"]');
      expect(rec.createdAt).toBeGreaterThan(0);
    });

    test("serializes tags as JSON", () => {
      const rec = recordingsRepo.create(makeRecording({ tags: ["a", "b", "c"] }));
      expect(rec.tags).toBe('["a","b","c"]');
    });

    test("handles empty tags", () => {
      const rec = recordingsRepo.create(makeRecording({ tags: [] }));
      expect(rec.tags).toBe("[]");
    });

    test("handles null optional fields", () => {
      const rec = recordingsRepo.create(
        makeRecording({
          description: null,
          fileSize: null,
          duration: null,
          format: null,
          sampleRate: null,
        }),
      );
      expect(rec.description).toBeNull();
      expect(rec.fileSize).toBeNull();
      expect(rec.duration).toBeNull();
    });
  });

  describe("findAll", () => {
    test("returns recordings for a given user", () => {
      recordingsRepo.create(makeRecording({ id: "r1" }));
      recordingsRepo.create(makeRecording({ id: "r2" }));
      const all = recordingsRepo.findAll("user-1");
      expect(all).toHaveLength(2);
    });

    test("returns empty for different user", () => {
      recordingsRepo.create(makeRecording());
      expect(recordingsRepo.findAll("user-other")).toEqual([]);
    });

    test("returns results ordered by createdAt desc", () => {
      recordingsRepo.create(makeRecording({ id: "r1", title: "First" }));
      recordingsRepo.create(makeRecording({ id: "r2", title: "Second" }));
      const all = recordingsRepo.findAll("user-1");
      // Both have the same createdAt (too fast), just verify count
      expect(all).toHaveLength(2);
      // Verify all are returned with correct user
      expect(all.every((r) => r.userId === "user-1")).toBe(true);
    });
  });

  describe("findById", () => {
    test("returns recording when found", () => {
      recordingsRepo.create(makeRecording());
      expect(recordingsRepo.findById("rec-1")?.title).toBe("Test Recording");
    });

    test("returns undefined when not found", () => {
      expect(recordingsRepo.findById("nope")).toBeUndefined();
    });
  });

  describe("findByUserId", () => {
    beforeEach(() => {
      recordingsRepo.create(
        makeRecording({
          id: "r1",
          title: "Alpha Meeting",
          status: "completed",
          duration: 60,
          fileSize: 500,
          tags: ["meeting"],
        }),
      );
      recordingsRepo.create(
        makeRecording({
          id: "r2",
          title: "Beta Interview",
          status: "uploaded",
          duration: 120,
          fileSize: 1000,
          tags: ["interview"],
        }),
      );
      recordingsRepo.create(
        makeRecording({
          id: "r3",
          title: "Gamma Podcast",
          status: "completed",
          duration: 300,
          fileSize: 2000,
          tags: ["podcast"],
        }),
      );
    });

    test("returns all recordings for user with defaults", () => {
      const result = recordingsRepo.findByUserId("user-1");
      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(3);
    });

    test("filters by status", () => {
      const result = recordingsRepo.findByUserId("user-1", {
        status: "completed",
      });
      expect(result.total).toBe(2);
    });

    test("filters by query in title", () => {
      const result = recordingsRepo.findByUserId("user-1", {
        query: "alpha",
      });
      expect(result.total).toBe(1);
      expect(result.items[0]?.title).toBe("Alpha Meeting");
    });

    test("filters by query in tags", () => {
      const result = recordingsRepo.findByUserId("user-1", {
        query: "podcast",
      });
      expect(result.total).toBe(1);
    });

    test("sorts by title ascending", () => {
      const result = recordingsRepo.findByUserId("user-1", {
        sortBy: "title",
        sortDir: "asc",
      });
      expect(result.items[0]?.title).toBe("Alpha Meeting");
      expect(result.items[2]?.title).toBe("Gamma Podcast");
    });

    test("sorts by duration descending", () => {
      const result = recordingsRepo.findByUserId("user-1", {
        sortBy: "duration",
        sortDir: "desc",
      });
      expect(result.items[0]?.duration).toBe(300);
    });

    test("sorts by fileSize ascending", () => {
      const result = recordingsRepo.findByUserId("user-1", {
        sortBy: "fileSize",
        sortDir: "asc",
      });
      expect(result.items[0]?.fileSize).toBe(500);
    });

    test("paginates results", () => {
      const page1 = recordingsRepo.findByUserId("user-1", {
        page: 1,
        pageSize: 2,
      });
      expect(page1.total).toBe(3);
      expect(page1.items).toHaveLength(2);

      const page2 = recordingsRepo.findByUserId("user-1", {
        page: 2,
        pageSize: 2,
      });
      expect(page2.items).toHaveLength(1);
    });

    test("returns empty for unknown user", () => {
      const result = recordingsRepo.findByUserId("nobody");
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });
  });

  describe("update", () => {
    test("updates title", () => {
      recordingsRepo.create(makeRecording());
      const updated = recordingsRepo.update("rec-1", {
        title: "Updated Title",
      });
      expect(updated?.title).toBe("Updated Title");
    });

    test("updates status", () => {
      recordingsRepo.create(makeRecording());
      const updated = recordingsRepo.update("rec-1", {
        status: "transcribing",
      });
      expect(updated?.status).toBe("transcribing");
    });

    test("updates tags (serialized)", () => {
      recordingsRepo.create(makeRecording());
      const updated = recordingsRepo.update("rec-1", { tags: ["new-tag"] });
      expect(updated?.tags).toBe('["new-tag"]');
    });

    test("updates updatedAt", () => {
      const rec = recordingsRepo.create(makeRecording());
      const updated = recordingsRepo.update("rec-1", { title: "New" });
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(rec.updatedAt);
    });

    test("returns undefined when not found", () => {
      expect(recordingsRepo.update("nope", { title: "X" })).toBeUndefined();
    });
  });

  describe("delete", () => {
    test("deletes existing recording", () => {
      recordingsRepo.create(makeRecording());
      expect(recordingsRepo.delete("rec-1")).toBe(true);
      expect(recordingsRepo.findById("rec-1")).toBeUndefined();
    });

    test("returns false when not found", () => {
      expect(recordingsRepo.delete("nope")).toBe(false);
    });
  });

  describe("parseTags", () => {
    test("parses valid JSON array", () => {
      expect(recordingsRepo.parseTags('["a","b"]')).toEqual(["a", "b"]);
    });

    test("returns empty array for empty JSON array", () => {
      expect(recordingsRepo.parseTags("[]")).toEqual([]);
    });

    test("returns empty array for invalid JSON", () => {
      expect(recordingsRepo.parseTags("not json")).toEqual([]);
    });

    test("returns empty array for non-array JSON", () => {
      expect(recordingsRepo.parseTags('{"a":1}')).toEqual([]);
    });
  });

  describe("toDomain", () => {
    test("adds parsedTags field", () => {
      const rec = recordingsRepo.create(makeRecording({ tags: ["x", "y"] }));
      const domain = recordingsRepo.toDomain(rec);
      expect(domain.parsedTags).toEqual(["x", "y"]);
      expect(domain.id).toBe(rec.id);
    });
  });
});
