import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bearer,
  createHarness,
  readingPayload,
  seedTenant,
  STATION_PAYLOAD,
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
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
      payload: { ...STATION_PAYLOAD, name: 'x'.repeat(200_000) },
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
    const response = await harness.app.inject({ method: 'GET', url: '/v1/stations' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'unauthorized' });
    expect(response.headers['www-authenticate']).toContain('Bearer');
  });

  it('rejects a malformed or unknown credential', async () => {
    for (const authorization of [
      'Bearer ',
      'Basic abc',
      bearer('ftk_key-not-real_secret').authorization,
    ]) {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/v1/stations',
        headers: { authorization },
      });
      expect(response.statusCode).toBe(401);
    }
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
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantAReadonly),
      payload: STATION_PAYLOAD,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ error: 'forbidden' });

    // The same credential may read, which is what "read only" means.
    const allowed = await harness.app.inject({
      method: 'GET',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantAReadonly),
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('requires the simulator scope to submit simulated readings', async () => {
    const { tankId } = await seedTenant(harness);
    const deviceKey = await harness.deps.issueApiKey({
      tenantId: TENANT_A,
      name: 'device',
      scopes: ['readings:write', 'tanks:read'],
    });

    const denied = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(deviceKey.secret),
      payload: readingPayload({ source: 'simulated', deviceId: 'sim-tank-1' }),
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ source: 'simulated', deviceId: 'sim-tank-1' }),
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().reading.source).toBe('simulated');
  });

  it('never accepts a tenant id from the request body as the tenant', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
      payload: { ...STATION_PAYLOAD, tenantId: TENANT_B },
    });
    expect(response.statusCode).toBe(400);
    const issues = response.json().issues as Array<{ path: string }>;
    expect(issues.map((issue) => issue.path)).toContain('tenantId');
  });
});

describe('station endpoints', () => {
  it('creates and lists stations for the authenticated tenant only', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
      payload: STATION_PAYLOAD,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().station).toMatchObject({ id: 'station-1', code: 'NBO-01' });

    const forA = await harness.app.inject({
      method: 'GET',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
    });
    const forB = await harness.app.inject({
      method: 'GET',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantB),
    });

    expect(forA.json().stations).toHaveLength(1);
    expect(forB.json().stations).toHaveLength(0);
  });

  it('explains a duplicate station code instead of creating a second row', async () => {
    await seedTenant(harness);
    const duplicate = await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
      payload: { ...STATION_PAYLOAD, id: 'station-2' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: 'conflict' });
  });

  it('reads one station, rejects an unknown station and updates a station', async () => {
    const { stationId } = await seedTenant(harness);

    const read = await harness.app.inject({
      method: 'GET',
      url: `/v1/stations/${stationId}`,
      headers: bearer(harness.keyForTenantA),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().station.name).toBe('Nairobi Depot');

    const missing = await harness.app.inject({
      method: 'GET',
      url: '/v1/stations/station-does-not-exist',
      headers: bearer(harness.keyForTenantA),
    });
    expect(missing.statusCode).toBe(404);

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: `/v1/stations/${stationId}`,
      headers: bearer(harness.keyForTenantA),
      payload: { name: 'Nairobi Depot (West)', status: 'inactive' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().station).toMatchObject({
      name: 'Nairobi Depot (West)',
      status: 'inactive',
    });
  });

  it('writes an audit entry for a station change', async () => {
    await seedTenant(harness);
    const audit = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit-logs?action=station.created',
      headers: bearer(harness.keyForTenantA),
    });
    const entries = audit.json().auditLogs as Array<{ action: string; resourceId: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.resourceId).toBe('station-1');
  });
});

describe('tank endpoints', () => {
  it('creates a tank and returns summaries including its stock state', async () => {
    const { tankId } = await seedTenant(harness);
    expect(tankId).toBe('tank-1');

    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantA),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.tanks).toHaveLength(1);
    expect(body.summaries[0]).toMatchObject({
      netVolumeMl: null,
      fillPercent: null,
      dataMissingOrStale: true,
      openAlertCount: 0,
    });
  });

  it('rejects a tank whose capacity exceeds its geometry', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
      payload: STATION_PAYLOAD,
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

  it('refuses to attach a tank to a station owned by another tenant', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantA),
      payload: STATION_PAYLOAD,
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantB),
      payload: TANK_PAYLOAD,
    });
    expect(response.statusCode).toBe(404);
  });

  it('summarises a single tank and rejects an unknown one', async () => {
    const { tankId } = await seedTenant(harness);
    const summary = await harness.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tankId}`,
      headers: bearer(harness.keyForTenantA),
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().tank.id).toBe(tankId);
    expect(summary.json().station.id).toBe('station-1');

    const missing = await harness.app.inject({
      method: 'GET',
      url: '/v1/tanks/tank-unknown',
      headers: bearer(harness.keyForTenantA),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('decommissions a tank and refuses further readings for it', async () => {
    const { tankId } = await seedTenant(harness);
    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/v1/tanks/${tankId}`,
      headers: bearer(harness.keyForTenantA),
      payload: { status: 'decommissioned' },
    });
    expect(patched.statusCode).toBe(200);

    const reading = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload(),
    });
    expect(reading.statusCode).toBe(409);
  });
});

