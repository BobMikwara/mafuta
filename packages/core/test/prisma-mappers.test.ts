import { describe, expect, it } from 'vitest';
import {
  toDomainAlarm,
  toDomainReading,
  toDomainSite,
  toDomainTank,
  toPrismaAlertInput,
  toPrismaAlertType,
  toPrismaGeometry,
  toPrismaReadingInput,
  toPrismaStationInput,
  toPrismaTankInput,
} from '../src/adapters/prisma/mappers.js';
import { ALARM_TYPES } from '../src/domain/alarm.js';
import type { TankGeometry } from '../src/domain/geometry.js';
import {
  DEFAULT_TEST_GEOMETRY,
  TENANT_A,
  makeAlarm,
  makeReading,
  makeSite,
  makeTank,
  readingId,
} from './factories.js';

const RECORDED_AT = new Date('2026-01-01T00:00:00.000Z');

/** Prisma Decimal columns reach the mappers as objects exposing toNumber(). */
const decimal = (value: number): { toNumber(): number } => ({ toNumber: () => value });

/** Alert type names as declared by the Prisma schema. */
const SCHEMA_ALERT_TYPES = [
  'low_stock',
  'critical_stock',
  'device_offline',
  'stale_data',
  'probe_quality',
  'candidate_delivery',
  'candidate_unexplained_decrease',
  'water_level',
];

function storedTankRow(geometry: TankGeometry) {
  return {
    id: 'tank-1',
    tenantId: TENANT_A,
    stationId: 'site-1',
    name: 'Diesel Tank 1',
    product: 'diesel',
    capacityLitres: decimal(19_000),
    geometry,
    criticalLowPercent: decimal(10),
    lowPercent: decimal(20),
    highPercent: decimal(95),
    waterAlarmMm: decimal(50),
    unexplainedDecreaseLitresPerHour: decimal(400),
    deliveryMinLitres: decimal(300),
    deliveryWindowMinutes: 30,
    staleAfterMinutes: 60,
    status: 'active',
    createdAt: RECORDED_AT,
    updatedAt: RECORDED_AT,
  };
}

