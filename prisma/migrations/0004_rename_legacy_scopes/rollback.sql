-- Intentional no-op.
--
-- The rename cannot be reversed safely. A key issued with stations:write cannot
-- be distinguished from a key that was migrated from sites:write. Rewriting
-- every current name back to the legacy name would revoke a permission that
-- may have been granted under the current vocabulary.
--
-- Runtime normalization in packages/core/src/tenancy/scopes.ts still accepts
-- either name, so leaving the stored values on the current names is safe.
SELECT 1;
