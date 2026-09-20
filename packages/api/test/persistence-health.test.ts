import { describe, expect, it } from 'vitest';
import {
  createLogger,
  createSilentLogger,
  manualClock,
  type ApiKeyRecord,
  type ApiKeyRegistry,
  type LogRecord,
} from '@fueltrack/core';
import { buildServer } from '../src/server.js';
import { createPlatformDependencies } from '../src/dependency-factory.js';

/**
 * Pins the behavior operators rely on when a deployed persistence backend
 * breaks: `/healthz` must say so, and request failures must keep the
 * `internal_error` + requestId shape that the platform logs can correlate.
 */

function silentDeps() {
  return createPlatformDependencies({
    logger: createSilentLogger(),
    clock: manualClock('2026-01-01T00:00:00.000Z'),
  });
}

describe('healthz readiness', () => {
  it('reports the in-memory backend without a readiness probe', async () => {
    const deps = silentDeps();
    const app = await buildServer(deps);
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'ok',
        persistence: 'memory',
        database: 'not_configured',
      });
    } finally {
      await app.close();
    }
  });

  it('reports the database as up when the probe resolves', async () => {
    const deps = silentDeps();
    const app = await buildServer({
      ...deps,
      persistence: 'prisma',
      ready: async () => Promise.resolve(),
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'ok',
        persistence: 'prisma',
        database: 'up',
      });
    } finally {
      await app.close();
    }
  });

  it('reports database unmigrated when the connection works but tables are missing', async () => {
    // This is the exact state in the reported incident: the pooler answers, the
    // readiness probe passes, but no migration ever ran, so every /v1 request
    // 401s. /healthz must say 'unmigrated', not 'up'.
    const deps = silentDeps();
    const app = await buildServer({
      ...deps,
      persistence: 'prisma',
      ready: async () => Promise.resolve(),
      schemaStatus: async () => ({
        status: 'unmigrated',
        missingTables: ['tenants', 'stations', 'api_keys'],
      }),
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        persistence: 'prisma',
        database: 'unmigrated',
      });
      // Table names are safe to log but must not reach the HTTP body.
      expect(JSON.stringify(response.json())).not.toContain('tenants');
    } finally {
      await app.close();
    }
  });

  it('reports database up when the schema probe confirms the tables exist', async () => {
    const deps = silentDeps();
    const app = await buildServer({
      ...deps,
      persistence: 'prisma',
      ready: async () => Promise.resolve(),
      schemaStatus: async () => ({ status: 'migrated' }),
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ok', database: 'up' });
    } finally {
      await app.close();
    }
  });

  it('stays healthy when the schema probe hangs, so a slow catalog query cannot fail readiness', async () => {
    const deps = silentDeps();
    const app = await buildServer({
      ...deps,
      persistence: 'prisma',
      ready: async () => Promise.resolve(),
      schemaStatus: () => new Promise<never>(() => {}),
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      // The probe times out to null, which is treated as "not unmigrated".
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ok', database: 'up' });
    } finally {
      await app.close();
    }
  });

  it('returns 503 with status degraded when the database probe fails', async () => {
    const deps = silentDeps();
    const unreachable = Object.assign(new Error('connect ETIMEDOUT'), {
      name: 'PrismaClientInitializationError',
    });
    const app = await buildServer({
      ...deps,
      persistence: 'prisma',
      ready: async () => Promise.reject(unreachable),
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        persistence: 'prisma',
        database: 'down',
      });
      // No driver detail may leak into the response body.
      expect(JSON.stringify(response.json())).not.toContain('ETIMEDOUT');
    } finally {
      await app.close();
    }
  });
});

describe('persistence failure signature', () => {
  it('answers internal_error with a requestId when the credential lookup fails', async () => {
    // Auth performs the first database read of every request, so a broken
    // database always fails at the key lookup, regardless of which route was
    // called. The response must stay generic (no internals) while the logs
    // capture the error name and driver code.
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: (record) => records.push(record),
      minLevel: 'debug',
    });

    const prismaInitializationError = Object.assign(new Error("Can't reach database server"), {
      name: 'PrismaClientInitializationError',
      code: 'P1001',
    });

    const failingRegistry: ApiKeyRegistry = {
      findBySecret: async () => {
        throw prismaInitializationError;
      },
      save: async (_record: ApiKeyRecord) => {},
      touchLastUsed: async () => {},
      revoke: async () => false,
      list: async () => [],
    };

    const deps = createPlatformDependencies({
      logger,
      clock: manualClock('2026-01-01T00:00:00.000Z'),
      apiKeys: failingRegistry,
    });
    const app = await buildServer(deps);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: 'Bearer some-key' },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json() as Record<string, unknown>;
      expect(body['error']).toBe('internal_error');
      expect(typeof body['requestId']).toBe('string');
      expect(String(body['requestId'])).toMatch(/^req-/);
      // Internal detail must never be exposed to the caller.
      expect('message' in body).toBe(false);
      expect(JSON.stringify(body)).not.toContain('database server');

      const logEntry = records.find((record) => record.message === 'http.unhandled_error');
      expect(logEntry).toBeDefined();
      expect(logEntry?.context['reason']).toBe('PrismaClientInitializationError');
      expect(logEntry?.context['code']).toBe('P1001');
      expect(logEntry?.context['requestId']).toBe(body['requestId']);
    } finally {
      await app.close();
    }
  });
});
