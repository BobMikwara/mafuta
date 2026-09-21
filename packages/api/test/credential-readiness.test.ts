import { describe, expect, it } from 'vitest';
import {
  createLogger,
  createMemoryApiKeyRegistry,
  manualClock,
  toTenantId,
  type ApiKeyRegistry,
  type CredentialStoreStatus,
  type LogRecord,
} from '@fueltrack/core';
import { buildServer } from '../src/server.js';
import {
  checkCredentialReadiness,
  credentialProvisioningHint,
  type CredentialReadinessContext,
} from '../src/credential-readiness.js';
import { createPlatformDependencies } from '../src/dependency-factory.js';

const TENANT_A = toTenantId('tenant-a');

const SERVER_CONTEXT: CredentialReadinessContext = {
  deployment: 'server',
  persistence: 'memory',
  demoSeedEnabled: false,
  devApiKeyConfigured: true,
};

function captureLogger(): { logger: ReturnType<typeof createLogger>; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    logger: createLogger({ sink: (record) => records.push(record), minLevel: 'debug' }),
    records,
  };
}

async function seededRegistry(): Promise<ApiKeyRegistry> {
  const apiKeys = createMemoryApiKeyRegistry({ clock: () => new Date('2026-01-01T00:00:00.000Z') });
  await createPlatformDependencies({
    apiKeys,
    logger: createLogger({ sink: () => {}, minLevel: 'critical' }),
  }).issueApiKey({ tenantId: TENANT_A, name: 'probe', scopes: ['tanks:read'] });
  return apiKeys;
}

describe('credential readiness check', () => {
  it('reports ready and logs the count', async () => {
    const { logger, records } = captureLogger();
    const result = await checkCredentialReadiness(
      { apiKeys: await seededRegistry(), logger, context: SERVER_CONTEXT },
      { requireCredentials: true },
    );

    expect(result.status).toEqual({ state: 'ready', usableCredentials: 1 });
    expect(result.hint).toBeNull();
    expect(records[0]?.message).toBe('credentials.ready');
    expect(records[0]?.level).toBe('info');
  });

  it('warns when the credentials live in a per-process store', async () => {
    // A key in memory authenticates until the process ends or a second instance
    // answers, which is the other way a valid key gets rejected.
    const { logger, records } = captureLogger();
    await checkCredentialReadiness(
      { apiKeys: await seededRegistry(), logger, context: SERVER_CONTEXT },
      { requireCredentials: true },
    );

    const warning = records.find((record) => record.message === 'credentials.ephemeral_store');
    expect(warning?.level).toBe('warn');
    expect(warning?.context['hint']).toContain('USE_PRISMA=true');
  });

  it('does not warn when credentials are stored durably', async () => {
    const { logger, records } = captureLogger();
    await checkCredentialReadiness(
      {
        apiKeys: await seededRegistry(),
        logger,
        context: { ...SERVER_CONTEXT, persistence: 'prisma' },
      },
      { requireCredentials: true },
    );

    expect(records.map((record) => record.message)).toEqual(['credentials.ready']);
  });

  it('logs an actionable error when credentials are required and missing', async () => {
    const { logger, records } = captureLogger();
    const result = await checkCredentialReadiness(
      { apiKeys: createMemoryApiKeyRegistry(), logger, context: SERVER_CONTEXT },
      { requireCredentials: true },
    );

    expect(result.status).toEqual({ state: 'empty', usableCredentials: 0 });
    expect(records[0]?.message).toBe('credentials.missing');
    expect(records[0]?.level).toBe('error');
    expect(records[0]?.context['devApiKeyConfigured']).toBe(true);
    expect(records[0]?.context['demoSeedEnabled']).toBe(false);
    const hint = String(result.hint);
    // Names the exact misconfiguration: the key was set, the seed was not.
    expect(hint).toContain('FUELTRACK_DEV_API_KEY is set');
    expect(hint).toContain('FUELTRACK_SEED_DEMO=true');
    // Names the durability trap of the default in-memory store.
    expect(hint).toContain('USE_PRISMA=true');
  });

  it('downgrades to a warning when credentials are not required', async () => {
    const { logger, records } = captureLogger();
    await checkCredentialReadiness(
      { apiKeys: createMemoryApiKeyRegistry(), logger, context: SERVER_CONTEXT },
      { requireCredentials: false },
    );
    expect(records[0]?.message).toBe('credentials.missing');
    expect(records[0]?.level).toBe('warn');
  });

  it('reports an unreadable store with its signature only', async () => {
    const { logger, records } = captureLogger();
    const apiKeys = createMemoryApiKeyRegistry();
    const failing: ApiKeyRegistry = {
      ...apiKeys,
      countUsable: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED postgresql://user:pw@db:5432'), {
          name: 'PrismaClientInitializationError',
          code: 'P1001',
        });
      },
    };

    const result = await checkCredentialReadiness(
      { apiKeys: failing, logger, context: SERVER_CONTEXT },
      { requireCredentials: true },
    );

    expect(result.status.state).toBe('unavailable');
    // An unreadable store must not stop a restart: the health endpoint reports it.
    expect(result.hint).toBeNull();
    const record = records.find((entry) => entry.message === 'credentials.unavailable');
    expect(record?.context['reason']).toBe('PrismaClientInitializationError');
    expect(record?.context['code']).toBe('P1001');
    expect(JSON.stringify(records)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(records)).not.toContain('pw@db');
  });

  it('gives guidance that does not depend on the demo seed', () => {
    const hint = credentialProvisioningHint({
      ...SERVER_CONTEXT,
      demoSeedEnabled: true,
    });
    expect(hint).toContain('key:provision');
    expect(hint).not.toContain('FUELTRACK_DEV_API_KEY is set');
  });
});

describe('healthz credential state', () => {
  async function healthWith(credentials: CredentialStoreStatus | null): Promise<{
    statusCode: number;
    body: Record<string, unknown>;
  }> {
    const deps = createPlatformDependencies({
      logger: createLogger({ sink: () => {}, minLevel: 'critical' }),
      clock: manualClock('2026-01-01T00:00:00.000Z'),
    });
    const app = await buildServer(
      credentials === null ? deps : { ...deps, credentialStatus: async () => credentials },
    );
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
    } finally {
      await app.close();
    }
  }

  it('reports ready credentials on a healthy deployment', async () => {
    const { statusCode, body } = await healthWith({ state: 'ready', usableCredentials: 3 });
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ status: 'ok', credentials: 'ready' });
    expect(JSON.stringify(body)).not.toContain('usableCredentials');
  });

  it('is degraded when the store is empty, which used to look healthy', async () => {
    const { statusCode, body } = await healthWith({ state: 'empty', usableCredentials: 0 });
    expect(statusCode).toBe(503);
    expect(body).toMatchObject({ status: 'degraded', credentials: 'empty' });
  });

  it('is degraded when the store cannot be read, without leaking the reason', async () => {
    const { statusCode, body } = await healthWith({
      state: 'unavailable',
      usableCredentials: null,
      reason: 'PrismaClientInitializationError',
      code: 'P1001',
    });
    expect(statusCode).toBe(503);
    expect(body).toMatchObject({ status: 'degraded', credentials: 'unavailable' });
    expect(JSON.stringify(body)).not.toContain('P1001');
    expect(JSON.stringify(body)).not.toContain('Prisma');
  });

  it('leaves embedded servers untouched when no reader is configured', async () => {
    const { statusCode, body } = await healthWith(null);
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ status: 'ok', credentials: 'not_configured' });
  });
});
