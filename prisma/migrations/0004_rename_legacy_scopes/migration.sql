-- Rename API key scopes from the retired site/alarm vocabulary.
--
-- Keys issued before the stations/alerts rename were stored with 'sites:*' and
-- 'alarms:*' scope names. Routes check 'stations:*' and 'alerts:*', so those
-- keys authenticated but were refused GET /v1/alerts with 403.
--
-- This is a one to one rename. Each legacy scope becomes exactly the scope it
-- always meant, duplicates are removed, and the original order is kept. No key
-- gains a permission it did not already hold: scopes added after the rename
-- (events, devices, dashboard, reports, audit, raw) are not granted here.
-- Rows without a legacy scope are not touched, so re-running is a no-op.

UPDATE "api_keys" AS k
SET "scopes" = (
        SELECT COALESCE(array_agg(d.scope ORDER BY d.first_position), ARRAY[]::TEXT[])
        FROM (
            SELECT m.scope, MIN(m.position) AS first_position
            FROM (
                SELECT CASE t.scope
                           WHEN 'alarms:read' THEN 'alerts:read'
                           WHEN 'alarms:write' THEN 'alerts:write'
                           WHEN 'sites:read' THEN 'stations:read'
                           WHEN 'sites:write' THEN 'stations:write'
                           ELSE t.scope
                       END AS scope,
                       t.position
                FROM unnest(k."scopes") WITH ORDINALITY AS t(scope, position)
            ) AS m
            GROUP BY m.scope
        ) AS d
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE k."scopes" && ARRAY['alarms:read', 'alarms:write', 'sites:read', 'sites:write']::TEXT[];
