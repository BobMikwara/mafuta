import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bearer,
  createHarness,
  readingPayload,
  SITE_PAYLOAD,
  TANK_PAYLOAD,
  TENANT_A,
  TENANT_B,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.close();
});

async function seedTenantA(): Promise<{ siteId: string; tankId: string }> {
  const siteResponse = await harness.app.inject({
    method: 'POST',
    url: '/v1/sites',
    headers: bearer(harness.keyForTenantA),
    payload: SITE_PAYLOAD,
  });
  const tankResponse = await harness.app.inject({
    method: 'POST',
    url: '/v1/tanks',
    headers: bearer(harness.keyForTenantA),
    payload: TANK_PAYLOAD,
  });
  return {
    siteId: siteResponse.json().site.id as string,
    tankId: tankResponse.json().tank.id as string,
  };
}

describe('health and transport', () => {
  it('reports health without credentials', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('sets defensive response headers on every response', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('rejects an oversized payload', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantA),
      payload: { ...TANK_PAYLOAD, name: 'x'.repeat(200_000) },
    });
    expect(response.statusCode).toBe(413);
  });

  it('returns a structured not found body for unknown routes', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/does-not-exist',
      headers: bearer(harness.keyForTenantA),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
  });
});

describe('authentication and authorization', () => {
  it('rejects a missing authorization header', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/sites' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'unauthorized' });
    expect(response.headers['www-authenticate']).toContain('Bearer');
  });

  it('rejects a malformed or unknown credential', async () => {
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/v1/sites',
          headers: { authorization: 'Bearer ' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/v1/sites',
          headers: { authorization: 'Basic abc' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/v1/sites',
          headers: bearer('ftk_key-not-real_secret'),
        })
      ).statusCode,
    ).toBe(401);
  });

  it('does not reveal whether a tenant exists', async () => {
    const unknown = await harness.app.inject({
      method: 'GET',
      url: '/v1/tanks',
      headers: bearer('ftk_key-not-real_secret'),
    });
    expect(unknown.json()).toEqual({
      error: 'unauthorized',
      message: 'Valid API key credentials are required',
      requestId: expect.any(String),
    });
  });

  it('enforces the scope attached to the credential', async () => {
    const forbidden = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      headers: bearer(harness.keyForTenantAReadonly),
      payload: SITE_PAYLOAD,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ error: 'forbidden' });
  });

  it('requires the simulator scope to submit simulated readings', async () => {
    const { tankId } = await seedTenantA();
    const deviceKey = await harness.deps.issueApiKey({
      tenantId: TENANT_A,
      name: 'device',
      scopes: ['readings:write', 'tanks:read'],
    });

    const denied = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(deviceKey.secret),
      payload: readingPayload({ source: 'simulated' }),
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ source: 'simulated' }),
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().reading.source).toBe('simulated');
  });
});

describe('fleet endpoints', () => {
  it('creates and lists sites for the authenticated tenant only', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      headers: bearer(harness.keyForTenantA),
      payload: SITE_PAYLOAD,
    });
    expect(created.statusCode).toBe(201);

    const forA = await harness.app.inject({
      method: 'GET',
      url: '/v1/sites',
      headers: bearer(harness.keyForTenantA),
    });
    const forB = await harness.app.inject({
      method: 'GET',
      url: '/v1/sites',
      headers: bearer(harness.keyForTenantB),
    });

    expect(forA.json().sites).toHaveLength(1);
    expect(forB.json().sites).toHaveLength(0);
  });

  it('rejects unknown properties on a create payload', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      headers: bearer(harness.keyForTenantA),
      payload: { ...SITE_PAYLOAD, tenantId: TENANT_B },
    });
    expect(response.statusCode).toBe(400);
    const issues = response.json().issues as Array<{ path: string }>;
    expect(issues.map((issue) => issue.path)).toContain('tenantId');
  });

  it('rejects a tank whose capacity exceeds its geometry', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      headers: bearer(harness.keyForTenantA),
      payload: SITE_PAYLOAD,
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantA),
      payload: {
        ...TANK_PAYLOAD,
        geometry: { kind: 'vertical-cylinder', diameterMm: 1000, heightMm: 1000 },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_failed' });
  });

  it('refuses to attach a tank to a site owned by another tenant', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      headers: bearer(harness.keyForTenantA),
      payload: SITE_PAYLOAD,
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantB),
      payload: TANK_PAYLOAD,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('tenant isolation over http', () => {
  it('returns not found when a tenant reads another tenant tank', async () => {
    const { tankId } = await seedTenantA();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tankId}`,
      headers: bearer(harness.keyForTenantB),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
  });

  it('never lists another tenant tank', async () => {
    await seedTenantA();
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantB),
    });
    expect(response.json().tanks).toEqual([]);
  });

  it('refuses readings submitted to another tenant tank', async () => {
    const { tankId } = await seedTenantA();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantB),
      payload: readingPayload(),
    });
    expect(response.statusCode).toBe(404);
    // The rejected submission must not write anything, for either tenant.
    expect(await harness.deps.repositories.readings.latest(TENANT_A, tankId as never)).toBeNull();
    expect(
      await harness.deps.repositories.readings.list(TENANT_B, { tankId: tankId as never }),
    ).toEqual([]);
  });

  it('refuses to read another tenant reading history', async () => {
    const { tankId } = await seedTenantA();
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload(),
    });
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantB),
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses to acknowledge another tenant alarm', async () => {
    const { tankId } = await seedTenantA();
    const ingest = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 600 }),
    });
    const alarm = ingest.json().alarmsRaised[0];
    expect(alarm).toBeDefined();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/alarms/${alarm.id}/acknowledge`,
      headers: bearer(harness.keyForTenantB),
      payload: { note: 'not mine' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('keeps alarm lists scoped to the calling tenant', async () => {
    const { tankId } = await seedTenantA();
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 600 }),
    });

    const forA = await harness.app.inject({
      method: 'GET',
      url: '/v1/alarms?status=open',
      headers: bearer(harness.keyForTenantA),
    });
    const forB = await harness.app.inject({
      method: 'GET',
      url: '/v1/alarms?status=open',
      headers: bearer(harness.keyForTenantB),
    });

    expect(forA.json().alarms.length).toBeGreaterThan(0);
    expect(forB.json().alarms).toEqual([]);
  });
});

