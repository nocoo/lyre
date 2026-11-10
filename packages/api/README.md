# @lyre/api

Shared API package extracted during Wave B of
`docs/03-cf-worker-migration-plan.md`. Empty until then.

Exports boundary (enforced via ESLint `no-restricted-imports` in consumers):

- `@lyre/api/contracts/*` — client-safe types/zod schemas
- `@lyre/api/services/*` — server-only business logic
- `@lyre/api/handlers/*` — server-only Hono-agnostic handlers
