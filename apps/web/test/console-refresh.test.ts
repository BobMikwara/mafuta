import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api-errors.js';
import {
  connectionFor,
  loadConsoleSnapshot,
  type ConsoleClient,
} from '../src/lib/console-refresh.js';
import type { Alert, Reading, Tank } from '../src/lib/api.js';

/**
 * One console refresh cycle. These pin the behaviour behind the 403 report:
 * a refused alerts request is shown in the alerts panel only, with the
 * server's explanation, while tanks keep loading; a rejected key stops the
 * cycle; and a retry after a failure recovers.
 */

const TANK: Tank = {
  id: 'tank-1',
  stationId: 'station-1',
  name: 'Diesel Tank 1',
  product: 'diesel',
  capacityLitres: 19_000,
  status: 'active',
};

const READING: Reading = {
  id: 'rdg-1',
  tankId: 'tank-1',
  levelMm: 2000,
  waterLevelMm: 5,
  netVolumeLitres: 9_000,
  grossVolumeLitres: 9_050,
  temperatureC: 22,
  recordedAt: '2026-01-01T00:00:00.000Z',
  receivedAt: '2026-01-01T00:00:01.000Z',
  source: 'manual',
  quality: 'good',
};

const ALERT: Alert = {
  id: 'alt-1',
  tankId: 'tank-1',
  type: 'critical_stock',
  severity: 'critical',
  status: 'open',
  message: 'Stock is below the critical threshold',
  raisedAt: '2026-01-01T00:00:00.000Z',
};

function forbidden(): ApiError {
  return new ApiError({
    kind: 'forbidden',
    status: 403,
    message: 'Access denied. This API key does not grant the alerts:read scope.',
    body: { error: 'forbidden', reason: 'insufficient_scope', requiredScopes: ['alerts:read'] },
  });
}

function unauthorized(): ApiError {
  return new ApiError({ kind: 'unauthorized', status: 401, message: 'API key rejected.' });
}

function client(overrides: Partial<ConsoleClient> = {}): ConsoleClient {
  return {
    fetchTanks: vi.fn(async () => ({ tanks: [TANK] })),
    fetchAlerts: vi.fn(async () => ({ alerts: [ALERT] })),
    fetchReadings: vi.fn(async () => ({ readings: [READING] })),
    ...overrides,
  };
}

describe('loadConsoleSnapshot', () => {
  it('loads tanks, latest readings and alerts for a fully permitted key', async () => {
    const outcome = await loadConsoleSnapshot('k', { skipAlerts: false }, client());
    expect(outcome).toEqual({
      kind: 'loaded',
      tanks: [TANK],
      latestByTank: { 'tank-1': READING },
      alerts: { status: 'ready', alerts: [ALERT] },
      alertsRefused: false,
    });
    expect(connectionFor(outcome, '10:00').kind).toBe('ready');
  });

  it('treats an empty alert list as a valid, ready state', async () => {
    const outcome = await loadConsoleSnapshot(
      'k',
      { skipAlerts: false },
      client({ fetchAlerts: async () => ({ alerts: [] }) }),
    );
    expect(outcome.kind === 'loaded' && outcome.alerts).toEqual({ status: 'ready', alerts: [] });
  });

  it('keeps tanks working and explains the refusal when alerts answer 403', async () => {
    const outcome = await loadConsoleSnapshot(
      'k',
      { skipAlerts: false },
      client({ fetchAlerts: async () => Promise.reject(forbidden()) }),
    );

    expect(outcome.kind).toBe('loaded');
    if (outcome.kind !== 'loaded') return;
    expect(outcome.tanks).toEqual([TANK]);
    expect(outcome.alertsRefused).toBe(true);
    expect(outcome.alerts).toMatchObject({ status: 'error', kind: 'forbidden' });
    expect(outcome.alerts?.status === 'error' && outcome.alerts.message).toContain('alerts:read');

    const connection = connectionFor(outcome, '10:00');
    expect(connection.kind).toBe('limited');
    expect(connection.message).toContain('limited access');
  });

  it('does not request alerts again after a 403, and stays limited', async () => {
    const fake = client();
    const outcome = await loadConsoleSnapshot('k', { skipAlerts: true }, fake);
    expect(fake.fetchAlerts).not.toHaveBeenCalled();
    expect(outcome.kind === 'loaded' && outcome.alerts).toBe(null);
    expect(connectionFor(outcome, '10:00').kind).toBe('limited');
  });

  it('stops on a rejected key, whichever request reports it', async () => {
    const fromTanks = await loadConsoleSnapshot(
      'k',
      { skipAlerts: false },
      client({ fetchTanks: async () => Promise.reject(unauthorized()) }),
    );
    expect(fromTanks).toEqual({ kind: 'unauthorized', message: 'API key rejected.' });

    const fromAlerts = await loadConsoleSnapshot(
      'k',
      { skipAlerts: false },
      client({ fetchAlerts: async () => Promise.reject(unauthorized()) }),
    );
    expect(fromAlerts.kind).toBe('unauthorized');
    expect(connectionFor(fromAlerts, '').kind).toBe('error');
  });

  it('reports a tanks failure while still delivering the alerts result', async () => {
    const outcome = await loadConsoleSnapshot(
      'k',
      { skipAlerts: false },
      client({ fetchTanks: async () => Promise.reject(new Error('Gateway timeout')) }),
    );
    expect(outcome).toEqual({
      kind: 'tanks_failed',
      message: 'Gateway timeout',
      alerts: { status: 'ready', alerts: [ALERT] },
    });
    expect(connectionFor(outcome, '').message).toBe('Gateway timeout');
  });

  it('uses fallbacks for failures that are not Error instances', async () => {
    const outcome = await loadConsoleSnapshot(
      'k',
      { skipAlerts: false },
      client({
        fetchTanks: async () => Promise.reject('down'),
        fetchAlerts: async () => Promise.reject('down'),
      }),
    );
    expect(outcome).toEqual({
      kind: 'tanks_failed',
      message: 'Unable to load tanks',
      alerts: { status: 'error', kind: 'other', message: 'Unable to load alerts' },
    });
  });

  it('shows "no data" for a tank whose readings fail, without failing the table', async () => {
    const outcome = await loadConsoleSnapshot(
      'k',
      { skipAlerts: false },
      client({
        fetchTanks: async () => ({ tanks: [TANK, { ...TANK, id: 'tank-2' }] }),
        fetchReadings: async (_key, tankId) =>
          tankId === 'tank-2' ? Promise.reject(new Error('boom')) : { readings: [READING] },
      }),
    );
    expect(outcome.kind === 'loaded' && outcome.latestByTank).toEqual({ 'tank-1': READING });
  });

  it('recovers on retry after a failed request', async () => {
    let attempt = 0;
    const flaky = client({
      fetchAlerts: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('Unable to reach the API');
        return { alerts: [ALERT] };
      },
    });

    const first = await loadConsoleSnapshot('k', { skipAlerts: false }, flaky);
    expect(first.kind === 'loaded' && first.alerts?.status).toBe('error');
    expect(first.kind === 'loaded' && first.alertsRefused).toBe(false);

    const second = await loadConsoleSnapshot('k', { skipAlerts: false }, flaky);
    expect(second.kind === 'loaded' && second.alerts).toEqual({
      status: 'ready',
      alerts: [ALERT],
    });
  });
});
