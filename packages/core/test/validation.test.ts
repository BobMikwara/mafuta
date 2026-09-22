import { describe, expect, it } from 'vitest';
import type { ZodError, ZodTypeAny } from 'zod';
import {
  assignDeviceSchema,
  auditQuerySchema,
  createApiKeySchema,
  createStationSchema,
  createTankSchema,
  dashboardQuerySchema,
  formatIssues,
  ingestReadingBodySchema,
  ingestReadingSchema,
  listAlertsQuerySchema,
  listDevicesQuerySchema,
  listEventsQuerySchema,
  listReadingsQuerySchema,
  listStationsQuerySchema,
  parseInput,
  registerDeviceSchema,
  rejectEventSchema,
  reportParamsSchema,
  reportQuerySchema,
  simulatorScenarioSchema,
  tankSeriesQuerySchema,
  thresholdsSchema,
} from '../src/validation/schemas.js';
import { ValidationError } from '../src/errors.js';

function issuesFor(schema: ZodTypeAny, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  if (result.success) {
    return [];
  }
  return formatIssues(result.error).map((issue) => issue.path);
}

describe('station input validation', () => {
  it('accepts a well formed station and normalizes the code', () => {
    const parsed = parseInput(createStationSchema, {
      name: 'Nairobi Depot',
      code: 'nbo-01',
      timezone: 'Africa/Nairobi',
    });
    expect(parsed.name).toBe('Nairobi Depot');
    expect(parsed.code).toBe('NBO-01');
    expect(parsed.timezone).toBe('Africa/Nairobi');
  });

  it('rejects unknown properties instead of silently ignoring them', () => {
    const paths = issuesFor(createStationSchema, {
      name: 'Depot',
      code: 'NBO-01',
      tenantId: 'tenant-b',
    });
    expect(paths).toContain('tenantId');
  });

  it('rejects blank names, malformed timezones and unsafe codes', () => {
    issuesFor(createStationSchema, { name: '   ', code: 'NBO-01' });
    issuesFor(createStationSchema, { name: 'Depot', code: 'NBO-01', timezone: 'Not A/Zone!' });
    issuesFor(createStationSchema, { name: 'Depot', code: 'NBO 01' });
    issuesFor(createStationSchema, { name: 'Depot', code: 'X' });
  });

  it('rejects an identifier that could be used for enumeration', () => {
    issuesFor(createStationSchema, { id: 'STATION 1', name: 'Depot', code: 'NBO-01' });
  });

  it('defaults list queries to a page of one hundred and refuses larger pages', () => {
    expect(parseInput(listStationsQuerySchema, {}).limit).toBe(100);
    issuesFor(listStationsQuerySchema, { status: 'retired' });
  });
});

describe('tank input validation', () => {
  const base = {
    stationId: 'station-1',
    name: 'Diesel 1',
    product: 'diesel',
    geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
    capacityLitres: 19_000,
  };

  it('accepts a vertical cylinder tank and applies the default thresholds', () => {
    const parsed = parseInput(createTankSchema, base);
    expect(parsed.geometry.kind).toBe('vertical-cylinder');
    expect(parsed.thresholds.criticalLowPercent).toBe(10);
    expect(parsed.thresholds.lowPercent).toBe(20);
    expect(parsed.thresholds.highPercent).toBe(95);
    expect(parsed.thresholds.waterAlarmMm).toBe(50);
  });

  it('rejects non finite and non positive dimensions', () => {
    issuesFor(createTankSchema, {
      ...base,
      geometry: { kind: 'vertical-cylinder', diameterMm: Number.NaN, heightMm: 4000 },
    });
    issuesFor(createTankSchema, {
      ...base,
      geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: -1 },
    });
    issuesFor(createTankSchema, { ...base, capacityLitres: 0 });
  });

  it('rejects an unknown geometry kind and an unknown product', () => {
    issuesFor(createTankSchema, { ...base, geometry: { kind: 'sphere', radiusMm: 1000 } });
    issuesFor(createTankSchema, { ...base, product: 'jet-fuel' });
  });

  it('rejects a strapping table that is unsorted or does not start at zero', () => {
    issuesFor(createTankSchema, {
      ...base,
      geometry: {
        kind: 'strapping-table',
        points: [
          { levelMm: 0, volumeLitres: 0 },
          { levelMm: 500, volumeLitres: 2000 },
          { levelMm: 400, volumeLitres: 1600 },
        ],
      },
    });
    issuesFor(createTankSchema, {
      ...base,
      geometry: {
        kind: 'strapping-table',
        points: [
          { levelMm: 100, volumeLitres: 400 },
          { levelMm: 500, volumeLitres: 2000 },
        ],
      },
    });
  });

  it('rejects incoherent thresholds', () => {
    const paths = issuesFor(thresholdsSchema, {
      criticalLowPercent: 30,
      lowPercent: 20,
      highPercent: 95,
      waterAlarmMm: 50,
      rapidDropLitresPerHour: 400,
      deliveryLitres: 300,
      deliveryWindowMinutes: 30,
      staleAfterMinutes: 60,
    });
    expect(paths).toContain('criticalLowPercent');

    issuesFor(thresholdsSchema, {
      criticalLowPercent: 10,
      lowPercent: 98,
      highPercent: 95,
      waterAlarmMm: 50,
      rapidDropLitresPerHour: 400,
      deliveryLitres: 300,
      deliveryWindowMinutes: 30,
      staleAfterMinutes: 60,
    });
  });
});

