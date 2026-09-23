-- Rename stored API key scopes after the site/alarm to station/alert rename.
--
-- Keys issued before that rename still hold sites:* and alarms:*. Routes require
-- stations:* and alerts:*, so those keys authenticate and can read tanks, but
-- cannot create stations or read alerts. This rewrites only the renamed names.
-- It does not grant scopes a key never held.
--
-- The update is idempotent: a second run finds no legacy names and changes
-- nothing. Order of first appearance is preserved, and a key that already holds
-- both the old and the new name keeps a single copy of the new name.

UPDATE "api_keys" AS keys
SET scopes = renamed.scopes
FROM (
  SELECT
    id,
    ARRAY(
      SELECT mapped
      FROM (
        SELECT DISTINCT ON (mapped)
          mapped,
          ordinality
        FROM (
          SELECT
            CASE scope
              WHEN 'sites:read' THEN 'stations:read'
              WHEN 'sites:write' THEN 'stations:write'
              WHEN 'alarms:read' THEN 'alerts:read'
              WHEN 'alarms:write' THEN 'alerts:write'
              ELSE scope
            END AS mapped,
            ordinality
          FROM unnest("api_keys".scopes) WITH ORDINALITY AS item(scope, ordinality)
        ) expanded
        ORDER BY mapped, ordinality
      ) deduped
      ORDER BY ordinality
    ) AS scopes
  FROM "api_keys"
  WHERE scopes && ARRAY['sites:read', 'sites:write', 'alarms:read', 'alarms:write']::text[]
) AS renamed
WHERE keys.id = renamed.id;
