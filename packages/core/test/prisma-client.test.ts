import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUIRED_TABLES } from '../src/adapters/prisma/migrate.js';

vi.mock('@prisma/client', async () => {
  const { MockPrismaClient } = await import('./prisma-mock.js');
  return { PrismaClient: MockPrismaClient };
});

import {
  checkPrismaConnection,
  describePrismaSchemaStatus,
  ensureTenantExists,
  getPrismaClient,
} from '../src/adapters/prisma/client.js';
import {
  clearPrismaClientCache,
  lastPrismaClientOptions,
  mockPrisma,
  resetMockPrisma,
} from './prisma-mock.js';

/**
 * Unit tests for the Prisma client module: singleton caching for serverless
 * warm starts, the readiness probe, tenant bootstrap, and the schema probe
 * that tells an unreachable database apart from a never migrated one.
 */

beforeEach(() => {
  resetMockPrisma();
  clearPrismaClientCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearPrismaClientCache();
});

describe('getPrismaClient', () => {
  it('caches one client on globalThis for warm starts', () => {
    const first = getPrismaClient();
    const second = getPrismaClient();
    expect(second).toBe(first);
    expect(globalThis.__prisma_client__).toBe(first);
  });

  it('configures development logging outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    getPrismaClient();
    expect(lastPrismaClientOptions()).toEqual({ log: ['warn', 'error'] });
  });

  it('configures error only logging in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    getPrismaClient();
    expect(lastPrismaClientOptions()).toEqual({ log: ['error'] });
  });
});

describe('checkPrismaConnection', () => {
  it('issues a trivial query and resolves when the database answers', async () => {
    await expect(checkPrismaConnection()).resolves.toBeUndefined();
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects when the driver raises', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    await expect(checkPrismaConnection()).rejects.toThrow('connection refused');
  });
});

describe('ensureTenantExists', () => {
  it('upserts the tenant with platform defaults', async () => {
    await ensureTenantExists('demo-tenant');
    expect(mockPrisma.tenant.upsert).toHaveBeenCalledWith({
      where: { id: 'demo-tenant' },
      update: {},
      create: {
        id: 'demo-tenant',
        name: 'demo-tenant',
        slug: 'demo-tenant',
        status: 'active',
        country: 'TZ',
        timezone: 'Africa/Dar_es_Salaam',
      },
    });
  });
});

describe('describePrismaSchemaStatus', () => {
  it('reports migrated when every required table exists', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce(
      REQUIRED_TABLES.map((name) => ({ table_name: name })),
    );
    await expect(describePrismaSchemaStatus()).resolves.toEqual({ status: 'migrated' });
  });

  it('reports unmigrated and names the missing tables', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ table_name: 'tenants' }]);
    const status = await describePrismaSchemaStatus();
    expect(status.status).toBe('unmigrated');
    if (status.status === 'unmigrated') {
      expect(status.missingTables).toContain('api_keys');
      expect(status.missingTables).not.toContain('tenants');
    }
  });

  it('reports unknown with the error name when the probe raises', async () => {
    const failure = Object.assign(new Error('pool unavailable'), { code: 'P1001' });
    mockPrisma.$queryRaw.mockRejectedValueOnce(failure);
    await expect(describePrismaSchemaStatus()).resolves.toEqual({
      status: 'unknown',
      reason: 'Error',
      code: 'P1001',
    });
  });

  it('reports unknown without a code for untyped failures', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce('not an error object');
    await expect(describePrismaSchemaStatus()).resolves.toEqual({
      status: 'unknown',
      reason: 'unknown',
    });
  });
});
