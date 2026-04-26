# FROZEN

This package is **frozen** as part of the migration documented in
`docs/03-cf-worker-migration-plan.md`.

- Do **not** add new features here. Bug fixes only when blocking production.
- New work goes into `apps/web` (Vite SPA), `apps/api` (Hono Worker), or
  `packages/api` (`@lyre/api`).
- Will be deleted after Wave E (DNS cutover + observation period).