describe('reading ingest validation', () => {
  const valid = {
    tankId: 'tank-1',
    observedAt: '2026-01-01T00:00:00.000Z',
    levelMm: 1500,
    waterLevelMm: 5,
  };

  it('defaults source to device, temperature and device to null and quality untouched', () => {
    const parsed = parseInput(ingestReadingSchema, valid);
    expect(parsed.source).toBe('device');
    expect(parsed.temperatureC).toBeNull();
    expect(parsed.deviceId).toBeNull();
    expect(parsed.idempotencyKey).toBeUndefined();
  });

  it('rejects water above product level', () => {
    const paths = issuesFor(ingestReadingSchema, { ...valid, waterLevelMm: 2000 });
    expect(paths).toContain('waterLevelMm');
  });

  it('rejects non numeric and out of range physical values', () => {
    issuesFor(ingestReadingSchema, { ...valid, levelMm: '1500' });
    issuesFor(ingestReadingSchema, { ...valid, levelMm: Number.POSITIVE_INFINITY });
    issuesFor(ingestReadingSchema, { ...valid, temperatureC: 500 });
    issuesFor(ingestReadingSchema, { ...valid, observedAt: 'yesterday' });
    issuesFor(ingestReadingSchema, { ...valid, signalQualityPercent: 120 });
  });

  it('rejects identifiers that could be used for injection or enumeration', () => {
    issuesFor(ingestReadingSchema, { ...valid, tankId: 'TANK 1' });
    issuesFor(ingestReadingSchema, { ...valid, tankId: 'a'.repeat(200) });
    issuesFor(ingestReadingSchema, { ...valid, deviceId: '../../etc/passwd' });
  });

  it('accepts a simulated source only when explicitly declared', () => {
    expect(parseInput(ingestReadingSchema, { ...valid, source: 'simulated' }).source).toBe(
      'simulated',
    );
    issuesFor(ingestReadingSchema, { ...valid, source: 'guess' });
  });

  it('validates a client supplied idempotency key before it reaches storage', () => {
    expect(
      parseInput(ingestReadingSchema, { ...valid, idempotencyKey: 'client-key-0001' }),
    ).toBeTruthy();
    issuesFor(ingestReadingSchema, { ...valid, idempotencyKey: 'short' });
    issuesFor(ingestReadingSchema, { ...valid, idempotencyKey: 'has space here' });
  });

  it('exposes a body schema without tankId for the tank-scoped ingest route', () => {
    const { tankId: _ignored, ...body } = valid;
    const parsed = parseInput(ingestReadingBodySchema, body);
    expect('tankId' in parsed).toBe(false);
    // The path supplies the tank, so a body carrying one is a client mistake.
    issuesFor(ingestReadingBodySchema, valid);
    issuesFor(ingestReadingBodySchema, { ...body, waterLevelMm: 2000 });
  });
});

