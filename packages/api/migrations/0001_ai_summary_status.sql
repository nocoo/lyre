-- Adds the auto-summary observability columns to `recordings`.
-- Introduced with the auto-summary lifecycle rework (commit b085a64).
--
-- IMPORTANT: SQLite's `ALTER TABLE ADD COLUMN` does not support
-- `IF NOT EXISTS`. Production D1 already has these columns (applied by
-- hand via `wrangler d1 execute` at the time of b085a64); running this
-- file against that DB will fail with a duplicate-column error and is
-- expected — the file exists so a fresh environment can be bootstrapped
-- consistently. See docs/01-deployment.md for the apply/skip rules.

ALTER TABLE recordings ADD COLUMN ai_summary_status TEXT;
ALTER TABLE recordings ADD COLUMN ai_summary_error TEXT;
