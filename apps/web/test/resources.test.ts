import { afterEach, describe, expect, it, vi } from 'vitest';

const API_ORIGIN = 'https://api.example.test';

interface ResourcesModule {
  fetchSession(apiKey: string): Promise<{ tenantId: string }>;
  fetchStations(apiKey: string): Promise<{ stations: unknown[] }>;
  fetchStation(apiKey: string, stationId: string): Promise<{ station: { id: string } }>;
  createStation(
    apiKey: string,
    body: { name: string; code: string; timezone: string },
  ): Promise<{ station: { id: string } }>;
  updateStation(
    apiKey: string,
    stationId: string,
    body: { name: string; timezone: string; status: 'active' | 'inactive' },
  ): Promise<{ station: { name: string } }>;
  fetchTankList(
    apiKey: string,
    filters?: { stationId?: string; status?: string },
  ): Promise<{ tanks: unknown[] }>;
  fetchTank(apiKey: string, tankId: string): Promise<{ tank: { id: string } }>;
  createTank(apiKey: string, body: object): Promise<{ tank: { id: string } }>;
  updateTank(apiKey: string, tankId: string, body: object): Promise<{ tank: { name: string } }>;
  fetchDashboard(apiKey: string, stationId?: string): Promise<{ generatedAt: string }>;
  fetchSeries(apiKey: string, tankId: string): Promise<{ series: { tankId: string } }>;
  fetchReadings(apiKey: string, tankId: string): Promise<{ readings: unknown[] }>;
  recordDip(apiKey: string, tankId: string, body: object): Promise<{ duplicate: boolean }>;
  fetchDevices(apiKey: string): Promise<{ devices: unknown[] }>;
  fetchDevice(apiKey: string, deviceId: string): Promise<{ device: { device: { id: string } } }>;
  registerDevice(apiKey: string, body: object): Promise<{ device: { id: string } }>;
  assignDevice(
    apiKey: string,
    deviceId: string,
    tankId: string,
  ): Promise<{ assignment: { tankId: string } }>;
  unassignDevice(apiKey: string, deviceId: string): Promise<{ assignment: { status: string } }>;
  fetchAlerts(apiKey: string, filters?: { status?: string }): Promise<{ alerts: unknown[] }>;
  acknowledgeAlert(
    apiKey: string,
    alertId: string,
    note?: string,
  ): Promise<{ alert: { id: string } }>;
  resolveAlert(
    apiKey: string,
    alertId: string,
    note?: string,
  ): Promise<{ alert: { status: string } }>;
  assignAlert(
    apiKey: string,
    alertId: string,
    assignee: string | null,
  ): Promise<{ alert: { assignedTo: string | null } }>;
  fetchEvents(apiKey: string, status?: string): Promise<{ events: unknown[] }>;
  confirmEvent(apiKey: string, eventId: string, body: object): Promise<{ varianceMl: number }>;
  rejectEvent(apiKey: string, eventId: string, note: string): Promise<{ event: { id: string } }>;
  fetchDeliveries(apiKey: string): Promise<{ deliveries: unknown[] }>;
  fetchReport(apiKey: string, report: string): Promise<{ report: string }>;
  downloadReportCsv(apiKey: string, report: string): Promise<string>;
  fetchAudit(apiKey: string): Promise<{ auditLogs: unknown[] }>;
}