describe('query validation', () => {
  it('coerces limit strings and clamps them to the page maximum', () => {
    expect(parseInput(listReadingsQuerySchema, { limit: '25' }).limit).toBe(25);
    expect(parseInput(listReadingsQuerySchema, {}).limit).toBe(100);
    issuesFor(listReadingsQuerySchema, { limit: '5000' });
    issuesFor(listReadingsQuerySchema, { limit: '0' });
  });

  it('translates the ascending flag and rejects an inverted time range', () => {
    expect(parseInput(listReadingsQuerySchema, { ascending: 'true' }).ascending).toBe(true);
    expect(parseInput(listReadingsQuerySchema, { ascending: 'false' }).ascending).toBe(false);
    const paths = issuesFor(listReadingsQuerySchema, {
      from: '2026-01-02T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    });
    expect(paths).toContain('from');
  });

  it('validates alert query filters', () => {
    expect(parseInput(listAlertsQuerySchema, { status: 'open' }).status).toBe('open');
    expect(parseInput(listAlertsQuerySchema, { type: 'low_stock' }).type).toBe('low_stock');
    issuesFor(listAlertsQuerySchema, { status: 'pending' });
    issuesFor(listAlertsQuerySchema, { tankId: 'BAD ID' });
    issuesFor(listAlertsQuerySchema, { type: 'low_level' });
  });

  it('validates device, event and dashboard queries', () => {
    expect(parseInput(listDevicesQuerySchema, {}).limit).toBe(100);
    issuesFor(listDevicesQuerySchema, { status: 'unknown' });
    expect(parseInput(listEventsQuerySchema, { status: 'candidate' }).status).toBe('candidate');
    issuesFor(listEventsQuerySchema, {
      from: '2026-02-01T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    });
    expect(parseInput(dashboardQuerySchema, {}).stationId).toBeUndefined();
    const series = parseInput(tankSeriesQuerySchema, { hours: '48' });
    expect(series.hours).toBe(48);
    expect(series.buckets).toBe(48);
    issuesFor(tankSeriesQuerySchema, { hours: '0' });
  });

  it('defaults the report format to json and only accepts known reports', () => {
    expect(parseInput(reportQuerySchema, {}).format).toBe('json');
    expect(parseInput(reportQuerySchema, { format: 'csv' }).format).toBe('csv');
    expect(parseInput(reportParamsSchema, { report: 'stock-movement' }).report).toBe(
      'stock-movement',
    );
    issuesFor(reportParamsSchema, { report: 'profit-and-loss' });
    issuesFor(reportQuerySchema, { format: 'pdf' });
  });

  it('validates audit log queries', () => {
    expect(parseInput(auditQuerySchema, {}).limit).toBe(100);
    issuesFor(auditQuerySchema, { limit: '0' });
  });
});

describe('device and event schemas', () => {
  it('requires a known protocol and a filesystem safe serial number', () => {
    const device = parseInput(registerDeviceSchema, {
      manufacturer: 'Acme',
      model: 'Probe 3000',
      serialNumber: 'SN-0001',
      protocol: 'http',
    });
    expect(device.protocol).toBe('http');
    issuesFor(registerDeviceSchema, {
      manufacturer: 'Acme',
      model: 'Probe 3000',
      serialNumber: 'SN-0001',
      protocol: 'carrier-pigeon',
    });
    issuesFor(registerDeviceSchema, {
      manufacturer: 'Acme',
      model: 'Probe 3000',
      serialNumber: 'SN/0001',
      protocol: 'http',
    });
  });

  it('requires a tank when assigning a device', () => {
    expect(parseInput(assignDeviceSchema, { tankId: 'tank-1' }).tankId).toBe('tank-1');
    issuesFor(assignDeviceSchema, {});
  });

  it('requires a meaningful rejection note', () => {
    expect(parseInput(rejectEventSchema, { note: 'wrong window' }).note).toBe('wrong window');
    issuesFor(rejectEventSchema, {});
    issuesFor(rejectEventSchema, { note: 'x' });
  });
});

describe('misc schemas', () => {
  it('requires at least one known scope for an api key', () => {
    expect(
      parseInput(createApiKeySchema, { name: 'edge-1', scopes: ['readings:write'] }).scopes,
    ).toEqual(['readings:write']);
    issuesFor(createApiKeySchema, { name: 'edge-1', scopes: [] });
    issuesFor(createApiKeySchema, { name: 'edge-1', scopes: ['root:all'] });
    issuesFor(createApiKeySchema, { name: 'edge-1', scopes: ['simulator:write'], extra: 1 });
  });

  it('only accepts known simulator scenarios', () => {
    expect(parseInput(simulatorScenarioSchema, 'theft')).toBe('theft');
    issuesFor(simulatorScenarioSchema, 'explode');
  });
});

describe('parseInput', () => {
  it('throws a ValidationError carrying flattened issues', () => {
    let captured: unknown;
    try {
      parseInput(createStationSchema, { name: '' });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(ValidationError);
    const validationError = captured as ValidationError;
    expect(validationError.issues.length).toBeGreaterThan(0);
    expect(validationError.issues[0]?.path).toBe('name');
  });
});

describe('formatIssues', () => {
  it('names every unrecognised key, including keys of nested objects', () => {
    const result = createStationSchema.safeParse({ name: 'Depot', code: 'NBO-01', nope: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatIssues(result.error as ZodError).map((issue) => issue.path)).toContain('nope');
    }

    const nested = createTankSchema.safeParse({
      stationId: 'station-1',
      name: 'Diesel 1',
      product: 'diesel',
      geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
      capacityLitres: 19_000,
      thresholds: {
        criticalLowPercent: 10,
        lowPercent: 20,
        highPercent: 95,
        waterAlarmMm: 50,
        rapidDropLitresPerHour: 400,
        deliveryLitres: 300,
        deliveryWindowMinutes: 30,
        staleAfterMinutes: 60,
        stolenLitres: 10_000,
      },
    });
    expect(nested.success).toBe(false);
    if (!nested.success) {
      expect(formatIssues(nested.error).map((issue) => issue.path)).toContain(
        'thresholds.stolenLitres',
      );
    }
  });

  it('falls back to (root) for issues that have no path', () => {
    const schema = createApiKeySchema.refine(() => false, { message: 'nope' });
    const result = schema.safeParse({ name: 'edge-1', scopes: ['readings:read'] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatIssues(result.error)[0]?.path).toBe('(root)');
    }
  });
});
