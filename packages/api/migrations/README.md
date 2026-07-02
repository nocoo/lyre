# D1 migrations

Each `NNNN_*.sql` file in this directory is one migration, applied in
lexical order to bring a D1 database from empty → the schema described
by `packages/api/src/db/schema.ts`. The Drizzle schema is the source of
truth for the running code; these files are the source of truth for
**how to shape a fresh D1 to match it**.

## Apply to a new environment

```bash
for f in packages/api/migrations/*.sql; do
  bunx wrangler d1 execute lyre-db --remote --file "$f"
done
```

Order matters — the shell glob sorts lexically, which matches the
intended apply order.

For local dev / E2E use `--local` instead of `--remote`. E2E has its own
DROP+CREATE (`e2e/schema.sql`) so it does not go through this pipeline.

## Rules for new migrations

- Numbers are contiguous four-digit zero-padded. `0002_...`, `0003_...`.
- One migration per Drizzle schema change. Never edit a migration after
  it has been applied to any environment.
- SQLite is limited — `ALTER TABLE` supports `ADD COLUMN`, `RENAME`, and
  `DROP COLUMN` only. Restructuring beyond that needs a create-swap-copy
  pattern. Write it out explicitly.
- Each `CREATE TABLE` in a bootstrap migration should use `IF NOT
  EXISTS` so re-applying is safe. `ALTER TABLE` statements cannot.
- If a migration is applied out-of-band to production (e.g. hotfix), add
  a comment at the top of the file recording that and update the
  deployment doc so future operators know to skip it there.
