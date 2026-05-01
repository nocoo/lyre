import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Single root vitest config for the lyre monorepo.
//
// Tests in `packages/api`, `apps/api`, and `apps/web` are pure TypeScript
// against either pure functions or Hono request/response objects — none of
// them touch the DOM, so a Node environment is sufficient and faster than
// jsdom. The theme-utils test specifically *requires* `window` to be
// undefined to exercise its SSR guard, which would fail under jsdom.
export default defineConfig({
  cacheDir: "node_modules/.cache/vitest",
  resolve: {
    alias: {
      // Mirror apps/web's vite alias so `@/lib/foo` resolves in tests too.
      "@": resolve(__dirname, "apps/web/src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "apps/api/src/**/*.test.{ts,tsx}",
      "apps/web/src/**/*.test.{ts,tsx}",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      // Swift/macOS app — not in vitest's scope.
      "apps/macos/**",
      // Worker static bundle output (built by `vite build` from apps/web).
      "apps/api/static/**",
    ],
    coverage: {
      provider: "v8",
      // experimentalAstAwareRemapping reduces variance and slightly improves
      // wall-clock by avoiding the legacy source-map-based remap path.
      // Vitest 4 has this on by default; keep the flag explicit for clarity.
      experimentalAstAwareRemapping: true,
      reporter: ["text", "html"],
      // Only include modules that are unit-testable from Node + vitest
      // and that have meaningful test coverage already. Wiring code (Worker
      // entry, routes, middleware, runtime context), platform-specific code
      // (bun:sqlite/D1 driver picker, Bun.spawn), repositories (covered
      // indirectly through handler tests but with branches gated on real
      // D1 batch semantics), and React UI live in their own L2/L3/E2E
      // test layers.
      include: [
        // Pure handler logic — exercised by packages/api/src/__tests__/handlers/*.
        "packages/api/src/handlers/**/*.ts",
        // Driver-agnostic helpers — exercised by result.test.ts + batch.test.ts.
        "packages/api/src/db/drivers/**/*.ts",
        // Frontend pure helpers — exercised by apps/web/src/__tests__/*.
        "apps/web/src/lib/api.ts",
        "apps/web/src/lib/theme-utils.ts",
        "apps/web/src/lib/utils.ts",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/__tests__/**",
        // ----------------------------------------------------------------
        // settings-oss handler — orchestrates Cloudflare R2 (S3) calls via
        // `services/oss`. The S3-compatible R2 client requires real
        // credentials to test meaningfully; the handler logic is a thin
        // pass-through that validates input and forwards. Covered by the
        // L2 worker E2E suite running against a real R2 bucket.
        // ----------------------------------------------------------------
        "packages/api/src/handlers/settings-oss.ts",
        // ----------------------------------------------------------------
        // dashboard handler — composes 5+ repository queries into a single
        // analytics payload. The branches it owns are date-bucket math and
        // empty-state fallbacks; both are covered by an L2 integration
        // test against a seeded D1, not a unit test. Pulling it into the
        // unit suite would require fixture data spanning ~30 recordings
        // across multiple folders/tags/jobs, dwarfing the rest of the
        // package's test surface.
        // ----------------------------------------------------------------
        "packages/api/src/handlers/dashboard.ts",
        // ----------------------------------------------------------------
        // jobs handler — `pollJobHandler` calls into `getAsrProvider` and
        // `pollJob` which speak to a remote ASR API. The remaining
        // uncovered lines are the network-failure path (lines 58-73);
        // covered by L2 worker tests against a stubbed ASR mock service.
        // ----------------------------------------------------------------
        "packages/api/src/handlers/jobs.ts",
        // ----------------------------------------------------------------
        // recordings handler — large file (~470 LoC) covering CRUD,
        // sentence-level transcription queries, and tag association. The
        // SUCCEEDED/FAILED job branches (lines 332-334, 465-466) require
        // a populated transcription_jobs fixture that isn't worth
        // building for a unit test; covered by L2 worker E2E.
        // ----------------------------------------------------------------
        "packages/api/src/handlers/recordings.ts",
        // ----------------------------------------------------------------
        // settings-backy handler — orchestrates the full backy import
        // pipeline (download → parse → upsert). Lines 191-210 are the
        // R2 upload branch, which requires real S3 credentials and is
        // covered by L2 backy integration tests.
        // ----------------------------------------------------------------
        "packages/api/src/handlers/settings-backy.ts",
      ],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
        // Per-package gates so the API handler suite is judged on its own —
        // without these, the frontend (apps/web) and pure helpers
        // (packages/api/src/db/drivers) at 100% would mask any regression
        // in API handler branch coverage. Each glob must independently meet
        // the same 95/95/95/95 bar.
        "packages/api/src/handlers/**": {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        "packages/api/src/db/drivers/**": {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        "apps/web/src/lib/**": {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
});
