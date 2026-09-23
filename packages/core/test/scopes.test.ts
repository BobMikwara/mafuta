import { describe, expect, it } from 'vitest';
import {
  API_KEY_SCOPES,
  InsufficientScopeError,
  ForbiddenError,
  isLegacyScope,
  LEGACY_SCOPE_ALIASES,
  missingScopes,
  normalizeScopes,
} from '../src/index.js';

describe('legacy scope normalization', () => {
  it('maps every retired scope onto a scope the platform still defines', () => {
    const current = new Set<string>(API_KEY_SCOPES);
    for (const [legacy, replacement] of Object.entries(LEGACY_SCOPE_ALIASES)) {
      expect(current.has(legacy)).toBe(false);
      expect(current.has(replacement)).toBe(true);
    }
  });

  it('renames legacy scopes one to one and never adds a scope', () => {
    const normalized = normalizeScopes(['tanks:read', 'alarms:read', 'sites:write']);
    expect(normalized).toEqual(['tanks:read', 'alerts:read', 'stations:write']);
    expect(normalized).toHaveLength(3);
  });

  it('deduplicates when a key holds both the legacy and the current name', () => {
    expect(normalizeScopes(['alerts:read', 'alarms:read', 'alerts:read'])).toEqual(['alerts:read']);
  });

  it('leaves current and unknown scopes untouched', () => {
    expect(normalizeScopes(['audit:read', 'custom:thing'])).toEqual(['audit:read', 'custom:thing']);
    expect(normalizeScopes([])).toEqual([]);
  });

  it('identifies legacy scopes without matching inherited object keys', () => {
    expect(isLegacyScope('alarms:write')).toBe(true);
    expect(isLegacyScope('alerts:write')).toBe(false);
    expect(isLegacyScope('toString')).toBe(false);
    expect(isLegacyScope('__proto__')).toBe(false);
  });

  it('reports only the scopes a legacy grant does not cover', () => {
    expect(missingScopes(['alarms:read'], ['alerts:read'])).toEqual([]);
    expect(missingScopes(['alarms:read'], ['alerts:write'])).toEqual(['alerts:write']);
    expect(missingScopes(['tanks:read'], ['alerts:read', 'tanks:read'])).toEqual(['alerts:read']);
  });
});

describe('InsufficientScopeError', () => {
  it('is a ForbiddenError that names the missing scope', () => {
    const error = new InsufficientScopeError(['alerts:read']);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.requiredScopes).toEqual(['alerts:read']);
    expect(error.message).toContain('alerts:read scope required');
    expect(error.message).toContain('includes it');
  });

  it('pluralizes for several scopes', () => {
    const error = new InsufficientScopeError(['alerts:read', 'tanks:read']);
    expect(error.message).toContain('alerts:read, tanks:read scopes');
    expect(error.message).toContain('includes them');
  });
});
