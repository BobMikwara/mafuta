import { describe, expect, it } from 'vitest';
import type { ZodError } from 'zod';
import {
  acknowledgeAlarmSchema,
  createApiKeySchema,
  createSiteSchema,
  createTankSchema,
  formatIssues,
  ingestReadingSchema,
  listAlarmsQuerySchema,
  listReadingsQuerySchema,
  parseInput,
  simulatorScenarioSchema,
  thresholdsSchema,
} from '../src/validation/schemas.js';
import { ValidationError } from '../src/errors.js';

function expectInvalid(
  schema: { safeParse(value: unknown): { success: boolean; error?: ZodError } },
  value: unknown,
): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  if (result.error === undefined) {
    return [];
  }
  return formatIssues(result.error).map((issue) => issue.path);
}

describe('site and tank input validation', () => {
  it('accepts a well formed site', () => {
    const parsed = parseInput(createSiteSchema, {
      name: 'Nairobi Depot',
      timezone: 'Africa/Nairobi',
    });
    expect(parsed.name).toBe('Nairobi Depot');
  });

  it('rejects unknown properties instead of silently ignoring them', () => {
    const paths = expectInvalid(createSiteSchema, {
      name: 'Depot',
      timezone: 'Africa/Nairobi',
      tenantId: 'tenant-b',
    });
    expect(paths).toContain('tenantId');
  });

  it('rejects blank names and malformed timezones', () => {
    expectInvalid(createSiteSchema, { name: '   ', timezone: 'Africa/Nairobi' });
    expectInvalid(createSiteSchema, { name: 'Depot', timezone: 'Not A/Zone!' });
  });

  it('accepts a vertical cylinder tank', () => {
    const parsed = parseInput(createTankSchema, {
      siteId: 'site-1',
      name: 'Diesel 1',
      product: 'diesel',
      geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
      capacityLitres: 19_000,
    });
    expect(parsed.geometry.kind).toBe('vertical-cylinder');
    expect(parsed.thresholds.criticalLowPercent).toBe(10);
  });

  it('rejects non finite and non positive dimensions', () => {
    expectInvalid(createTankSchema, {
      siteId: 'site-1',
      name: 'Diesel 1',
      product: 'diesel',
      geometry: { kind: 'vertical-cylinder', diameterMm: Number.NaN, heightMm: 4000 },
      capacityLitres: 19_000,
    });
    expectInvalid(createTankSchema, {
      siteId: 'site-1',
      name: 'Diesel 1',
      product: 'diesel',
      geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: -1 },
      capacityLitres: 19_000,
    });
  });

  it('rejects an unknown geometry kind and an unknown product', () => {
    expectInvalid(createTankSchema, {
      siteId: 'site-1',
      name: 'Diesel 1',
      product: 'diesel',
      geometry: { kind: 'sphere', radiusMm: 1000 },
      capacityLitres: 19_000,
    });
    expectInvalid(createTankSchema, {
      siteId: 'site-1',
      name: 'Diesel 1',
      product: 'jet-fuel',
      geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
      capacityLitres: 19_000,
    });
  });

  it('rejects a strapping table that is unsorted or does not start at zero', () => {
    expectInvalid(createTankSchema, {
      siteId: 'site-1',
      name: 'Diesel 1',
      product: 'diesel',
      geometry: {
        kind: 'strapping-table',
        points: [
          { levelMm: 0, volumeLitres: 0 },
          { levelMm: 500, volumeLitres: 2000 },
          { levelMm: 400, volumeLitres: 1600 },
        ],
      },
      capacityLitres: 2000,
    });
    expectInvalid(createTankSchema, {
      siteId: 'site-1',
      name: 'Diesel 1',
      product: 'diesel',
      geometry: {
        kind: 'strapping-table',
        points: [
          { levelMm: 100, volumeLitres: 400 },
          { levelMm: 500, volumeLitres: 2000 },
        ],
      },
      capacityLitres: 2000,
    });
  });

  it('rejects incoherent thresholds', () => {
    const paths = expectInvalid(thresholdsSchema, {
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

    expectInvalid(thresholdsSchema, {
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

  it('defaults source to device and temperature to null', () => {
    const parsed = parseInput(ingestReadingSchema, valid);
    expect(parsed.source).toBe('device');
    expect(parsed.temperatureC).toBeNull();
    expect(parsed.deviceId).toBeNull();
  });

  it('rejects water above product level', () => {
    const paths = expectInvalid(ingestReadingSchema, { ...valid, waterLevelMm: 2000 });
    expect(paths).toContain('waterLevelMm');
  });

  it('rejects non numeric and out of range physical values', () => {
    expectInvalid(ingestReadingSchema, { ...valid, levelMm: '1500' });
    expectInvalid(ingestReadingSchema, { ...valid, levelMm: Number.POSITIVE_INFINITY });
    expectInvalid(ingestReadingSchema, { ...valid, temperatureC: 500 });
    expectInvalid(ingestReadingSchema, { ...valid, observedAt: 'yesterday' });
  });

  it('rejects identifiers that could be used for injection or enumeration', () => {
    expectInvalid(ingestReadingSchema, { ...valid, tankId: 'TANK 1' });
    expectInvalid(ingestReadingSchema, { ...valid, tankId: 'a'.repeat(200) });
    expectInvalid(ingestReadingSchema, { ...valid, deviceId: '../../etc/passwd' });
  });

  it('accepts a simulated source only when explicitly declared', () => {
    expect(parseInput(ingestReadingSchema, { ...valid, source: 'simulated' }).source).toBe(
      'simulated',
    );
    expectInvalid(ingestReadingSchema, { ...valid, source: 'guess' });
  });
});

describe('query validation', () => {
  it('coerces limit strings and clamps them to the page maximum', () => {
    expect(parseInput(listReadingsQuerySchema, { limit: '25' }).limit).toBe(25);
    expectInvalid(listReadingsQuerySchema, { limit: '5000' });
    expectInvalid(listReadingsQuerySchema, { limit: '0' });
  });

  it('rejects an inverted time range', () => {
    const paths = expectInvalid(listReadingsQuerySchema, {
      from: '2026-01-02T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    });
    expect(paths).toContain('from');
  });

  it('validates alarm query filters', () => {
    expect(parseInput(listAlarmsQuerySchema, { status: 'open' }).status).toBe('open');
    expectInvalid(listAlarmsQuerySchema, { status: 'pending' });
    expectInvalid(listAlarmsQuerySchema, { tankId: 'BAD ID' });
  });
});

describe('misc schemas', () => {
  it('accepts an optional acknowledgement note', () => {
    expect(parseInput(acknowledgeAlarmSchema, {}).note).toBeUndefined();
    expect(parseInput(acknowledgeAlarmSchema, { note: 'checked on site' }).note).toBe(
      'checked on site',
    );
    expectInvalid(acknowledgeAlarmSchema, { note: 'x'.repeat(501) });
  });

  it('requires at least one scope for an api key', () => {
    expect(
      parseInput(createApiKeySchema, { name: 'edge-1', scopes: ['readings:write'] }).scopes,
    ).toEqual(['readings:write']);
    expectInvalid(createApiKeySchema, { name: 'edge-1', scopes: [] });
    expectInvalid(createApiKeySchema, { name: 'edge-1', scopes: ['root:all'] });
  });

  it('only accepts known simulator scenarios', () => {
    expect(parseInput(simulatorScenarioSchema, 'theft')).toBe('theft');
    expectInvalid(simulatorScenarioSchema, 'explode');
  });
});

describe('parseInput', () => {
  it('throws a ValidationError carrying flattened issues', () => {
    let captured: unknown;
    try {
      parseInput(createSiteSchema, { name: '' });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(ValidationError);
    const validationError = captured as ValidationError;
    expect(validationError.issues.length).toBeGreaterThan(0);
    expect(validationError.issues[0]?.path).toBe('name');
  });
});
