import { describe, expect, it } from 'vitest';
import { hasLegacyScopes, missingScopes, normalizeScopes } from '../src/tenancy/scopes.js';

describe('legacy scope normalization', () => {
  it('maps site and alarm scopes onto station and alert scopes', () => {
    expect(
      normalizeScopes(['sites:read', 'sites:write', 'alarms:read', 'tanks:read', 'alarms:write']),
    ).toEqual(['stations:read', 'stations:write', 'alerts:read', 'tanks:read', 'alerts:write']);
  });

  it('does not add scopes a legacy key never held', () => {
    const normalized = normalizeScopes(['sites:read', 'tanks:read']);
    expect(normalized).toEqual(['stations:read', 'tanks:read']);
    expect(normalized).not.toContain('stations:write');
    expect(normalized).not.toContain('audit:read');
    expect(normalized).not.toContain('alerts:read');
  });

  it('collapses a key that already holds both names, keeping first appearance order', () => {
    expect(
      normalizeScopes(['tanks:read', 'sites:write', 'stations:write', 'stations:read']),
    ).toEqual(['tanks:read', 'stations:write', 'stations:read']);
  });

  it('leaves current scopes unchanged', () => {
    const current = ['stations:write', 'tanks:write'];
    expect(normalizeScopes(current)).toEqual(current);
    expect(hasLegacyScopes(current)).toBe(false);
    expect(hasLegacyScopes(['sites:write'])).toBe(true);
  });

  it('reports the current name when a legacy grant is not enough', () => {
    expect(missingScopes(['sites:read', 'tanks:read'], ['stations:write'])).toEqual([
      'stations:write',
    ]);
    expect(missingScopes(['sites:write'], ['stations:write'])).toEqual([]);
  });
});
