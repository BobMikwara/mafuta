import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManualClock } from '@fueltrack/core';
import {
  bearer,
  createHarness,
  DEVICE_SCOPES,
  readingPayload,
  seedTenant,
  TENANT_A,
  type SeededTenant,
  type TestHarness,
} from './helpers.js';

/**
 * End-to-end coverage of every v1 route group against the in-memory adapters.
 *
 * These tests treat the HTTP layer as the contract: status codes, response
 * shapes and the tenant scoping of each endpoint.
 */

let harness: TestHarness;
let seeded: SeededTenant;

beforeEach(async () => {
  harness = await createHarness();
  seeded = await seedTenant(harness);
});

afterEach(async () => {
  await harness.close();
});

function clock(): ManualClock {
  return harness.deps.clock as ManualClock;
}

const DEVICE_PAYLOAD = {
  id: 'dev-1',
  manufacturer: 'Acme',
  model: 'Probe 3000',
  serialNumber: 'SN-0001',
  protocol: 'http',
};

describe('alert routes', () => {
  it('lists, reads, acknowledges, resolves and assigns an alert', async () => {
    const ingest = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 600 }),
    });
    const alertId = (ingest.json().alertsRaised[0] as { id: string }).id;

    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/alerts?status=open',
      headers: bearer(harness.keyForTenantA),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().alerts.map((alert: { id: string }) => alert.id)).toContain(alertId);

    const detail = await harness.app.inject({
      method: 'GET',
      url: `/v1/alerts/${alertId}`,
      headers: bearer(harness.keyForTenantA),
    });
    expect(detail.json().alert.type).toBe('low_stock');

    const acknowledged = await harness.app.inject({
      method: 'POST',
      url: `/v1/alerts/${alertId}/acknowledge`,
      headers: bearer(harness.keyForTenantA),
      payload: { note: 'operator has seen it' },
    });
    expect(acknowledged.statusCode).toBe(200);
    expect(acknowledged.json().alert).toMatchObject({ status: 'acknowledged' });
    // The actor is the credential, never a tenant-supplied value.
    expect(acknowledged.json().alert.acknowledgedBy).toMatch(/^key:key-/);

    const assigned = await harness.app.inject({
      method: 'POST',
      url: `/v1/alerts/${alertId}/assign`,
      headers: bearer(harness.keyForTenantA),
      payload: { assignee: 'shift-lead' },
    });
    expect(assigned.json().alert.assignedTo).toBe('shift-lead');

    const resolved = await harness.app.inject({
      method: 'POST',
      url: `/v1/alerts/${alertId}/resolve`,
      headers: bearer(harness.keyForTenantA),
      payload: { note: 'refilled' },
    });
    expect(resolved.json().alert.status).toBe('resolved');

    const open = await harness.app.inject({
      method: 'GET',
      url: '/v1/alerts?status=open',
      headers: bearer(harness.keyForTenantA),
    });
    expect(open.json().alerts).toEqual([]);
  });

  it('records an audit trail for alert decisions', async () => {
    const ingest = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ levelMm: 600 }),
    });
    const alertId = (ingest.json().alertsRaised[0] as { id: string }).id;
    await harness.app.inject({
      method: 'POST',
      url: `/v1/alerts/${alertId}/acknowledge`,
      headers: bearer(harness.keyForTenantA),
      payload: {},
    });

    const audit = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit-logs?action=alert.acknowledged',
      headers: bearer(harness.keyForTenantA),
    });
    expect(audit.json().auditLogs).toHaveLength(1);
    expect(audit.json().auditLogs[0].resourceId).toBe(alertId);
  });

  it('rejects an unknown alert and a write attempted with a read only credential', async () => {
    const missing = await harness.app.inject({
      method: 'POST',
      url: '/v1/alerts/alt-missing/acknowledge',
      headers: bearer(harness.keyForTenantA),
      payload: {},
    });
    expect(missing.statusCode).toBe(404);

    const readOnly = await harness.app.inject({
      method: 'POST',
      url: '/v1/alerts/alt-missing/acknowledge',
      headers: bearer(harness.keyForTenantAReadonly),
      payload: {},
    });
    expect(readOnly.statusCode).toBe(403);
  });

  it('evaluates rules for the calling tenant on demand', async () => {
    // The tank reports at the frozen clock instant, then a person asks for an
    // evaluation two hours later without a new reading having arrived.
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload(),
    });
    clock().advanceMilliseconds(90 * 60_000);

    const sweep = await harness.app.inject({
      method: 'POST',
      url: '/v1/alerts/evaluate',
      headers: bearer(harness.keyForTenantA),
    });
    expect(sweep.statusCode).toBe(200);
    expect(sweep.json().sweep).toMatchObject({ tanksEvaluated: 1, failingTanks: 0 });
    expect(sweep.json().sweep.alertsRaised).toBeGreaterThan(0);

    const stale = await harness.app.inject({
      method: 'GET',
      url: '/v1/alerts?status=open&type=stale_data',
      headers: bearer(harness.keyForTenantA),
    });
    expect(stale.json().alerts).toHaveLength(1);
  });
});

