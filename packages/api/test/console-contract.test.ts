import { describe, expect, it } from 'vitest';
import { CONSOLE_REQUESTS } from '../../../apps/web/src/lib/api.js';
import { bearer, createHarness, readingPayload, seedTenant, type TestHarness } from './helpers.js';

/**
 * The console reported "404 No route matches this request" while connecting
 * because it requested `GET /v1/alarms`, a path the v1 surface never had (the
 * resource is `/v1/alerts`). These tests replay exactly the requests the
 * console issues on connect, taken from the same `CONSOLE_REQUESTS` constant the
 * console itself uses, against a real server. A rename on either side now fails
 * here instead of at the connection panel. The response envelopes and the
 * fields the console renders are asserted too, so a shape drift (like the
 * `siteId` to `stationId` rename) cannot silently blank the UI again.
 */

const UI_FIELDS = {
  tank: ['id', 'stationId', 'name', 'product', 'capacityLitres', 'status'],
  reading: [
    'id',
    'tankId',
    'levelMm',
    'waterLevelMm',
    'netVolumeLitres',
    'grossVolumeLitres',
    'temperatureC',
    'recordedAt',
    'receivedAt',
    'source',
    'quality',
  ],
  alert: ['id', 'tankId', 'type', 'severity', 'status', 'message', 'raisedAt'],
} as const;

async function ingest(harness: TestHarness, tankId: string, payload: Record<string, unknown>) {
  return harness.app.inject({
    method: 'POST',
    url: `/v1/tanks/${tankId}/readings`,
    headers: bearer(harness.keyForTenantA),
    payload,
  });
}

describe('console request contract', () => {
  it('every request the console issues on connect reaches a real route', async () => {
    const harness = await createHarness();
    try {
      const seeded = await seedTenant(harness);
      await ingest(harness, seeded.tankId, readingPayload());

      const health = await harness.app.inject({
        method: 'GET',
        url: CONSOLE_REQUESTS.health,
      });
      expect(health.statusCode).toBe(200);

      const tanks = await harness.app.inject({
        method: 'GET',
        url: CONSOLE_REQUESTS.tanks,
        headers: bearer(harness.keyForTenantA),
      });
      expect(tanks.statusCode).toBe(200);
      const tankList = (tanks.json() as { tanks: Array<Record<string, unknown>> }).tanks;
      expect(tankList).toHaveLength(1);
      for (const field of UI_FIELDS.tank) {
        expect(tankList[0]).toHaveProperty(field);
      }

      const alerts = await harness.app.inject({
        method: 'GET',
        url: CONSOLE_REQUESTS.alerts,
        headers: bearer(harness.keyForTenantA),
      });
      expect(alerts.statusCode).toBe(200);
      expect(Array.isArray((alerts.json() as { alerts: unknown[] }).alerts)).toBe(true);

      const readings = await harness.app.inject({
        method: 'GET',
        url: CONSOLE_REQUESTS.readings(seeded.tankId),
        headers: bearer(harness.keyForTenantA),
      });
      expect(readings.statusCode).toBe(200);
      const readingList = (readings.json() as { readings: Array<Record<string, unknown>> })
        .readings;
      expect(readingList).toHaveLength(1);
      for (const field of UI_FIELDS.reading) {
        expect(readingList[0]).toHaveProperty(field);
      }
    } finally {
      await harness.close();
    }
  });

  it('delivers a raised alert in the shape the console renders', async () => {
    const harness = await createHarness();
    try {
      const seeded = await seedTenant(harness);
      // 100 mm of a 4000 mm tank is far below the critical low threshold, so
      // the rules engine raises a critical stock alert on ingest.
      const ingested = await ingest(harness, seeded.tankId, readingPayload({ levelMm: 100 }));
      expect(ingested.statusCode).toBe(201);

      const alerts = await harness.app.inject({
        method: 'GET',
        url: CONSOLE_REQUESTS.alerts,
        headers: bearer(harness.keyForTenantA),
      });
      expect(alerts.statusCode).toBe(200);
      const alertList = (alerts.json() as { alerts: Array<Record<string, unknown>> }).alerts;
      expect(alertList.length).toBeGreaterThan(0);
      for (const field of UI_FIELDS.alert) {
        expect(alertList[0]).toHaveProperty(field);
      }
    } finally {
      await harness.close();
    }
  });

  it('keeps the console flow tenant isolated', async () => {
    const harness = await createHarness();
    try {
      const seeded = await seedTenant(harness);
      await ingest(harness, seeded.tankId, readingPayload());

      const foreignTanks = await harness.app.inject({
        method: 'GET',
        url: CONSOLE_REQUESTS.tanks,
        headers: bearer(harness.keyForTenantB),
      });
      expect((foreignTanks.json() as { tanks: unknown[] }).tanks).toEqual([]);

      const foreignReadings = await harness.app.inject({
        method: 'GET',
        url: CONSOLE_REQUESTS.readings(seeded.tankId),
        headers: bearer(harness.keyForTenantB),
      });
      // A tank of another tenant is not found, never readable.
      expect(foreignReadings.statusCode).toBe(404);
      expect(foreignReadings.json()).toMatchObject({ error: 'not_found' });
    } finally {
      await harness.close();
    }
  });

  it('rejects the console requests without a credential', async () => {
    const harness = await createHarness();
    try {
      for (const url of [CONSOLE_REQUESTS.tanks, CONSOLE_REQUESTS.alerts]) {
        const response = await harness.app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toMatchObject({ error: 'unauthorized' });
      }
    } finally {
      await harness.close();
    }
  });
});
