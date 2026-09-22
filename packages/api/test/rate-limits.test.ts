import { afterEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '@fueltrack/core';
import {
  bearer,
  createHarness,
  readingPayload,
  seedTenant,
  TENANT_A,
  type TestHarness,
} from './helpers.js';

/**
 * Throttling behaviour.
 *
 * The limiters are injected with tiny budgets so the tests assert the *contract*
 * (which requests are counted, per what identity, and what a refusal looks like)
 * instead of spending 600 requests proving the documented default.
 */

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

async function harnessWith(options: Parameters<typeof createHarness>[0]): Promise<TestHarness> {
  const harness = await createHarness(options);
  harnesses.push(harness);
  return harness;
}

describe('ingestion rate limit', () => {
  it('refuses the reading that exceeds the budget with a retry hint', async () => {
    const harness = await harnessWith({
      ingestionLimiter: createRateLimiter({ limit: 2, windowSeconds: 60 }),
    });
    const { tankId } = await seedTenant(harness);

    const first = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ observedAt: '2026-01-01T00:00:00.000Z' }),
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ observedAt: '2026-01-01T00:01:00.000Z' }),
    });
    const third = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ observedAt: '2026-01-01T00:02:00.000Z' }),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({ error: 'rate_limited' });
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);

    // The refused submission was never stored.
    const listed = await harness.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
    });
    expect(listed.json().readings).toHaveLength(2);
  });

  it('counts per credential, not per tenant or per client address', async () => {
    const harness = await harnessWith({
      ingestionLimiter: createRateLimiter({ limit: 1, windowSeconds: 60 }),
    });
    const { tankId } = await seedTenant(harness);
    const second = await harness.deps.issueApiKey({
      tenantId: TENANT_A,
      name: 'probe-2',
      scopes: ['readings:read', 'readings:write'],
    });

    const first = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ observedAt: '2026-01-01T00:00:00.000Z' }),
    });
    const exhausted = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ observedAt: '2026-01-01T00:01:00.000Z' }),
    });
    const otherCredential = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(second.secret),
      payload: readingPayload({ observedAt: '2026-01-01T00:02:00.000Z' }),
    });

    expect(first.statusCode).toBe(201);
    expect(exhausted.statusCode).toBe(429);
    expect(otherCredential.statusCode).toBe(201);
  });

  it('does not throttle reads', async () => {
    const harness = await harnessWith({
      ingestionLimiter: createRateLimiter({ limit: 1, windowSeconds: 60 }),
    });
    const { tankId } = await seedTenant(harness);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await harness.app.inject({
        method: 'GET',
        url: `/v1/tanks/${tankId}/readings`,
        headers: bearer(harness.keyForTenantA),
      });
      expect(response.statusCode).toBe(200);
    }
  });
});

describe('per-credential api limit', () => {
  it('throttles every v1 request above the budget', async () => {
    const harness = await harnessWith({
      apiLimiter: createRateLimiter({ limit: 2, windowSeconds: 60 }),
    });

    const first = await harness.app.inject({
      method: 'GET',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantA),
    });
    const second = await harness.app.inject({
      method: 'GET',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
    });
    const third = await harness.app.inject({
      method: 'GET',
      url: '/v1/dashboard/summary',
      headers: bearer(harness.keyForTenantA),
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({ error: 'rate_limited' });
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('leaves health checks unlimited and can be disabled', async () => {
    const harness = await harnessWith({ apiLimiter: null });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const health = await harness.app.inject({ method: 'GET', url: '/healthz' });
      expect(health.statusCode).toBe(200);
    }
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantA),
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('authentication failure limit', () => {
  it('throttles repeated rejected credentials without affecting valid ones', async () => {
    const harness = await harnessWith({
      authLimiter: createRateLimiter({ limit: 2, windowSeconds: 60 }),
    });

    const attempt = () =>
      harness.app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: bearer('ftk_key-not-real_secret'),
      });

    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);
    const refused = await attempt();
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: 'rate_limited' });

    // A valid credential is not paying for the failures of an attacker.
    const valid = await harness.app.inject({
      method: 'GET',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantA),
    });
    expect(valid.statusCode).toBe(200);
  });
});
