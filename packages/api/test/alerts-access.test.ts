import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  createMemoryLogSink,
  createSilentLogger,
  manualClock,
  toTenantId,
  type MemoryLogSink,
} from '@fueltrack/core';
import { buildServer } from '../src/server.js';
import { createPlatformDependencies } from '../src/dependency-factory.js';
import { CONSOLE_REQUESTS } from '../../../apps/web/src/lib/api.js';
import {
  bearer,
  createHarness,
  readingPayload,
  seedTenant,
  TENANT_A,
  type TestHarness,
} from './helpers.js';

/**
 * GET /v1/alerts access control.
 *
 * Regression for "The API rejected the request without a message [GET
 * /v1/alerts status 403]". Keys issued before the stations/alerts rename were
 * stored with `alarms:read`. They authenticated and could read tanks, but the
 * alerts route checks `alerts:read`, so every console connect ended in a bare
 * 403 with no message. These tests pin both halves of the fix: legacy keys are
 * authorized for exactly what they were granted, and a genuine permission
 * failure says which scope is missing.
 */

/** The scope set every key held before the rename (commit 928c865). */
const LEGACY_SCOPES = [
  'readings:read',
  'readings:write',
  'tanks:read',
  'tanks:write',
  'sites:read',
  'sites:write',
  'alarms:read',
  'alarms:write',
  'simulator:write',
];

const ALERTS_URL = CONSOLE_REQUESTS.alerts;

async function raiseCriticalAlert(harness: TestHarness, tankId: string, key: string) {
  // 100 mm of a 4000 mm tank is far below the critical threshold, so the
  // rules engine raises a critical stock alert on ingest.
  const response = await harness.app.inject({
    method: 'POST',
    url: `/v1/tanks/${tankId}/readings`,
    headers: bearer(key),
    payload: readingPayload({ levelMm: 100 }),
  });
  expect(response.statusCode).toBe(201);
}

describe('GET /v1/alerts authorization', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('serves a key that still carries the pre-rename alarms:read scope', async () => {
    const legacy = await harness.deps.issueApiKey({
      tenantId: TENANT_A,
      name: 'legacy-console',
      scopes: LEGACY_SCOPES,
    });

    const tanks = await harness.app.inject({
      method: 'GET',
      url: CONSOLE_REQUESTS.tanks,
      headers: bearer(legacy.secret),
    });
    expect(tanks.statusCode).toBe(200);

    const alerts = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: bearer(legacy.secret),
    });
    expect(alerts.statusCode).toBe(200);
    expect(alerts.json()).toEqual({ alerts: [] });
  });

  it('lets a legacy key write alerts and stations it was granted, and nothing newer', async () => {
    const legacy = await harness.deps.issueApiKey({
      tenantId: TENANT_A,
      name: 'legacy-console',
      scopes: LEGACY_SCOPES,
    });
    const { tankId } = await seedTenant(harness, legacy.secret);
    await raiseCriticalAlert(harness, tankId, legacy.secret);

    const list = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: bearer(legacy.secret),
    });
    const alertId = (list.json() as { alerts: Array<{ id: string }> }).alerts[0]?.id;
    expect(alertId).toBeDefined();

    // alarms:write -> alerts:write
    const acknowledged = await harness.app.inject({
      method: 'POST',
      url: `/v1/alerts/${alertId}/acknowledge`,
      headers: bearer(legacy.secret),
      payload: {},
    });
    expect(acknowledged.statusCode).toBe(200);

    // sites:read -> stations:read
    const stations = await harness.app.inject({
      method: 'GET',
      url: '/v1/stations',
      headers: bearer(legacy.secret),
    });
    expect(stations.statusCode).toBe(200);

    // The rename must never widen a key: audit:read did not exist when the
    // legacy key was issued, so it is still refused.
    const audit = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit-logs',
      headers: bearer(legacy.secret),
    });
    expect(audit.statusCode).toBe(403);
    expect(audit.json()).toMatchObject({
      error: 'forbidden',
      reason: 'insufficient_scope',
      requiredScopes: ['audit:read'],
    });
  });

  it('explains a genuine missing scope instead of a bare 403', async () => {
    const tanksOnly = await harness.deps.issueApiKey({
      tenantId: TENANT_A,
      name: 'tanks-only',
      scopes: ['tanks:read', 'readings:read'],
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: bearer(tanksOnly.secret),
    });

    expect(response.statusCode).toBe(403);
    const body = response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      error: 'forbidden',
      reason: 'insufficient_scope',
      requiredScopes: ['alerts:read'],
      requestId: expect.any(String),
    });
    expect(String(body['message'])).toContain('alerts:read');
    expect(response.headers['www-authenticate']).toBe(
      'Bearer realm="fueltrack", error="insufficient_scope", scope="alerts:read"',
    );
    // Nothing about the credential or tenant is echoed back.
    expect(response.body).not.toContain(tanksOnly.secret);
    expect(response.body).not.toContain(TENANT_A);
  });

  it('answers 401, not 403, when no credential is sent', async () => {
    const response = await harness.app.inject({ method: 'GET', url: ALERTS_URL });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('answers 401 for an unknown or malformed key', async () => {
    const unknown = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: bearer('ftk_key-does-not-exist_secret'),
    });
    expect(unknown.statusCode).toBe(401);

    const wrongScheme = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: { authorization: `Basic ${harness.keyForTenantA}` },
    });
    expect(wrongScheme.statusCode).toBe(401);
  });

  it('answers 401 for a revoked key', async () => {
    const issued = await harness.deps.issueApiKey({
      tenantId: TENANT_A,
      name: 'to-revoke',
      scopes: ['alerts:read'],
    });
    await harness.deps.apiKeys.revoke(TENANT_A, issued.record.id);

    const response = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: bearer(issued.secret),
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns an empty list with 200 for a tenant that has no alerts', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: bearer(harness.keyForTenantA),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ alerts: [] });
  });

  it('returns every open alert with consistent status and severity fields', async () => {
    const { tankId } = await seedTenant(harness);
    await raiseCriticalAlert(harness, tankId, harness.keyForTenantA);
    // Water above the alarm threshold raises a second, independent alert.
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({
        levelMm: 100,
        waterLevelMm: 80,
        observedAt: '2026-01-01T00:01:00.000Z',
      }),
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: bearer(harness.keyForTenantA),
    });
    expect(response.statusCode).toBe(200);
    const alerts = (response.json() as { alerts: Array<Record<string, unknown>> }).alerts;
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    for (const alert of alerts) {
      expect(alert['status']).toBe('open');
      expect(['info', 'warning', 'critical']).toContain(alert['severity']);
      expect(alert['tankId']).toBe(tankId);
    }
  });

  it('never returns another tenant alerts, even for a legacy key', async () => {
    const { tankId } = await seedTenant(harness);
    await raiseCriticalAlert(harness, tankId, harness.keyForTenantA);

    const otherTenant = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: bearer(harness.keyForTenantB),
    });
    expect(otherTenant.statusCode).toBe(200);
    expect(otherTenant.json()).toEqual({ alerts: [] });

    const legacyB = await harness.deps.issueApiKey({
      tenantId: toTenantId('tenant-b'),
      name: 'legacy-b',
      scopes: LEGACY_SCOPES,
    });
    const legacyView = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: bearer(legacyB.secret),
    });
    expect(legacyView.json()).toEqual({ alerts: [] });

    // Tenant headers are ignored: the tenant comes only from the key.
    const spoofed = await harness.app.inject({
      method: 'GET',
      url: ALERTS_URL,
      headers: { ...bearer(harness.keyForTenantB), 'x-tenant-id': TENANT_A },
    });
    expect(spoofed.json()).toEqual({ alerts: [] });
  });

  it('keeps filter validation errors as 400 with issues', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/alerts?status=bogus',
      headers: bearer(harness.keyForTenantA),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_failed' });
  });
});