describe('reading ingest', () => {
  it('stores a reading and returns the computed volumes', async () => {
    const { tankId } = await seedTenantA();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload(),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.reading.quality).toBe('ok');
    expect(body.reading.grossVolumeLitres).toBeGreaterThan(body.reading.netVolumeLitres);
  });

  it('rejects a reading that reports more water than product', async () => {
    const { tankId } = await seedTenantA();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 100, waterLevelMm: 900 }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed timestamp', async () => {
    const { tankId } = await seedTenantA();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ observedAt: 'yesterday' }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('raises exactly one alarm per condition across repeated readings', async () => {
    const { tankId } = await seedTenantA();
    const first = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 600 }),
    });
    expect(first.json().alarmsRaised.length).toBeGreaterThan(0);

    const second = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 599, observedAt: '2026-01-01T00:05:00.000Z' }),
    });
    expect(second.json().alarmsRaised).toEqual([]);
  });

  it('applies query filters and the page limit', async () => {
    const { tankId } = await seedTenantA();
    for (let index = 0; index < 3; index += 1) {
      await harness.app.inject({
        method: 'POST',
        url: `/v1/tanks/${tankId}/readings`,
        headers: bearer(harness.keyForTenantA),
        payload: readingPayload({
          observedAt: `2026-01-01T00:0${index}:00.000Z`,
          levelMm: 2000 + index,
        }),
      });
    }
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tankId}/readings?limit=2`,
      headers: bearer(harness.keyForTenantA),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().readings).toHaveLength(2);

    const invalid = await harness.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tankId}/readings?limit=9999`,
      headers: bearer(harness.keyForTenantA),
    });
    expect(invalid.statusCode).toBe(400);
  });
});

describe('reading ingestion idempotency', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createHarness();
    await harness.app.inject({
      method: 'POST',
      url: '/v1/sites',
      headers: bearer(harness.keyForTenantA),
      payload: SITE_PAYLOAD,
    });
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantA),
      payload: TANK_PAYLOAD,
    });
    tankId = (created.json() as { tank: { id: string } }).tank.id;
  });

  afterEach(async () => {
    await harness.close();
  });

  let tankId = '';

  async function submit(payload: Record<string, unknown>, key = harness.keyForTenantA) {
    return harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(key),
      payload,
    });
  }

  it('returns 200 with the original reading when a device retries an upload', async () => {
    const payload = readingPayload({ deviceId: 'probe-1' });
    const first = await submit(payload);
    const retry = await submit(payload);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    expect(retry.json().reading.id).toBe(first.json().reading.id);

    const listed = await harness.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tankId}/readings?limit=50`,
      headers: bearer(harness.keyForTenantA),
    });
    expect(listed.json().readings).toHaveLength(1);
  });

  it('creates a new reading when the observation time differs', async () => {
    const first = await submit(readingPayload({ observedAt: '2026-01-01T00:00:00.000Z' }));
    const second = await submit(readingPayload({ observedAt: '2026-01-01T00:05:00.000Z' }));

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().reading.id).not.toBe(first.json().reading.id);
  });

  it('accepts and honours a client supplied idempotency key', async () => {
    const first = await submit(readingPayload({ idempotencyKey: 'probe-1:000931' }));
    const retry = await submit(
      readingPayload({ idempotencyKey: 'probe-1:000931', observedAt: '2026-01-01T00:07:00.000Z' }),
    );

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().reading.idempotencyKey).toBe('probe-1:000931');
  });

  it('does not let another tenant reuse a submission key', async () => {
    const payload = readingPayload();
    const first = await submit(payload);
    const otherTenant = await submit(payload, harness.keyForTenantB);

    // Tenant B has no tank with this id, so the upload is rejected as unknown
    // rather than collapsing onto tenant A's reading.
    expect(first.statusCode).toBe(201);
    expect(otherTenant.statusCode).toBe(404);
  });

  it('rejects a malformed idempotency key', async () => {
    const response = await submit(readingPayload({ idempotencyKey: 'bad key' }));
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('validation_failed');
  });
});