describe('device routes', () => {
  it('registers, lists, reads and updates a device', async () => {
    const registered = await harness.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
      payload: DEVICE_PAYLOAD,
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json().device).toMatchObject({
      id: 'dev-1',
      protocol: 'http',
      status: 'registered',
    });

    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
    });
    expect(list.json().devices).toHaveLength(1);
    expect(list.json().devices[0]).toMatchObject({ online: false, tankId: null });

    const detail = await harness.app.inject({
      method: 'GET',
      url: '/v1/devices/dev-1',
      headers: bearer(harness.keyForTenantA),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ rawMessageCount: 0, assignmentHistory: [] });

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/v1/devices/dev-1',
      headers: bearer(harness.keyForTenantA),
      payload: { firmwareVersion: '1.5.0', status: 'active' },
    });
    expect(updated.json().device).toMatchObject({ firmwareVersion: '1.5.0', status: 'active' });
  });

  it('refuses a duplicate serial number with a conflict', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
      payload: DEVICE_PAYLOAD,
    });
    const duplicate = await harness.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
      payload: { ...DEVICE_PAYLOAD, id: 'dev-2' },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('assigns a device to a tank, shadows the assignment in the view and unassigns it', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
      payload: DEVICE_PAYLOAD,
    });

    const assigned = await harness.app.inject({
      method: 'POST',
      url: '/v1/devices/dev-1/assign',
      headers: bearer(harness.keyForTenantA),
      payload: { tankId: seeded.tankId },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().assignment).toMatchObject({ tankId: 'tank-1', status: 'active' });

    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
    });
    expect(list.json().devices[0]).toMatchObject({
      tankId: 'tank-1',
      tankName: 'Diesel Tank 1',
      stationName: 'Nairobi Depot',
    });

    const unassigned = await harness.app.inject({
      method: 'POST',
      url: '/v1/devices/dev-1/unassign',
      headers: bearer(harness.keyForTenantA),
    });
    expect(unassigned.json().assignment.status).toBe('ended');

    const again = await harness.app.inject({
      method: 'POST',
      url: '/v1/devices/dev-1/unassign',
      headers: bearer(harness.keyForTenantA),
    });
    expect(again.statusCode).toBe(404);
  });

  it('refuses to assign a device to another tenant tank', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
      payload: DEVICE_PAYLOAD,
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/devices/dev-1/assign',
      headers: bearer(harness.keyForTenantB),
      payload: { tankId: seeded.tankId },
    });
    expect(response.statusCode).toBe(404);
  });

  it('gates retained raw payloads behind the raw scope and audits the read', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
      payload: { ...DEVICE_PAYLOAD, protocol: 'simulated' },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/v1/devices/dev-1/assign',
      headers: bearer(harness.keyForTenantA),
      payload: { tankId: seeded.tankId },
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ source: 'device', deviceId: 'dev-1' }),
    });

    const withoutRawScope = await harness.app.inject({
      method: 'GET',
      url: '/v1/devices/dev-1/raw-messages',
      headers: bearer(harness.keyForTenantAReadonly),
    });
    expect(withoutRawScope.statusCode).toBe(403);

    const withRawScope = await harness.app.inject({
      method: 'GET',
      url: '/v1/devices/dev-1/raw-messages',
      headers: bearer(harness.keyForTenantA),
    });
    expect(withRawScope.statusCode).toBe(200);
    expect(withRawScope.json().rawMessages).toHaveLength(1);
    expect(withRawScope.json().rawMessages[0].payload).toMatchObject({ levelMm: 2000 });

    const audit = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit-logs?action=reading.raw_payload_read',
      headers: bearer(harness.keyForTenantA),
    });
    expect(audit.json().auditLogs).toHaveLength(1);
  });

  it('rejects a hardware reading from a device that is not assigned to the tank', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
      payload: DEVICE_PAYLOAD,
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ source: 'device', deviceId: 'dev-1' }),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('event and delivery routes', () => {
  /** Drives the tank through a sustained rise so a candidate delivery exists. */
  async function seedCandidateDelivery(): Promise<string> {
    clock().advanceMilliseconds(30 * 60_000);
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ observedAt: '2026-01-01T00:00:00.000Z', levelMm: 500 }),
    });
    const rise = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ observedAt: '2026-01-01T00:20:00.000Z', levelMm: 1500 }),
    });
    const events = rise.json().eventsRaised as Array<{ id: string; type: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('candidate_delivery');
    return (events[0] as { id: string }).id;
  }

  it('records a candidate delivery as an investigation, never as an accusation', async () => {
    const eventId = await seedCandidateDelivery();

    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/events?status=candidate',
      headers: bearer(harness.keyForTenantA),
    });
    expect(list.statusCode).toBe(200);
    const event = list.json().events[0];
    expect(event.event.type).toBe('candidate_delivery');
    expect(event.event.evidence.investigationRequired).toBe(true);
    expect(JSON.stringify(event)).not.toMatch(/theft|stolen/i);

    const detail = await harness.app.inject({
      method: 'GET',
      url: `/v1/events/${eventId}`,
      headers: bearer(harness.keyForTenantA),
    });
    expect(detail.json().event.tankName).toBe('Diesel Tank 1');
    expect(detail.json().event.volumeChangeLitres).toBeGreaterThan(0);

    // A candidate delivery is also visible in the alert list, so an operator
    // watching alerts is not the last to know.
    const alerts = await harness.app.inject({
      method: 'GET',
      url: '/v1/alerts?type=candidate_delivery',
      headers: bearer(harness.keyForTenantA),
    });
    expect(alerts.json().alerts).toHaveLength(1);
  });

  it('confirms a candidate into a recorded delivery with a variance', async () => {
    const eventId = await seedCandidateDelivery();

    const confirmed = await harness.app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/confirm`,
      headers: bearer(harness.keyForTenantA),
      payload: { reference: 'DN-2026-001', supplier: 'Depot 1', recordedVolumeLitres: 4800 },
    });
    expect(confirmed.statusCode).toBe(200);
    const body = confirmed.json();
    expect(body.event.status).toBe('confirmed');
    expect(body.delivery).toMatchObject({
      reference: 'DN-2026-001',
      supplier: 'Depot 1',
      recordedVolumeMl: 4_800_000,
      fuelEventId: eventId,
    });
    // Recorded minus measured, in millilitres. A negative number means more
    // fuel arrived than the docket stated, and the response says so without
    // deciding what that means.
    expect(body.varianceMl).toBeLessThan(0);
    expect(Math.abs(body.varianceMl)).toBeLessThan(200_000);

    const deliveries = await harness.app.inject({
      method: 'GET',
      url: '/v1/deliveries',
      headers: bearer(harness.keyForTenantA),
    });
    expect(deliveries.json().deliveries).toHaveLength(1);
    expect(deliveries.json().deliveries[0]).toMatchObject({
      delivery: { fuelEventId: eventId, reference: 'DN-2026-001' },
      tankName: 'Diesel Tank 1',
      stationName: 'Nairobi Depot',
      product: 'diesel',
    });

    // The candidate alert resolves once the movement has been explained.
    await harness.app.inject({
      method: 'POST',
      url: '/v1/alerts/evaluate',
      headers: bearer(harness.keyForTenantA),
    });
    const refreshed = await harness.app.inject({
      method: 'GET',
      url: '/v1/alerts?status=open&type=candidate_delivery',
      headers: bearer(harness.keyForTenantA),
    });
    expect(refreshed.json().alerts).toEqual([]);
  });

  it('refuses to confirm the same candidate twice', async () => {
    const eventId = await seedCandidateDelivery();
    await harness.app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/confirm`,
      headers: bearer(harness.keyForTenantA),
      payload: {},
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/confirm`,
      headers: bearer(harness.keyForTenantA),
      payload: {},
    });
    expect(second.statusCode).toBe(409);
  });

  it('rejects a candidate with a note and keeps the record', async () => {
    const eventId = await seedCandidateDelivery();

    const withoutNote = await harness.app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/reject`,
      headers: bearer(harness.keyForTenantA),
      payload: {},
    });
    expect(withoutNote.statusCode).toBe(400);

    const rejected = await harness.app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/reject`,
      headers: bearer(harness.keyForTenantA),
      payload: { note: 'transfer from tank 2 was logged on paper' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().event).toMatchObject({ status: 'rejected' });
    expect(rejected.json().event.notes).toContain('transfer from tank 2');

    const audit = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit-logs?action=event.rejected',
      headers: bearer(harness.keyForTenantA),
    });
    expect(audit.json().auditLogs).toHaveLength(1);
  });

  it('keeps events isolated between tenants', async () => {
    await seedCandidateDelivery();
    const forB = await harness.app.inject({
      method: 'GET',
      url: '/v1/events',
      headers: bearer(harness.keyForTenantB),
    });
    expect(forB.json().events).toEqual([]);
  });
});

describe('dashboard, report and audit routes', () => {
  it('summarises the fleet in one request', async () => {
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload(),
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/dashboard/summary',
      headers: bearer(harness.keyForTenantA),
    });
    expect(response.statusCode).toBe(200);
    const summary = response.json();
    expect(summary.counts).toMatchObject({ stations: 1, tanks: 1, readingsLast24h: 1 });
    expect(summary.stock.netVolumeMl).toBeGreaterThan(0);
    expect(summary.products[0]).toMatchObject({ product: 'diesel', tankCount: 1 });
    expect(summary.stations[0].station.name).toBe('Nairobi Depot');
  });

  it('returns every report as a table with its formula stated', async () => {
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload(),
    });

    for (const report of [
      'inventory',
      'stock-movement',
      'deliveries',
      'device-health',
      'alerts',
      'reconciliation',
    ]) {
      const response = await harness.app.inject({
        method: 'GET',
        url: `/v1/reports/${report}`,
        headers: bearer(harness.keyForTenantA),
      });
      expect(response.statusCode, report).toBe(200);
      const table = response.json();
      expect(table.report).toBe(report);
      expect(table.columns.length).toBeGreaterThan(0);
      expect(table.notes.length).toBeGreaterThan(0);
      // No row ever asserts a cause: the reports describe movements, and the
      // explicit disclaimer is the only place the word may appear.
      expect(JSON.stringify(table.rows)).not.toMatch(/theft|stolen/i);
    }

    const reconciliation = await harness.app.inject({
      method: 'GET',
      url: '/v1/reports/reconciliation',
      headers: bearer(harness.keyForTenantA),
    });
    expect(reconciliation.json().notes.join(' ')).toMatch(/not conclusions|never classified/i);

    const unknown = await harness.app.inject({
      method: 'GET',
      url: '/v1/reports/profit-and-loss',
      headers: bearer(harness.keyForTenantA),
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('exports a report as csv and audits the download', async () => {
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload(),
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/reports/inventory?format=csv',
      headers: bearer(harness.keyForTenantA),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('inventory-');
    const csv = response.body;
    expect(csv.split('\n')[0]).toContain('Tank');
    expect(csv).toContain('Diesel Tank 1');
    expect(csv).toContain('note: ');

    const audit = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit-logs?action=export.downloaded',
      headers: bearer(harness.keyForTenantA),
    });
    expect(audit.json().auditLogs).toHaveLength(1);
  });

  it('scopes the audit trail to the calling tenant and its own actions', async () => {
    const unaudited = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit-logs',
      headers: bearer(harness.keyForTenantAReadonly),
    });
    expect(unaudited.statusCode).toBe(403);

    const forA = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit-logs',
      headers: bearer(harness.keyForTenantA),
    });
    const forB = await harness.app.inject({
      method: 'GET',
      url: '/v1/audit-logs',
      headers: bearer(harness.keyForTenantB),
    });

    // Seeding wrote a station and a tank for tenant A only.
    expect(forA.json().auditLogs.map((entry: { action: string }) => entry.action)).toEqual(
      expect.arrayContaining(['station.created', 'tank.created']),
    );
    expect(forB.json().auditLogs).toEqual([]);
  });

  it('does not leak tenant data through the dashboard or reports', async () => {
    await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload(),
    });

    const dashboard = await harness.app.inject({
      method: 'GET',
      url: '/v1/dashboard/summary',
      headers: bearer(harness.keyForTenantB),
    });
    expect(dashboard.json().counts).toMatchObject({ tanks: 0, readingsLast24h: 0 });

    const report = await harness.app.inject({
      method: 'GET',
      url: '/v1/reports/inventory',
      headers: bearer(harness.keyForTenantB),
    });
    expect(report.json().rows).toEqual([]);
  });
});

describe('simulator reporting through the api', () => {
  it('accepts a simulated reading and registers the synthetic device', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(harness.keyForTenantA),
      payload: readingPayload({ source: 'simulated', deviceId: 'sim-tank-1' }),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().reading.source).toBe('simulated');

    const devices = await harness.app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
    });
    // Synthetic data is labelled as such at the device level, so a reading can
    // never be mistaken for hardware output after the fact.
    expect(devices.json().devices[0]).toMatchObject({
      device: { id: 'sim-tank-1', protocol: 'simulated' },
      tankId: 'tank-1',
    });
  });

  it('lets a device credential submit device readings but nothing else', async () => {
    const deviceKey = await harness.deps.issueApiKey({
      tenantId: TENANT_A,
      name: 'probe-1',
      scopes: [...DEVICE_SCOPES],
    });
    await harness.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: bearer(harness.keyForTenantA),
      payload: DEVICE_PAYLOAD,
    });
    await harness.app.inject({
      method: 'POST',
      url: '/v1/devices/dev-1/assign',
      headers: bearer(harness.keyForTenantA),
      payload: { tankId: seeded.tankId },
    });

    const reading = await harness.app.inject({
      method: 'POST',
      url: `/v1/tanks/${seeded.tankId}/readings`,
      headers: bearer(deviceKey.secret),
      payload: readingPayload({ source: 'device', deviceId: 'dev-1' }),
    });
    expect(reading.statusCode).toBe(201);
    expect(reading.json().scopes).toContain('readings:write');
    expect(reading.json().scopes).not.toContain('devices:write');

    const denied = await harness.app.inject({
      method: 'GET',
      url: '/v1/devices',
      headers: bearer(deviceKey.secret),
    });
    expect(denied.statusCode).toBe(403);
  });
});
