import { describe, expect, it } from 'vitest';
import {
  toDomainAlert,
  toDomainDevice,
  toDomainFuelEvent,
  toDomainReading,
  toDomainStation,
  toDomainTank,
  toPrismaAlertInput,
  toPrismaAlertType,
  toPrismaDeviceInput,
  toPrismaFuelEventInput,
  toPrismaGeometry,
  toPrismaRawMessageInput,
  toPrismaReadingInput,
  toPrismaStationInput,
  toPrismaTankInput,
  toDomainRawMessage,
} from '../src/adapters/prisma/mappers.js';
import { ALERT_TYPES, type Alert } from '../src/domain/alert.js';
import type { TankGeometry } from '../src/domain/geometry.js';
import {
  DEFAULT_TEST_GEOMETRY,
  TENANT_A,
  makeAlert,
  makeDevice,
  makeEvent,
  makeRawMessage,
  makeReading,
  makeStation,
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
    stationId: 'station-1',
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
      stationId: 'station-1',
      product: 'petrol_95',
      capacityLitres: 19_000,
      unexplainedDecreaseLitresPerHour: 1200,
      deliveryMinLitres: 900,
      status: 'active',
      calibrationSource: null,
      calibrationAt: null,
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
    expect(tank.stationId).toBe('station-1');
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

  it('maps every domain alert type onto an alert type the schema declares', () => {
    for (const type of ALERT_TYPES) {
      expect(SCHEMA_ALERT_TYPES).toContain(toPrismaAlertType(type));
    }
  });

  it('throws on an alert type the schema does not know, instead of writing it', () => {
    expect(() => toPrismaAlertType('high_level' as Alert['type'])).toThrow(
      /Unsupported alert type/,
    );
  });

  it('stores alert metrics as JSON with the reading reference', () => {
    const input = toPrismaAlertInput(
      makeAlert({
        type: 'critical_stock',
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

  it('omits the reading reference when the alert carries none', () => {
    const input = toPrismaAlertInput(makeAlert({ metrics: { levelMm: 900 } }));

    expect(input.metrics).toEqual({ levelMm: 900 });
  });

  it('reads a stored alert back into the domain alert', () => {
    const alert = makeAlert({
      type: 'water_level',
      severity: 'critical',
      status: 'acknowledged',
      metrics: { levelMm: 900 },
      readingId: readingId('rdg-9'),
    });
    const input = toPrismaAlertInput(alert);

    const restored = toDomainAlert({ ...input, updatedAt: RECORDED_AT });

    expect(restored.type).toBe('water_level');
    expect(restored.severity).toBe('critical');
    expect(restored.status).toBe('acknowledged');
    expect(restored.readingId).toBe('rdg-9');
    expect(restored.metrics).toEqual({ levelMm: 900 });
  });

  it('maps a domain station onto the station columns and back', () => {
    const input = toPrismaStationInput(makeStation({ name: 'Depot 1' }));

    expect(input).toMatchObject({
      id: 'station-1',
      tenantId: TENANT_A,
      name: 'Depot 1',
      code: 'TST-01',
      timezone: 'Africa/Nairobi',
      status: 'active',
    });

    const station = toDomainStation({
      id: input.id,
      tenantId: input.tenantId,
      name: input.name,
      code: input.code,
      timezone: input.timezone,
      status: input.status,
      createdAt: RECORDED_AT,
      updatedAt: RECORDED_AT,
    });

    expect(station.status).toBe('active');
    expect(station.createdAt).toBe(RECORDED_AT.toISOString());
  });

  it('maps a domain reading onto the columns the schema declares', () => {
    const input = toPrismaReadingInput(makeReading({ source: 'manual', provenance: 'manual' }));

    expect(input).toMatchObject({
      id: 'rdg-1',
      tenantId: TENANT_A,
      tankId: 'tank-1',
      deviceId: null,
      levelMm: 2000,
      waterLevelMm: 5,
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
      deviceId: null,
      recordedAt: RECORDED_AT,
      receivedAt: RECORDED_AT,
      levelMm: decimal(2000),
      waterLevelMm: decimal(5),
      volumeLitres: decimal(9807.68),
      temperatureC: null,
      provenance: 'measured',
      qualityStatus: 'ok',
      freshnessStatus: 'fresh',
      sourceProtocol: 'simulated',
      idempotencyKey: 'idem-1',
      rawMessageId: 'raw-1',
    });

    expect(reading.levelMm).toBe(2000);
    expect(reading.waterLevelMm).toBe(5);
    expect(reading.grossVolumeLitres).toBe(9807.68);
    expect(reading.netVolumeLitres).toBe(9807.68);
    expect(reading.temperatureC).toBeNull();
    expect(reading.source).toBe('simulated');
    expect(reading.rawMessageId).toBe('raw-1');
  });

  it('explains a non-ok verdict through the retained payload reference', () => {
    const reading = toDomainReading({
      id: 'rdg-2',
      tenantId: TENANT_A,
      tankId: 'tank-1',
      deviceId: null,
      recordedAt: RECORDED_AT,
      receivedAt: RECORDED_AT,
      levelMm: decimal(2000),
      waterLevelMm: null,
      volumeLitres: decimal(9807.68),
      temperatureC: null,
      provenance: 'measured',
      qualityStatus: 'suspect',
      freshnessStatus: 'fresh',
      sourceProtocol: 'http',
      idempotencyKey: 'idem-2',
    });

    expect(reading.waterLevelMm).toBe(0);
    expect(reading.quality).toBe('suspect');
    expect(reading.qualityReason).toContain('raw payload');
  });

  it('maps a domain device onto the columns the schema declares', () => {
    const input = toPrismaDeviceInput(makeDevice({ lastSeenAt: null }));

    expect(input).toMatchObject({
      id: 'dev-1',
      tenantId: TENANT_A,
      serialNumber: 'SN-0001',
      protocol: 'http',
      status: 'active',
      connectionState: 'online',
      lastSeenAt: null,
    });
  });

  it('reads a stored device back into the domain shape', () => {
    const device = toDomainDevice({
      id: 'dev-1',
      tenantId: TENANT_A,
      manufacturer: 'Acme',
      model: 'Probe 3000',
      serialNumber: 'SN-0001',
      protocol: 'modbus_tcp',
      firmwareVersion: null,
      status: 'active',
      connectionState: 'offline',
      lastSeenAt: RECORDED_AT,
      credentialRef: null,
      createdAt: RECORDED_AT,
      updatedAt: RECORDED_AT,
    });

    expect(device.protocol).toBe('modbus_tcp');
    expect(device.connectionState).toBe('offline');
    expect(device.lastSeenAt).toBe(RECORDED_AT.toISOString());
  });

  it('stores an event with millilitres converted to the litre column', () => {
    const input = toPrismaFuelEventInput(makeEvent({ volumeChangeMl: 10_000_000 }));

    expect(input.volumeChangeLitres).toBe('10000.000');
    expect(input.evidence).toMatchObject({
      volumeChangeMl: 10_000_000,
      rule: 'Rise sustained within the delivery window',
    });
    // Explainer lists must survive the JSON round trip that the column imposes.
    expect(JSON.parse(JSON.stringify(input.evidence))).toEqual(input.evidence);
  });

  it('reads a stored event back into millilitres', () => {
    const event = toDomainFuelEvent({
      id: 'evt-1',
      tenantId: TENANT_A,
      tankId: 'tank-1',
      type: 'candidate_unexplained_decrease',
      status: 'candidate',
      confidence: decimal(0.6),
      volumeChangeLitres: decimal(-2500.5),
      windowStart: RECORDED_AT,
      windowEnd: RECORDED_AT,
      evidence: makeEvent().evidence,
      notes: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: RECORDED_AT,
      updatedAt: RECORDED_AT,
    });

    expect(event.volumeChangeMl).toBe(-2_500_500);
    expect(event.confidence).toBeCloseTo(0.6, 5);
    expect(event.type).toBe('candidate_unexplained_decrease');
  });

  it('reads and writes a raw device message', () => {
    const record = makeRawMessage({ payload: { levelMm: 2000, vendorFrame: 'AA' } });
    const input = toPrismaRawMessageInput(record);

    expect(input.messageHash).toBe('hash-1');
    expect(input.receivedAt).toEqual(RECORDED_AT);

    const restored = toDomainRawMessage({
      id: input.id,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      protocol: input.protocol,
      payload: input.payload,
      messageHash: input.messageHash,
      receivedAt: input.receivedAt,
    });
    expect(restored.payload).toEqual({ levelMm: 2000, vendorFrame: 'AA' });
  });
});