async function load(): Promise<ResourcesModule> {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', API_ORIGIN);
  return (await import('../src/lib/resources.js')) as ResourcesModule;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('console resource client', () => {
  it('calls the v1 routes the forms save through, and never puts the key in the URL', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const path = url.replace(API_ORIGIN, '');
      if (path.startsWith('/v1/reports/inventory?format=csv')) {
        return new Response('name,volume\nDiesel,1\n', {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        });
      }
      return json({
        tenantId: 'tenant-a',
        principalId: 'key:1',
        scopes: ['stations:write'],
        stations: [],
        station: { id: 'stn-1', name: 'Mlimani' },
        tanks: [],
        summaries: [],
        tank: { id: 'tnk-1', name: 'Diesel 1' },
        generatedAt: '2026-01-01T00:00:00.000Z',
        series: { tankId: 'tnk-1' },
        readings: [],
        duplicate: false,
        devices: [],
        device: { id: 'dev-1', device: { id: 'dev-1' } },
        assignment: { tankId: 'tnk-1', status: 'ended' },
        alerts: [],
        alert: { id: 'alt-1', status: 'resolved', assignedTo: 'Amina' },
        events: [],
        event: { id: 'evt-1' },
        varianceMl: 0,
        deliveries: [],
        report: 'inventory',
        auditLogs: [],
      });
    });

    const client = await load();
    const key = 'ftk_key_secret';
    await client.fetchSession(key);
    await client.fetchStations(key);
    await client.fetchStation(key, 'stn-1');
    await client.createStation(key, {
      name: 'Mlimani',
      code: 'MLM-01',
      timezone: 'Africa/Dar_es_Salaam',
    });
    await client.updateStation(key, 'stn-1', {
      name: 'Mlimani',
      timezone: 'Africa/Dar_es_Salaam',
      status: 'active',
    });
    await client.fetchTankList(key);
    await client.fetchTankList(key, { stationId: 'stn-1', status: 'active' });
    await client.fetchTank(key, 'tnk-1');
    await client.createTank(key, { name: 'Diesel 1' });
    await client.updateTank(key, 'tnk-1', { name: 'Diesel 1' });
    await client.fetchDashboard(key, 'stn-1');
    await client.fetchSeries(key, 'tnk-1');
    await client.fetchReadings(key, 'tnk-1');
    await client.recordDip(key, 'tnk-1', { source: 'manual' });
    await client.fetchDevices(key);
    await client.fetchDevice(key, 'dev-1');
    await client.registerDevice(key, { serialNumber: 'SN-1' });
    await client.assignDevice(key, 'dev-1', 'tnk-1');
    await client.unassignDevice(key, 'dev-1');
    await client.fetchAlerts(key, { status: '' });
    await client.fetchAlerts(key, { status: 'open' });
    await client.acknowledgeAlert(key, 'alt-1');
    await client.acknowledgeAlert(key, 'alt-1', 'seen');
    await client.resolveAlert(key, 'alt-1', 'closed');
    await client.assignAlert(key, 'alt-1', 'Amina');
    await client.fetchEvents(key, 'candidate');
    await client.confirmEvent(key, 'evt-1', { reference: 'DO-1' });
    await client.rejectEvent(key, 'evt-1', 'Not a delivery');
    await client.fetchDeliveries(key);
    await client.fetchReport(key, 'inventory');
    await client.fetchAudit(key);
    const csv = await client.downloadReportCsv(key, 'inventory');

    expect(csv).toContain('Diesel');
    const paths = calls.map((call) => call.url.replace(API_ORIGIN, ''));
    expect(paths).toContain('/v1/stations');
    expect(paths).toContain('/v1/stations/stn-1');
    expect(paths).toContain('/v1/tanks?limit=200');
    expect(paths).toContain('/v1/tanks?limit=200&stationId=stn-1&status=active');
    expect(paths).toContain('/v1/tanks/tnk-1/readings?limit=50');
    expect(paths).toContain('/v1/events?limit=200&status=candidate');
    expect(paths).toContain('/v1/reports/inventory?format=csv');
    for (const call of calls) {
      expect(call.url).not.toContain(key);
      expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${key}`);
    }
    const created = calls.find(
      (call) => call.init.method === 'POST' && call.url.endsWith('/v1/stations'),
    );
    expect(created?.init.body).toContain('MLM-01');
  });

  it('shows the missing scope when a write is refused', async () => {
    vi.stubGlobal('fetch', async () =>
      json(
        {
          error: 'forbidden',
          message: 'This credential does not grant stations:write',
          requiredScopes: ['stations:write'],
        },
        403,
      ),
    );
    const client = await load();
    await expect(
      client.createStation('ftk_key_secret', {
        name: 'Mlimani',
        code: 'MLM-01',
        timezone: 'Africa/Dar_es_Salaam',
      }),
    ).rejects.toThrow(/stations:write/);
  });

  it('downloads a CSV when the browser can create an object URL', async () => {
    vi.stubGlobal('fetch', async () => new Response('a,b\n', { status: 200 }));
    const click = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => ({ href: '', download: '', click }),
    });
    const createObjectURL = vi.fn(() => 'blob:csv');
    const revokeObjectURL = vi.fn();
    const url = globalThis.URL;
    Object.defineProperty(url, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(url, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    const client = await load();
    await expect(client.downloadReportCsv('ftk_key_secret', 'alerts')).resolves.toBe('a,b\n');
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv');
    delete (url as { createObjectURL?: unknown }).createObjectURL;
    delete (url as { revokeObjectURL?: unknown }).revokeObjectURL;
  });
});
