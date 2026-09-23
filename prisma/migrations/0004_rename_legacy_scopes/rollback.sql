-- Reverse step for 0004_rename_legacy_scopes.
--
-- Intentionally a no-op. The legacy names are not understood by any deployed
-- version of the API that reads this table, so writing them back would only
-- reintroduce the 403 on GET /v1/alerts. The forward step also cannot be
-- inverted precisely: after it runs, a renamed 'alerts:read' is
-- indistinguishable from one that was issued with that name.
SELECT 1;
