import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateApiKey, hashApiKey, type ApiKeyRecord } from '../src/tenancy/api-key.js';
import { TenantIsolationError } from '../src/errors.js';
import { createPrismaApiKeyRegistry } from '../src/adapters/prisma/prisma-api-key-registry.js';
import { toApiKeyId, toTenantId } from '../src/types/ids.js';

vi.mock('@prisma/client', async () => {
  const { MockPrismaClient } = await import('./prisma-mock.js');
  return { PrismaClient: MockPrismaClient };
});

import { clearPrismaClientCache, mockPrisma, resetMockPrisma } from './prisma-mock.js';

/**
 * Unit tests for the Prisma API key registry. The security contract under test:
 * lookup is by hash only, revoked and expired credentials stop resolving, list
 * output never carries key material, and a revoke is scoped to the owning
 * tenant.
 */

const TENANT = toTenantId('tenant-a');
const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

function makeRecord(options: { secret?: string; overrides?: Partial<ApiKeyRecord> } = {}) {
  const generated = generateApiKey({
    tenantId: TENANT,
    name: 'console',
    scopes: ['tanks:read', 'alerts:read'],
    createdAt: FIXED_NOW.toISOString(),
  });
  const secret = options.secret ?? generated.secret;
  const record: ApiKeyRecord = {
    ...generated.record,
    keyHash: hashApiKey(secret),
    ...options.overrides,
  };
  return { record, secret };
}

function toRow(record: ApiKeyRecord) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    keyHash: record.keyHash,
    scopes: [...record.scopes],
    status: record.status,
    createdAt: new Date(record.createdAt),
    expiresAt: record.expiresAt === null ? null : new Date(record.expiresAt),
    lastUsedAt: record.lastUsedAt === null ? null : new Date(record.lastUsedAt),
  };
}

function registryAt(now: Date = FIXED_NOW) {
  return createPrismaApiKeyRegistry({ clock: () => now });
}

beforeEach(() => {
  resetMockPrisma();
  clearPrismaClientCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearPrismaClientCache();
});

describe('findBySecret', () => {
  it('resolves a usable credential by its hash', async () => {
    const { record, secret } = makeRecord();
    mockPrisma.apiKey.findUnique.mockResolvedValueOnce(toRow(record));

    const found = await registryAt().findBySecret(secret);
    expect(mockPrisma.apiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: hashApiKey(secret) },
    });
    expect(found).not.toBeNull();
    expect(found?.id).toBe(record.id);
    expect(found?.tenantId).toBe(TENANT);
    expect(found?.scopes).toEqual(['tanks:read', 'alerts:read']);
  });

  it('resolves nothing for an unknown secret', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValueOnce(null);
    await expect(registryAt().findBySecret('ftk_key-none_unknown')).resolves.toBeNull();
  });

  it('resolves nothing for a revoked credential', async () => {
    const { record, secret } = makeRecord({ overrides: { status: 'revoked' } });
    mockPrisma.apiKey.findUnique.mockResolvedValueOnce(toRow(record));
    await expect(registryAt().findBySecret(secret)).resolves.toBeNull();
  });

  it('resolves nothing for an expired credential', async () => {
    const { record, secret } = makeRecord({
      overrides: { expiresAt: '2025-01-01T00:00:00.000Z' },
    });
    mockPrisma.apiKey.findUnique.mockResolvedValueOnce(toRow(record));
    await expect(registryAt().findBySecret(secret)).resolves.toBeNull();
  });
});

describe('save', () => {
  it('stores only the hash, and bootstraps the tenant first', async () => {
    const { record, secret } = makeRecord();
    await registryAt().save(record);

    expect(mockPrisma.tenant.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.apiKey.upsert).toHaveBeenCalledTimes(1);
    const args = JSON.stringify(mockPrisma.apiKey.upsert.mock.calls[0]);
    expect(args).toContain(record.keyHash);
    expect(args).not.toContain(secret);
  });
});

describe('touchLastUsed', () => {
  it('writes the usage timestamp for the key id only', async () => {
    const { record } = makeRecord();
    await registryAt().touchLastUsed(record.id, '2026-01-02T03:04:05.000Z');
    expect(mockPrisma.apiKey.updateMany).toHaveBeenCalledWith({
      where: { id: record.id },
      data: { lastUsedAt: new Date('2026-01-02T03:04:05.000Z') },
    });
  });
});

describe('revoke', () => {
  it('returns false for a key id the tenant does not hold', async () => {
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce(null);
    await expect(registryAt().revoke(TENANT, toApiKeyId('key-missing'))).resolves.toBe(false);
    expect(mockPrisma.apiKey.findFirst).toHaveBeenCalledWith({
      where: { id: 'key-missing', tenantId: TENANT },
    });
  });

  it('marks the key revoked and returns true', async () => {
    const { record } = makeRecord();
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce(toRow(record));
    await expect(registryAt().revoke(TENANT, record.id)).resolves.toBe(true);
    expect(mockPrisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: record.id },
      data: { status: 'revoked' },
    });
  });

  it('raises a tenant isolation violation if a row escapes the tenant filter', async () => {
    // Defence in depth: findFirst is already scoped by tenantId, so this can
    // only happen if storage misbehaves. Ownership is re-asserted anyway.
    const { record } = makeRecord();
    mockPrisma.apiKey.findFirst.mockResolvedValueOnce(
      toRow({ ...record, tenantId: toTenantId('tenant-b') }),
    );
    await expect(registryAt().revoke(TENANT, record.id)).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
  });
});

describe('list', () => {
  it('returns tenant keys without key material', async () => {
    const { record } = makeRecord();
    mockPrisma.apiKey.findMany.mockResolvedValueOnce([toRow(record)]);

    const keys = await registryAt().list(TENANT);
    expect(mockPrisma.apiKey.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      orderBy: { createdAt: 'desc' },
    });
    expect(keys).toHaveLength(1);
    expect(keys[0]?.id).toBe(record.id);
    expect(keys[0]).not.toHaveProperty('keyHash');
  });
});

describe('countUsable', () => {
  it('counts active, unexpired credentials without reading key material', async () => {
    mockPrisma.apiKey.count.mockResolvedValueOnce(2);
    await expect(registryAt().countUsable()).resolves.toBe(2);
    expect(mockPrisma.apiKey.count).toHaveBeenCalledWith({
      where: {
        status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: FIXED_NOW } }],
      },
    });
  });
});
