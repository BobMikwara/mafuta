/**
 * Scope vocabulary maintenance for stored credentials.
 *
 * API keys persist the scope names they were issued with. When the platform
 * renamed "sites" to "stations" and "alarms" to "alerts" (to match the PRD),
 * every key issued before that release kept the old names in `api_keys.scopes`.
 * Routes check the new names, so those keys still authenticated and could read
 * tanks, but were refused `GET /v1/alerts` with 403 because `alarms:read` is not
 * `alerts:read`.
 *
 * The mapping below is a pure rename: each legacy scope grants exactly the
 * permission its replacement grants, nothing more. Scopes introduced after the
 * rename (events, devices, dashboard, reports, audit, raw) are deliberately NOT
 * added to legacy keys, because those keys were never granted them. Migration
 * `0004_rename_legacy_scopes` rewrites the stored rows; this runtime mapping
 * keeps a key working in the window between a deploy and that migration.
 */
export const LEGACY_SCOPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'alarms:read': 'alerts:read',
  'alarms:write': 'alerts:write',
  'sites:read': 'stations:read',
  'sites:write': 'stations:write',
});

/** True when the scope name comes from the vocabulary retired by the rename. */
export function isLegacyScope(scope: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_SCOPE_ALIASES, scope);
}

/**
 * Maps legacy scope names onto their current equivalents and removes
 * duplicates, preserving the order of first appearance. Unknown scopes are kept
 * as they are: no route requires them, so they grant nothing, and dropping them
 * silently would hide data an operator may want to audit.
 */
export function normalizeScopes(scopes: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const scope of scopes) {
    const current = isLegacyScope(scope) ? (LEGACY_SCOPE_ALIASES[scope] as string) : scope;
    if (!seen.has(current)) {
      seen.add(current);
      normalized.push(current);
    }
  }
  return normalized;
}

/** Required scopes that a granted set does not cover, after normalization. */
export function missingScopes(
  granted: ReadonlyArray<string>,
  required: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const available = new Set(normalizeScopes(granted));
  return required.filter((scope) => !available.has(scope));
}