describe('expired credentials', () => {
  it('answers 401 once a key passes its expiry', async () => {
    const clock = manualClock('2026-01-01T00:00:00.000Z');
    const deps = createPlatformDependencies({ clock, logger: createSilentLogger() });
    const app = await buildServer(deps, { alertSweepIntervalMs: 0 });
    try {
      const issued = await deps.issueApiKey({
        tenantId: TENANT_A,
        name: 'short-lived',
        scopes: ['alerts:read'],
      });
      await deps.apiKeys.save({ ...issued.record, expiresAt: '2026-01-01T01:00:00.000Z' });

      const before = await app.inject({
        method: 'GET',
        url: ALERTS_URL,
        headers: bearer(issued.secret),
      });
      expect(before.statusCode).toBe(200);

      clock.advanceMilliseconds(2 * 60 * 60 * 1000);
      const after = await app.inject({
        method: 'GET',
        url: ALERTS_URL,
        headers: bearer(issued.secret),
      });
      expect(after.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('legacy scope diagnostics', () => {
  let sink: MemoryLogSink;

  it('logs the key id once, never the key, when a legacy key is used', async () => {
    sink = createMemoryLogSink();
    const deps = createPlatformDependencies({
      clock: manualClock('2026-01-01T00:00:00.000Z'),
      logger: createLogger({ sink }),
    });
    const app = await buildServer(deps, { alertSweepIntervalMs: 0 });
    try {
      const legacy = await deps.issueApiKey({
        tenantId: TENANT_A,
        name: 'legacy',
        scopes: LEGACY_SCOPES,
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await app.inject({ method: 'GET', url: ALERTS_URL, headers: bearer(legacy.secret) });
      }

      const warnings = sink.records.filter((record) => record.message === 'auth.legacy_scopes');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.context).toMatchObject({
        keyId: legacy.record.id,
        legacyScopes: ['sites:read', 'sites:write', 'alarms:read', 'alarms:write'],
      });
      expect(JSON.stringify(sink.records)).not.toContain(legacy.secret);
    } finally {
      await app.close();
    }
  });

  it('logs a refused scope with the key id and never the key', async () => {
    sink = createMemoryLogSink();
    const deps = createPlatformDependencies({
      clock: manualClock('2026-01-01T00:00:00.000Z'),
      logger: createLogger({ sink }),
    });
    const app = await buildServer(deps, { alertSweepIntervalMs: 0 });
    try {
      const narrow = await deps.issueApiKey({
        tenantId: TENANT_A,
        name: 'narrow',
        scopes: ['tanks:read'],
      });
      await app.inject({ method: 'GET', url: ALERTS_URL, headers: bearer(narrow.secret) });

      const refused = sink.records.find((record) => record.message === 'auth.forbidden');
      expect(refused?.context).toMatchObject({
        reason: 'insufficient_scope',
        requiredScopes: ['alerts:read'],
        keyId: narrow.record.id,
      });
      expect(JSON.stringify(sink.records)).not.toContain(narrow.secret);
    } finally {
      await app.close();
    }
  });
});