describe('tenant isolation over http', () => {
  it('returns not found when a tenant reads another tenant tank', async () => {
    const { tankId } = await seedTenant(harness);
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tankId}`,
      headers: bearer(harness.keyForTenantB),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
  });

  it('never lists another tenant tank', async () => {
    await seedTenant(harness);
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/tanks',
      headers: bearer(harness.keyForTenantB),
    });
    expect(response.json().tanks).toEqual([]);
  });

  it('refuses readings submitted to another tenant tank', async () => {
    const { tankId } = await seedTenant(harness);
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
    const { tankId } = await seedTenant(harness);
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

  it('refuses to acknowledge another tenant alert', async () => {
    const { tankId } = await seedTenant(harness);
    const ingest = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 600 }),
    });
    const alert = ingest.json().alertsRaised[0];
    expect(alert).toBeDefined();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/alerts/${alert.id}/acknowledge`,
      headers: bearer(harness.keyForTenantB),
      payload: { note: 'not mine' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('keeps alert lists scoped to the calling tenant', async () => {
    const { tankId } = await seedTenant(harness);
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 600 }),
    });

    const forA = await harness.app.inject({
      method: 'GET',
      url: '/v1/alerts?status=open',
      headers: bearer(harness.keyForTenantA),
    });
    const forB = await harness.app.inject({
      method: 'GET',
      url: '/v1/alerts?status=open',
      headers: bearer(harness.keyForTenantB),
    });

    expect(forA.json().alerts.length).toBeGreaterThan(0);
    expect(forB.json().alerts).toEqual([]);
  });
});

describe('reading ingest', () => {
  it('stores a reading and returns the computed volumes', async () => {
    const { tankId } = await seedTenant(harness);
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload(),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.reading.quality).toBe('ok');
    expect(body.reading.provenance).toBe('manual');
    expect(body.reading.grossVolumeLitres).toBeGreaterThan(body.reading.netVolumeLitres);
    expect(body.duplicate).toBe(false);
  });

  it('rejects a reading that reports more water than product', async () => {
    const { tankId } = await seedTenant(harness);
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 100, waterLevelMm: 900 }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed timestamp and a timestamp far in the future', async () => {
    const { tankId } = await seedTenant(harness);
    const malformed = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ observedAt: 'yesterday' }),
    });
    expect(malformed.statusCode).toBe(400);

    const future = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ observedAt: '2026-06-01T00:00:00.000Z' }),
    });
    expect(future.statusCode).toBe(400);
    const issues = future.json().issues as Array<{ path: string; message: string }>;
    expect(issues[0]?.path).toBe('observedAt');
    expect(issues[0]?.message).toContain('ahead of server time');
  });

  it('raises exactly one alert per condition across repeated readings', async () => {
    const { tankId } = await seedTenant(harness);
    const first = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 600 }),
    });
    expect(first.json().alertsRaised.length).toBeGreaterThan(0);

    const second = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 599, observedAt: '2026-01-01T00:05:00.000Z' }),
    });
    expect(second.json().alertsRaised).toEqual([]);
  });

  it('lists readings with a page limit and rejects an oversized page', async () => {
    const { tankId } = await seedTenant(harness);
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

  it('returns a bucketed series for charts', async () => {
    const { tankId } = await seedTenant(harness);
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload(),
    });
    const series = await harness.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tankId}/series?hours=24&buckets=12`,
      headers: bearer(harness.keyForTenantA),
    });
    expect(series.statusCode).toBe(200);
    expect(series.json().series.buckets).toHaveLength(12);
  });
});

describe('reading ingestion idempotency', () => {
  let scoped: TestHarness;
  let tankId = '';

  beforeEach(async () => {
    scoped = await createHarness();
    const seeded = await seedTenant(scoped);
    tankId = seeded.tankId;
  });

  afterEach(async () => {
    await scoped.close();
  });

  async function submit(payload: Record<string, unknown>, key = scoped.keyForTenantA) {
    return scoped.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(key),
      payload,
    });
  }

  it('returns 200 with the original reading when a device retries an upload', async () => {
    const payload = readingPayload();
    const first = await submit(payload);
    const retry = await submit(payload);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    expect(retry.json().reading.id).toBe(first.json().reading.id);

    const listed = await scoped.app.inject({
      method: 'GET',
      url: `/v1/tanks/${tankId}/readings?limit=50`,
      headers: bearer(scoped.keyForTenantA),
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
    const otherTenant = await submit(payload, scoped.keyForTenantB);

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

  it('retains the raw submitted payload for troubleshooting', async () => {
    const response = await submit(readingPayload({ deviceId: 'sim-tank-1', source: 'simulated' }));
    expect(response.statusCode).toBe(201);
    const rawMessageId = response.json().reading.rawMessageId as string | null;
    expect(rawMessageId).not.toBeNull();
  });
});
