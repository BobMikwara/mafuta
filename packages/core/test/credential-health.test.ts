import { describe, expect, it, vi } from 'vitest';
import {
  createCachedCredentialStatus,
  createMemoryApiKeyRegistry,
  generateApiKey,
  inspectCredentialStore,
  type ApiKeyRecord,
  type ApiKeyRegistry,
  type CredentialStoreStatus,
} from '../src/index.js';
import { TENANT_A } from './factories.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

async function registryWith(options: {
  store?: ApiKeyRecord;
  clock?: () => Date;
}): Promise<ApiKeyRegistry> {
  const registry = createMemoryApiKeyRegistry({ clock: options.clock ?? (() => NOW) });
  if (options.store !== undefined) {
    // The reference registry is the production shape for every non-Prisma
    // deployment, so the tests write through it rather than through a stub.
    await registry.save(options.store);
  }
  return registry;
}

function keyRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  const generated = generateApiKey({
    tenantId: TENANT_A,
    name: 'probe',
    scopes: ['tanks:read'],
    createdAt: NOW.toISOString(),
  });
  return { ...generated.record, ...overrides };
}

describe('credential store inspection', () => {
  it('reports ready with a count when a usable credential exists', async () => {
    const status = await inspectCredentialStore(await registryWith({ store: keyRecord() }));
    expect(status).toEqual({ state: 'ready', usableCredentials: 1 });
  });

  it('reports empty when nothing was ever provisioned', async () => {
    // The production failure this module exists for: a reachable store that
    // holds no key answers every request as if the key were wrong.
    const status = await inspectCredentialStore(await registryWith({}));
    expect(status).toEqual({ state: 'empty', usableCredentials: 0 });
  });

  it('does not count a revoked credential as usable', async () => {
    const status = await inspectCredentialStore(
      await registryWith({ store: keyRecord({ status: 'revoked' }) }),
    );
    expect(status).toEqual({ state: 'empty', usableCredentials: 0 });
  });

  it('does not count an expired credential as usable', async () => {
    const status = await inspectCredentialStore(
      await registryWith({
        store: keyRecord({ expiresAt: '2026-01-02T00:00:00.000Z' }),
        clock: () => new Date('2026-02-01T00:00:00.000Z'),
      }),
    );
    expect(status).toEqual({ state: 'empty', usableCredentials: 0 });
  });

  it('reports an unreachable store without capturing the driver message', async () => {
    const failure = Object.assign(
      new Error("Can't reach database server at postgresql://user:pw@host:5432/db"),
      { name: 'PrismaClientInitializationError', code: 'P1001' },
    );
    const status = await inspectCredentialStore({
      ...(await registryWith({})),
      countUsable: async () => {
        throw failure;
      },
    });

    expect(status.state).toBe('unavailable');
    expect(status.usableCredentials).toBeNull();
    expect(status.reason).toBe('PrismaClientInitializationError');
    expect(status.code).toBe('P1001');
    // Error messages can embed connection strings, so only the signature is kept.
    expect(JSON.stringify(status)).not.toContain('postgresql://');
    expect(JSON.stringify(status)).not.toContain('pw@host');
  });

  it('reports an unknown error class without a code', async () => {
    const status = await inspectCredentialStore({
      ...(await registryWith({})),
      countUsable: async () => {
        throw new Error('plain failure');
      },
    });
    expect(status).toMatchObject({ state: 'unavailable', reason: 'Error' });
    expect(status.code).toBeUndefined();
  });
});

describe('cached credential status', () => {
  it('reuses a result inside the time to live and refreshes after it', async () => {
    const calls: number[] = [];
    let clockValue = 0;
    const reader = createCachedCredentialStatus(
      async (): Promise<CredentialStoreStatus> => {
        calls.push(clockValue);
        return { state: 'empty', usableCredentials: 0 };
      },
      { ttlMs: 1_000, now: () => clockValue },
    );

    await reader();
    clockValue = 500;
    await reader();
    expect(calls).toHaveLength(1);

    clockValue = 1_500;
    await reader();
    expect(calls).toHaveLength(2);
  });

  it('shares one read between concurrent callers', async () => {
    const reader = vi.fn(async (): Promise<CredentialStoreStatus> => ({
      state: 'ready',
      usableCredentials: 2,
    }));
    const status = createCachedCredentialStatus(reader, { ttlMs: 1_000, now: () => 0 });

    const [first, second] = await Promise.all([status(), status()]);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('does not cache a rejected reader', async () => {
    let attempts = 0;
    const reader = createCachedCredentialStatus(
      async (): Promise<CredentialStoreStatus> => {
        attempts += 1;
        throw new Error('store offline');
      },
      { ttlMs: 1_000, now: () => 0 },
    );

    await expect(reader()).rejects.toThrow('store offline');
    await expect(reader()).rejects.toThrow('store offline');
    expect(attempts).toBe(2);
  });
});
