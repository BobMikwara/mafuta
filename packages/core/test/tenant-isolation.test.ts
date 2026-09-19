import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../src/adapters/memory/memory-repositories.js';
import { TenantIsolationError, UnauthorizedError } from '../src/errors.js';
import {
  assertAllOwnedByTenant,
  assertOwnedByTenant,
  filterByTenant,
} from '../src/tenancy/guard.js';
import {
  getTenantContext,
  hasScope,
  requireTenantContext,
  runWithTenantContext,
  type TenantContext,
} from '../src/tenancy/tenant-context.js';
import { makeReading, makeSite, makeTank, TENANT_A, TENANT_B } from './factories.js';

const CONTEXT_A: TenantContext = {
  tenantId: TENANT_A,
  principalId: 'principal-a' as TenantContext['principalId'],
  apiKeyId: 'key-a' as TenantContext['apiKeyId'],
  scopes: ['readings:read', 'readings:write'],
};

describe('tenant guard helpers', () => {
  it('accepts an entity owned by the tenant', () => {
    expect(() =>
      assertOwnedByTenant(TENANT_A, makeSite({ tenantId: TENANT_A }), 'test'),
    ).not.toThrow();
  });

  it('rejects an entity owned by another tenant', () => {
    expect(() => assertOwnedByTenant(TENANT_A, makeSite({ tenantId: TENANT_B }), 'test')).toThrow(
      TenantIsolationError,
    );
  });

  it('validates every element of a collection', () => {
    expect(() =>
      assertAllOwnedByTenant(
        TENANT_A,
        [makeSite({ tenantId: TENANT_A }), makeSite({ tenantId: TENANT_B })],
        'test',
      ),
    ).toThrow(TenantIsolationError);
  });

  it('filters collections down to a single tenant', () => {
    const filtered = filterByTenant(TENANT_A, [
      makeSite({ id: 'site-a' as never, tenantId: TENANT_A }),
      makeSite({ id: 'site-b' as never, tenantId: TENANT_B }),
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.tenantId).toBe(TENANT_A);
  });
});

describe('tenant context', () => {
  it('exposes the context only inside the async scope', () => {
    expect(getTenantContext()).toBeUndefined();
    expect(() => requireTenantContext()).toThrow(UnauthorizedError);

    runWithTenantContext(CONTEXT_A, () => {
      expect(requireTenantContext().tenantId).toBe(TENANT_A);
      expect(hasScope('readings:write')).toBe(true);
      expect(hasScope('tanks:write')).toBe(false);
    });

    expect(getTenantContext()).toBeUndefined();
  });

  it('does not leak a sibling context', async () => {
    await runWithTenantContext(CONTEXT_A, async () => {
      await Promise.resolve();
      expect(requireTenantContext().tenantId).toBe(TENANT_A);
    });
  });
});

describe('repository tenant isolation', () => {
  it('returns only rows belonging to the requesting tenant', async () => {
    const repositories = createMemoryRepositories();
    await repositories.sites.save(
      TENANT_A,
      makeSite({ id: 'site-a' as never, tenantId: TENANT_A }),
    );
    await repositories.sites.save(
      TENANT_B,
      makeSite({ id: 'site-b' as never, tenantId: TENANT_B }),
    );

    const tenantA = await repositories.sites.list(TENANT_A);
    const tenantB = await repositories.sites.list(TENANT_B);

    expect(tenantA.map((site) => site.id)).toEqual(['site-a']);
    expect(tenantB.map((site) => site.id)).toEqual(['site-b']);
  });

  it('returns null when a tenant asks for another tenant row by id', async () => {
    const repositories = createMemoryRepositories();
    const siteB = makeSite({ id: 'site-b' as never, tenantId: TENANT_B });
    await repositories.sites.save(TENANT_B, siteB);

    expect(await repositories.sites.findById(TENANT_A, siteB.id)).toBeNull();
    expect((await repositories.sites.findById(TENANT_B, siteB.id))?.id).toBe('site-b');
  });

  it('refuses to persist a tank whose tenant does not match the caller', async () => {
    const repositories = createMemoryRepositories();
    await expect(
      repositories.tanks.save(TENANT_A, makeTank({ tenantId: TENANT_B })),
    ).rejects.toThrow(TenantIsolationError);
  });

  it('refuses to persist a reading whose tenant does not match the caller', async () => {
    const repositories = createMemoryRepositories();
    await expect(
      repositories.readings.append(TENANT_A, makeReading({ tenantId: TENANT_B })),
    ).rejects.toThrow(TenantIsolationError);
  });

  it('refuses to persist an alarm whose tenant does not match the caller', async () => {
    const repositories = createMemoryRepositories();
    const alarm = {
      id: 'alm-1' as never,
      tenantId: TENANT_B,
      tankId: makeTank().id,
      type: 'low-level' as const,
      severity: 'warning' as const,
      status: 'open' as const,
      message: 'cross tenant attempt',
      raisedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      readingId: null,
      metrics: {},
    };
    await expect(repositories.alarms.save(TENANT_A, alarm)).rejects.toThrow(TenantIsolationError);
  });

  it('scopes reading history to the tenant and the tank', async () => {
    const repositories = createMemoryRepositories();
    const tankA = makeTank({ id: 'tank-a' as never, tenantId: TENANT_A });
    const tankB = makeTank({ id: 'tank-b' as never, tenantId: TENANT_B });
    await repositories.tanks.save(TENANT_A, tankA);
    await repositories.tanks.save(TENANT_B, tankB);
    await repositories.readings.append(
      TENANT_A,
      makeReading({ id: 'rdg-a' as never, tenantId: TENANT_A, tankId: tankA.id }),
    );
    await repositories.readings.append(
      TENANT_B,
      makeReading({ id: 'rdg-b' as never, tenantId: TENANT_B, tankId: tankB.id }),
    );

    const forA = await repositories.readings.list(TENANT_A, { tankId: tankA.id });
    expect(forA.map((reading) => reading.id)).toEqual(['rdg-a']);
    expect(await repositories.readings.latest(TENANT_A, tankB.id)).toBeNull();
  });

  it('returns copies so a caller cannot mutate stored state', async () => {
    const repositories = createMemoryRepositories();
    const site = makeSite();
    await repositories.sites.save(TENANT_A, site);
    const loaded = await repositories.sites.findById(TENANT_A, site.id);
    expect(loaded).not.toBe(site);
    expect(loaded?.name).toBe(site.name);
  });
});
