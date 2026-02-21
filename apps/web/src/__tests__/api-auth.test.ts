import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { createHash } from "crypto";
import { resetDb } from "@/db/index";
import { usersRepo } from "@/db/repositories/users";
import { deviceTokensRepo } from "@/db/repositories/device-tokens";

// ── Mocks ──────────────────────────────────────────────────────────

let mockAuthorizationHeader: string | null = null;
let mockAuthSession: {
  user?: { email?: string; name?: string; image?: string };
} | null = null;

// Mock next/headers — headers() returns a Headers-like object
mock.module("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => {
      if (name === "authorization") return mockAuthorizationHeader;
      return null;
    },
  }),
}));

// Mock @/auth — auth() returns the mock session
mock.module("@/auth", () => ({
  auth: async () => mockAuthSession,
}));

// Type-safe env helpers (NODE_ENV is typed as readonly in @types/bun)
const env = process.env as Record<string, string | undefined>;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function seedUser(id = "user-1", email = "alice@test.com") {
  return usersRepo.create({ id, email, name: "Alice", avatarUrl: null });
}

describe("hashToken", () => {
  test("returns a 64-char hex string", () => {
    const hash = hashToken("some-token");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("produces deterministic output", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  test("produces different output for different inputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});

describe("getCurrentUser", () => {
  const savedPlaywright = process.env.PLAYWRIGHT;
  const savedNodeEnv = env.NODE_ENV;

  beforeEach(() => {
    resetDb();
    mockAuthorizationHeader = null;
    mockAuthSession = null;
    delete env.PLAYWRIGHT;
  });

  afterEach(() => {
    if (savedPlaywright !== undefined) {
      env.PLAYWRIGHT = savedPlaywright;
    } else {
      delete env.PLAYWRIGHT;
    }
    env.NODE_ENV = savedNodeEnv;
  });

  async function callGetCurrentUser() {
    const { getCurrentUser } = await import("@/lib/api-auth");
    return getCurrentUser();
  }

  // ── Branch 1: E2E / Playwright bypass ──

  test("returns test user when PLAYWRIGHT=1 and not production", async () => {
    env.PLAYWRIGHT = "1";
    env.NODE_ENV = "test";

    const user = await callGetCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.email).toBe("e2e@test.com");
    expect(user!.name).toBe("E2E Test User");
    expect(user!.id).toBe("e2e-test-user");
  });

  test("does NOT bypass auth when PLAYWRIGHT=1 in production", async () => {
    env.PLAYWRIGHT = "1";
    env.NODE_ENV = "production";

    const user = await callGetCurrentUser();
    expect(user).toBeNull();
  });

  test("does NOT bypass auth when PLAYWRIGHT is unset", async () => {
    delete env.PLAYWRIGHT;
    env.NODE_ENV = "test";

    const user = await callGetCurrentUser();
    expect(user).toBeNull();
  });

  // ── Branch 2: Bearer token auth ──

  test("authenticates via valid Bearer token", async () => {
    env.NODE_ENV = "test";
    const rawToken = "my-device-token";
    const hash = hashToken(rawToken);

    seedUser("user-1", "alice@test.com");
    deviceTokensRepo.create({
      id: "tok-1",
      userId: "user-1",
      name: "My Mac",
      tokenHash: hash,
    });

    mockAuthorizationHeader = `Bearer ${rawToken}`;

    const user = await callGetCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.id).toBe("user-1");
    expect(user!.email).toBe("alice@test.com");
  });

  test("updates lastUsedAt when authenticating via Bearer token", async () => {
    env.NODE_ENV = "test";
    const rawToken = "touch-token";
    const hash = hashToken(rawToken);

    seedUser("user-1", "alice@test.com");
    deviceTokensRepo.create({
      id: "tok-2",
      userId: "user-1",
      name: "Device",
      tokenHash: hash,
    });

    expect(deviceTokensRepo.findById("tok-2")?.lastUsedAt).toBeNull();

    mockAuthorizationHeader = `Bearer ${rawToken}`;
    await callGetCurrentUser();

    const token = deviceTokensRepo.findById("tok-2");
    expect(token?.lastUsedAt).not.toBeNull();
    expect(token!.lastUsedAt!).toBeGreaterThan(0);
  });

  test("returns null for invalid Bearer token", async () => {
    env.NODE_ENV = "test";
    seedUser("user-1", "alice@test.com");

    mockAuthorizationHeader = "Bearer invalid-token-not-in-db";

    const user = await callGetCurrentUser();
    expect(user).toBeNull();
  });

  test("returns null for empty Bearer token value", async () => {
    env.NODE_ENV = "test";

    mockAuthorizationHeader = "Bearer ";

    const user = await callGetCurrentUser();
    expect(user).toBeNull();
  });

  test("does not fall through to session when Bearer token is invalid", async () => {
    env.NODE_ENV = "test";

    // Set up a valid session that would succeed
    mockAuthSession = {
      user: { email: "session@test.com", name: "Session User" },
    };

    // But also provide an invalid bearer token
    mockAuthorizationHeader = "Bearer bad-token";

    // Bearer token takes priority — invalid token returns null immediately
    // without falling through to session auth
    const user = await callGetCurrentUser();
    expect(user).toBeNull();
  });

  // ── Branch 3: NextAuth session fallback ──

  test("authenticates via NextAuth session", async () => {
    env.NODE_ENV = "test";

    mockAuthSession = {
      user: {
        email: "session@test.com",
        name: "Session User",
        image: "https://example.com/avatar.jpg",
      },
    };

    const user = await callGetCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.email).toBe("session@test.com");
    expect(user!.name).toBe("Session User");
    expect(user!.avatarUrl).toBe("https://example.com/avatar.jpg");
  });

  test("creates user from session on first login", async () => {
    env.NODE_ENV = "test";

    mockAuthSession = {
      user: { email: "new@test.com", name: "New User" },
    };

    const user = await callGetCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.email).toBe("new@test.com");

    const dbUser = usersRepo.findByEmail("new@test.com");
    expect(dbUser).toBeDefined();
    expect(dbUser!.name).toBe("New User");
  });

  test("generates stable user ID from email", async () => {
    env.NODE_ENV = "test";

    mockAuthSession = {
      user: { email: "stable@test.com", name: "Stable" },
    };

    const user1 = await callGetCurrentUser();
    const user2 = await callGetCurrentUser();
    expect(user1!.id).toBe(user2!.id);

    const expectedId = `user-${Buffer.from("stable@test.com").toString("base64url")}`;
    expect(user1!.id).toBe(expectedId);
  });

  test("returns null when session has no email", async () => {
    env.NODE_ENV = "test";

    mockAuthSession = { user: { name: "No Email" } };

    const user = await callGetCurrentUser();
    expect(user).toBeNull();
  });

  test("returns null when session is null", async () => {
    env.NODE_ENV = "test";

    mockAuthSession = null;

    const user = await callGetCurrentUser();
    expect(user).toBeNull();
  });

  test("returns null when session.user is undefined", async () => {
    env.NODE_ENV = "test";

    mockAuthSession = {};

    const user = await callGetCurrentUser();
    expect(user).toBeNull();
  });

  test("handles missing name and image in session gracefully", async () => {
    env.NODE_ENV = "test";

    mockAuthSession = {
      user: { email: "minimal@test.com" },
    };

    const user = await callGetCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.email).toBe("minimal@test.com");
    expect(user!.name).toBeNull();
    expect(user!.avatarUrl).toBeNull();
  });
});
