import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  generateApiKey,
  hashApiKey,
  isApiKeyUsable,
  verifyApiKeySecret,
  API_KEY_PREFIX,
} from '../src/tenancy/api-key.js';
import { createMemoryApiKeyRegistry } from '../src/adapters/memory/memory-api-key-registry.js';
import { TENANT_A, TENANT_B } from './factories.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('api key material', () => {
  it('returns the secret once and stores only its hash', () => {
    const { record, secret } = generateApiKey({
      tenantId: TENANT_A,
      name: 'edge-gateway',
      scopes: ['readings:write'],
      createdAt: NOW.toISOString(),
    });
    expect(secret.startsWith(`${API_KEY_PREFIX}_`)).toBe(true);
    expect(record.keyHash).toBe(hashApiKey(secret));
    expect(record.keyHash).not.toContain(secret);
  });

  it('produces unique secrets for successive keys', () => {
    const first = generateApiKey({
      tenantId: TENANT_A,
      name: 'a',
      scopes: ['readings:read'],
      createdAt: NOW.toISOString(),
    });
    const second = generateApiKey({
      tenantId: TENANT_A,
      name: 'b',
      scopes: ['readings:read'],
      createdAt: NOW.toISOString(),
    });
    expect(first.secret).not.toBe(second.secret);
    expect(first.record.id).not.toBe(second.record.id);
  });

  it('verifies a presented secret and rejects a wrong one', () => {
    const { record, secret } = generateApiKey({
      tenantId: TENANT_A,
      name: 'edge',
      scopes: ['readings:write'],
      createdAt: NOW.toISOString(),
    });
    expect(verifyApiKeySecret(secret, record)).toBe(true);
    expect(verifyApiKeySecret(`${secret}x`, record)).toBe(false);
  });

  it('honours expiry and revocation', () => {
    const { record } = generateApiKey({
      tenantId: TENANT_A,
      name: 'edge',
      scopes: ['readings:write'],
      createdAt: NOW.toISOString(),
      expiresAt: '2026-02-01T00:00:00.000Z',
    });
    expect(isApiKeyUsable(record, new Date('2026-01-15T00:00:00.000Z'))).toBe(true);
    expect(isApiKeyUsable(record, new Date('2026-03-01T00:00:00.000Z'))).toBe(false);
    expect(isApiKeyUsable({ ...record, status: 'revoked' }, NOW)).toBe(false);
  });

  it('compares strings without leaking length through timing', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('api key registry', () => {
  it('resolves a stored credential to its tenant', async () => {
    const registry = createMemoryApiKeyRegistry({ clock: () => NOW });
    const { record, secret } = generateApiKey({
      tenantId: TENANT_A,
      name: 'edge',
      scopes: ['readings:write'],
      createdAt: NOW.toISOString(),
    });
    await registry.save(record);

    const found = await registry.findBySecret(secret);
    expect(found?.tenantId).toBe(TENANT_A);
    expect(found?.scopes).toEqual(['readings:write']);
  });

  it('returns null for an unknown secret', async () => {
    const registry = createMemoryApiKeyRegistry({ clock: () => NOW });
    expect(await registry.findBySecret('ftk_unknown_secret')).toBeNull();
  });

  it('does not resolve a revoked credential', async () => {
    const registry = createMemoryApiKeyRegistry({ clock: () => NOW });
    const { record, secret } = generateApiKey({
      tenantId: TENANT_A,
      name: 'edge',
      scopes: ['readings:write'],
      createdAt: NOW.toISOString(),
    });
    await registry.save(record);
    expect(await registry.revoke(TENANT_A, record.id)).toBe(true);
    expect(await registry.findBySecret(secret)).toBeNull();
  });

  it('refuses to revoke a credential belonging to another tenant', async () => {
    const registry = createMemoryApiKeyRegistry({ clock: () => NOW });
    const { record } = generateApiKey({
      tenantId: TENANT_B,
      name: 'edge',
      scopes: ['readings:write'],
      createdAt: NOW.toISOString(),
    });
    await registry.save(record);
    await expect(registry.revoke(TENANT_A, record.id)).rejects.toThrow();
  });

  it('never exposes the key hash through the read model', async () => {
    const registry = createMemoryApiKeyRegistry({ clock: () => NOW });
    const { record } = generateApiKey({
      tenantId: TENANT_A,
      name: 'edge',
      scopes: ['readings:write'],
      createdAt: NOW.toISOString(),
    });
    await registry.save(record);
    const listed = await registry.list(TENANT_A);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(record.keyHash);
  });

  it('counts only the credentials that could still authenticate', async () => {
    const registry = createMemoryApiKeyRegistry({ clock: () => NOW });
    const usable = generateApiKey({
      tenantId: TENANT_A,
      name: 'usable',
      scopes: ['readings:read'],
      createdAt: NOW.toISOString(),
    });
    const expired = generateApiKey({
      tenantId: TENANT_A,
      name: 'expired',
      scopes: ['readings:read'],
      createdAt: NOW.toISOString(),
      expiresAt: '2025-12-31T00:00:00.000Z',
    });
    const revoked = generateApiKey({
      tenantId: TENANT_B,
      name: 'revoked',
      scopes: ['readings:read'],
      createdAt: NOW.toISOString(),
    });
    await registry.save(usable.record);
    await registry.save(expired.record);
    await registry.save(revoked.record);
    await registry.revoke(TENANT_B, revoked.record.id);

    expect(registry.size()).toBe(3);
    // Deployment diagnostics count every tenant: the question is whether
    // anybody at all can authenticate against this store.
    expect(await registry.countUsable()).toBe(1);
  });

  it('reports zero usable credentials for an empty store', async () => {
    const registry = createMemoryApiKeyRegistry({ clock: () => NOW });
    expect(await registry.countUsable()).toBe(0);
  });

  it('records the last time a credential was used', async () => {
    const registry = createMemoryApiKeyRegistry({ clock: () => NOW });
    const { record } = generateApiKey({
      tenantId: TENANT_A,
      name: 'edge',
      scopes: ['readings:write'],
      createdAt: NOW.toISOString(),
    });
    await registry.save(record);
    await registry.touchLastUsed(record.id, '2026-01-02T00:00:00.000Z');
    const listed = await registry.list(TENANT_A);
    expect(listed[0]?.lastUsedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