describe('prisma row mappers', () => {
  it('stores each geometry kind as a plain JSON value', () => {
    const geometries: ReadonlyArray<TankGeometry> = [
      { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
      { kind: 'horizontal-cylinder', diameterMm: 2000, lengthMm: 5000 },
      {
        kind: 'strapping-table',
        points: [
          { levelMm: 0, volumeLitres: 0 },
          { levelMm: 1000, volumeLitres: 5000 },
        ],
      },
    ];

    for (const geometry of geometries) {
      const stored = toPrismaGeometry(geometry);
      expect(stored).toEqual(geometry);
      expect(JSON.parse(JSON.stringify(stored))).toEqual(geometry);
    }
  });

  it('does not hand the domain strapping table to Prisma by reference', () => {
    const points = [{ levelMm: 0, volumeLitres: 0 }];
    const stored = toPrismaGeometry({ kind: 'strapping-table', points });

    points.push({ levelMm: 1000, volumeLitres: 5000 });

    expect(JSON.parse(JSON.stringify(stored))).toEqual({
      kind: 'strapping-table',
      points: [{ levelMm: 0, volumeLitres: 0 }],
    });
  });

  it('maps a domain tank onto the columns the schema declares', () => {
    const input = toPrismaTankInput(
      makeTank({
        product: 'petrol-95',
        thresholds: {
          ...makeTank().thresholds,
          rapidDropLitresPerHour: 1200,
          deliveryLitres: 900,
        },
      }),
    );

    expect(input).toMatchObject({
      id: 'tank-1',
      tenantId: TENANT_A,
      stationId: 'site-1',
      product: 'petrol_95',
      capacityLitres: 19_000,
      unexplainedDecreaseLitresPerHour: 1200,
      deliveryMinLitres: 900,
      status: 'active',
    });
    expect(input.geometry).toEqual(DEFAULT_TEST_GEOMETRY);
  });

  it('reads stored geometry and decimal thresholds back into the domain shape', () => {
    const geometry: TankGeometry = {
      kind: 'horizontal-cylinder',
      diameterMm: 2000,
      lengthMm: 5000,
    };

    const tank = toDomainTank(storedTankRow(geometry));

    expect(tank.geometry).toEqual(geometry);
    expect(tank.capacityLitres).toBe(19_000);
    expect(tank.thresholds).toMatchObject({
      criticalLowPercent: 10,
      lowPercent: 20,
      highPercent: 95,
      waterAlarmMm: 50,
      rapidDropLitresPerHour: 400,
      deliveryLitres: 300,
      deliveryWindowMinutes: 30,
      staleAfterMinutes: 60,
    });
  });

  it('maps every alarm type onto an alert type the schema declares', () => {
    for (const type of ALARM_TYPES) {
      expect(SCHEMA_ALERT_TYPES).toContain(toPrismaAlertType(type));
    }
  });

  it('stores alarm metrics as JSON with the reading reference', () => {
    const input = toPrismaAlertInput(
      makeAlarm({
        type: 'critical-low-level',
        severity: 'critical',
        metrics: { levelMm: 900, percentFull: 9 },
        readingId: readingId('rdg-9'),
      }),
    );

    expect(input.type).toBe('critical_stock');
    expect(input.severity).toBe('critical');
    expect(input.status).toBe('open');
    expect(input.metrics).toEqual({ levelMm: 900, percentFull: 9, _readingId: 'rdg-9' });
    expect(JSON.parse(JSON.stringify(input.metrics))).toEqual(input.metrics);
  });

  it('omits the reading reference when the alarm carries none', () => {
    const input = toPrismaAlertInput(makeAlarm({ metrics: { levelMm: 900 } }));

    expect(input.metrics).toEqual({ levelMm: 900 });
  });

  it('reads a stored alert back into the domain alarm', () => {
    const alarm = makeAlarm({
      type: 'water-ingress',
      severity: 'critical',
      status: 'acknowledged',
      metrics: { levelMm: 900 },
      readingId: readingId('rdg-9'),
    });
    const input = toPrismaAlertInput(alarm);

    const restored = toDomainAlarm({ ...input, updatedAt: RECORDED_AT });

    expect(restored.type).toBe('water-ingress');
    expect(restored.severity).toBe('critical');
    expect(restored.status).toBe('acknowledged');
    expect(restored.readingId).toBe('rdg-9');
    expect(restored.metrics).toEqual({ levelMm: 900 });
  });

  it('maps a domain reading onto the columns the schema declares', () => {
    const input = toPrismaReadingInput(makeReading({ source: 'manual' }));

    expect(input).toMatchObject({
      id: 'rdg-1',
      tenantId: TENANT_A,
      tankId: 'tank-1',
      deviceId: null,
      levelMm: 2000,
      waterLevelMm: 2,
      volumeLitres: 9807.68,
      temperatureC: 24,
      sourceProtocol: 'manual',
      provenance: 'manual',
      qualityStatus: 'ok',
      freshnessStatus: 'fresh',
    });
    expect(input.recordedAt).toEqual(RECORDED_AT);
  });

  it('reads a stored reading back into the domain shape', () => {
    const reading = toDomainReading({
      id: 'rdg-1',
      tenantId: TENANT_A,
      tankId: 'tank-1',
      recordedAt: RECORDED_AT,
      receivedAt: RECORDED_AT,
      levelMm: decimal(2000),
      waterLevelMm: decimal(2),
      volumeLitres: decimal(9807.68),
      temperatureC: null,
      sourceProtocol: 'simulated',
      qualityStatus: 'ok',
      deviceId: null,
      idempotencyKey: 'idem-1',
    });

    expect(reading.levelMm).toBe(2000);
    expect(reading.waterLevelMm).toBe(2);
    expect(reading.grossVolumeLitres).toBe(9807.68);
    expect(reading.temperatureC).toBeNull();
    expect(reading.source).toBe('simulated');
  });

  it('maps a domain site onto the station columns and back', () => {
    const input = toPrismaStationInput(makeSite({ name: 'Depot 1' }));

    expect(input).toMatchObject({
      id: 'site-1',
      tenantId: TENANT_A,
      name: 'Depot 1',
      code: 'site-1',
      timezone: 'Africa/Nairobi',
      status: 'active',
    });

    const site = toDomainSite({
      id: input.id,
      tenantId: input.tenantId,
      name: input.name,
      timezone: input.timezone,
      status: input.status,
      createdAt: RECORDED_AT,
      updatedAt: RECORDED_AT,
    });

    expect(site.status).toBe('active');
    expect(site.createdAt).toBe(RECORDED_AT.toISOString());
  });
});
