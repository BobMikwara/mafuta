import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemoryApiKeyRegistry,
  createSilentLogger,
  generateApiKey,
  requireTenantContext,
} from '@fueltrack/core';
import { registerAuthentication } from '../src/auth.js';
import { registerErrorHandler } from '../src/errors.js';
import { TENANT_A, TENANT_B } from './helpers.js';

/**
 * Verifies the mechanism the whole tenant isolation model rests on: after the
 * authentication hook runs, any code deeper in the call stack can recover the
 * tenant from the async context without it being passed explicitly.
 */
describe('tenant context propagation', () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function buildApp(): Promise<{ app: FastifyInstance; secrets: Record<'a' | 'b', string> }> {
    const apiKeys = createMemoryApiKeyRegistry();
    const first = generateApiKey({
      tenantId: TENANT_A,
      name: 'a',
      scopes: ['tanks:read'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const second = generateApiKey({
      tenantId: TENANT_B,
      name: 'b',
      scopes: ['tanks:read'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await apiKeys.save(first.record);
    await apiKeys.save(second.record);

    const app = Fastify();
    registerErrorHandler(app, createSilentLogger());
    await app.register(async (instance) => {
      registerAuthentication(instance, { apiKeys, logger: createSilentLogger() });
      instance.get('/whoami', async () => {
        const context = requireTenantContext();
        return { tenantId: context.tenantId, scopes: [...context.scopes] };
      });
      // An async boundary inside the handler must not lose the context.
      instance.get('/whoami-late', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { tenantId: requireTenantContext().tenantId };
      });
    });
    apps.push(app);
    return { app, secrets: { a: first.secret, b: second.secret } };
  }

  it('exposes the tenant of the presented credential inside the handler', async () => {
    const { app, secrets } = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${secrets.a}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tenantId: TENANT_A, scopes: ['tanks:read'] });
  });

  it('keeps the context across awaits inside the handler', async () => {
    const { app, secrets } = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/whoami-late',
      headers: { authorization: `Bearer ${secrets.b}` },
    });
    expect(response.json()).toEqual({ tenantId: TENANT_B });
  });

  it('ignores a client supplied tenant header', async () => {
    const { app, secrets } = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${secrets.a}`, 'x-tenant-id': TENANT_B },
    });
    expect(response.json()).toEqual({ tenantId: TENANT_A, scopes: ['tanks:read'] });
  });

  it('rejects requests without credentials', async () => {
    const { app } = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/whoami' });
    expect(response.statusCode).toBe(401);
  });
});
