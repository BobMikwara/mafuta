import { describe, expect, it } from 'vitest';
import {
  toDomainAlert,
  toDomainAlertType,
  toDomainAssignment,
  toDomainAuditEntry,
  toDomainDelivery,
  toDomainDevice,
  toDomainFuelEvent,
  toDomainFuelProduct,
  toDomainRawMessage,
  toDomainReading,
  toDomainStation,
  toDomainStationStatus,
  toDomainTank,
  toPrismaAlertInput,
  toPrismaAlertType,
  toPrismaAssignmentInput,
  toPrismaDeliveryInput,
  toPrismaDeviceInput,
  toPrismaFuelEventInput,
  toPrismaGeometry,
  toPrismaRawMessageInput,
  toPrismaTankInput,
  type AlertRow,
  type AssignmentRow,
  type AuditRow,
  type DeliveryRow,
  type DeviceRow,
  type FuelEventRow,
  type RawMessageRow,
  type ReadingRow,
  type TankRow,
} from '../src/adapters/prisma/mappers.js';
import type { Alert } from '../src/domain/alert.js';
import type { FuelEvent } from '../src/domain/event.js';
import {
  makeAlert,
  makeAssignment,
  makeDelivery,
  makeEvent,
  makeEvidence,
  makeRawMessage,
  makeTank,
} from './factories.js';

/**
 * The nullable and alternate paths of every mapper: rows whose optional
 * columns are absent, decimal columns arriving as Prisma Decimal-shaped
 * objects or strings, unknown enum spellings, and dates arriving as strings.
 * The database may hold any of these forms, and each must land on the same
 * domain representation.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z');

function tankRow(overrides: Record<string, unknown> = {}): TankRow {
  return {
    id: 'tank-1',
    tenantId: 'tenant-a',
    stationId: 'station-1',
    name: 'T1',
    product: 'diesel',
    capacityLitres: 19_000,
    geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
    calibrationSource: null,
    calibrationAt: null,
    criticalLowPercent: 10,
    lowPercent: 20,
    highPercent: 95,
    waterAlarmMm: 50,
    unexplainedDecreaseLitresPerHour: 400,
    deliveryMinLitres: 300,
    deliveryWindowMinutes: 30,
    staleAfterMinutes: 60,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('decimal and date coercion', () => {
  it('accepts Prisma Decimal-shaped objects and strings on tank columns', () => {
    const fromObject = toDomainTank(
      tankRow({
        capacityLitres: { toNumber: () => 15_000 },
        criticalLowPercent: { toNumber: () => 5 },
        lowPercent: '20.5',
        highPercent: '95',
        waterAlarmMm: '50',
        unexplainedDecreaseLitresPerHour: '400',
        deliveryMinLitres: { toNumber: () => 300 },
      }),
    );
    expect(fromObject.capacityLitres).toBe(15_000);
    expect(fromObject.thresholds.criticalLowPercent).toBe(5);
    expect(fromObject.thresholds.lowPercent).toBe(20.5);
  });

  it('treats missing nullables as null and keeps set values', () => {
    const empty = toDomainTank(
      tankRow({
        calibrationSource: undefined,
        calibrationAt: undefined,
        geometry: null,
      }),
    );
    expect(empty.calibrationSource).toBeNull();
    expect(empty.calibrationAt).toBeNull();
    expect(empty.geometry).toEqual({
      kind: 'vertical-cylinder',
      diameterMm: 2000,
      heightMm: 3000,
    });

    const full = toDomainTank(tankRow({ calibrationSource: 'manual-dip', calibrationAt: NOW }));
    expect(full.calibrationSource).toBe('manual-dip');
    expect(full.calibrationAt).toBe(NOW.toISOString());
  });

  it('round-trips calibration timestamps through the Prisma input', () => {
    expect(toPrismaTankInput(makeTank({ calibrationAt: null })).calibrationAt).toBeNull();
    const withDate = toPrismaTankInput(makeTank({ calibrationAt: NOW.toISOString() }));
    expect(withDate.calibrationAt).toBeInstanceOf(Date);
    expect(withDate.calibrationAt?.toISOString()).toBe(NOW.toISOString());
  });
});

describe('enum fallbacks', () => {
  it('maps unknown station statuses and fuel products to their defaults', () => {
    expect(toDomainStationStatus('inactive')).toBe('inactive');
    expect(toDomainStationStatus('anything-else')).toBe('active');
    expect(toDomainFuelProduct('petrol_95')).toBe('petrol-95');
    expect(toDomainFuelProduct('not-a-product')).toBe('diesel');
  });

  it('normalises unknown device protocols to other', () => {
    expect(toDomainDevice({ ...deviceRow({ protocol: 'modbus_tcp' }) }).protocol).toBe(
      'modbus_tcp',
    );
    expect(toDomainDevice({ ...deviceRow({ protocol: 'carrier-pigeon' }) }).protocol).toBe('other');
  });

  it('rejects unknown alert types in both directions', () => {
    expect(toPrismaAlertType('low_stock')).toBe('low_stock');
    expect(() => toPrismaAlertType('mystery' as Alert['type'])).toThrow(/Unsupported alert type/);
    expect(toDomainAlertType('water_level')).toBe('water_level');
    expect(() => toDomainAlertType('mystery')).toThrow(/Unknown alert type/);
  });
});

describe('reading rows', () => {
  function readingRow(overrides: Record<string, unknown> = {}): ReadingRow {
    return {
      id: 'rdg-1',
      tenantId: 'tenant-a',
      tankId: 'tank-1',
      deviceId: null,
      recordedAt: NOW,
      receivedAt: NOW,
      levelMm: 2000,
      waterLevelMm: 5,
      volumeLitres: 9000,
      temperatureC: 21,
      provenance: 'measured',
      qualityStatus: 'ok',
      freshnessStatus: 'fresh',
      sourceProtocol: 'http',
      idempotencyKey: 'idem-1',
      rawMessageId: null,
      ...overrides,
    };
  }

  it('derives the source from the stored protocol spelling', () => {
    expect(toDomainReading(readingRow({ sourceProtocol: 'simulated' })).source).toBe('simulated');
    expect(toDomainReading(readingRow({ sourceProtocol: 'manual' })).source).toBe('manual');
    expect(toDomainReading(readingRow({ sourceProtocol: 'http' })).source).toBe('device');
  });

  it('defaults absent water, temperature and raw reference columns', () => {
    const reading = toDomainReading(
      readingRow({ waterLevelMm: null, temperatureC: null, rawMessageId: undefined }),
    );
    expect(reading.waterLevelMm).toBe(0);
    expect(reading.temperatureC).toBeNull();
    expect(reading.rawMessageId).toBeNull();
  });

  it('explains a degraded verdict and stays silent on a clean one', () => {
    expect(toDomainReading(readingRow({ qualityStatus: 'ok' })).qualityReason).toBeNull();
    expect(toDomainReading(readingRow({ qualityStatus: 'suspect' })).qualityReason).toContain(
      'raw payload',
    );
  });

  it('falls back to safe defaults when stored verdict columns are absent', () => {
    const degenerate = readingRow({
      qualityStatus: undefined,
      provenance: undefined,
      freshnessStatus: undefined,
      sourceProtocol: undefined,
    });
    const reading = toDomainReading(degenerate as unknown as ReadingRow);
    expect(reading.quality).toBe('ok');
    expect(reading.provenance).toBe('measured');
    expect(reading.freshness).toBe('fresh');
    expect(reading.sourceProtocol).toBe('http');
  });
});

describe('device and assignment nullables', () => {
  it('keeps absent liveness columns as null in both directions', () => {
    const row = deviceRow({ lastSeenAt: null, firmwareVersion: null, credentialRef: null });
    const device = toDomainDevice(row);
    expect(device.lastSeenAt).toBeNull();
    expect(toPrismaDeviceInput(device).lastSeenAt).toBeNull();

    const seen = toDomainDevice(deviceRow({ lastSeenAt: NOW }));
    expect(seen.lastSeenAt).toBe(NOW.toISOString());
    expect(toPrismaDeviceInput(seen).lastSeenAt).toBeInstanceOf(Date);
  });

  it('carries unassignment timestamps in both directions', () => {
    expect(
      toDomainAssignment({ ...assignmentRow({ unassignedAt: null }) }).unassignedAt,
    ).toBeNull();
    const ended = toDomainAssignment({ ...assignmentRow({ unassignedAt: NOW }) });
    expect(ended.unassignedAt).toBe(NOW.toISOString());
    expect(toPrismaAssignmentInput(ended).unassignedAt).toBeInstanceOf(Date);
    expect(toPrismaAssignmentInput(makeAssignment({ unassignedAt: null })).unassignedAt).toBeNull();
  });
});

describe('alert rows', () => {
  function alertRow(overrides: Record<string, unknown> = {}): AlertRow {
    return {
      id: 'alt-1',
      tenantId: 'tenant-a',
      tankId: 'tank-1',
      type: 'low_stock',
      severity: 'warning',
      status: 'open',
      message: 'm',
      metrics: null,
      raisedAt: NOW,
      updatedAt: NOW,
      acknowledgedAt: null,
      acknowledgedByUserId: null,
      assignedToUserId: null,
      resolvedAt: null,
      resolvedByUserId: null,
      ...overrides,
    };
  }

  it('reads metrics defensively and lifts the reading reference out of them', () => {
    const empty = toDomainAlert(alertRow({ metrics: null, tankId: null }));
    expect(empty.metrics).toEqual({});
    expect(empty.readingId).toBeNull();
    expect(empty.tankId).toBeNull();

    const mixed = toDomainAlert(
      alertRow({
        metrics: {
          _readingId: 12345,
          fillPercent: 12.5,
          label: 'low',
          active: true,
          note: null,
          nested: { dropped: true },
          items: [1, 2],
        },
      }),
    );
    expect(mixed.readingId).toBeNull();
    expect(mixed.metrics).toEqual({
      fillPercent: 12.5,
      label: 'low',
      active: true,
      note: null,
    });

    const linked = toDomainAlert(alertRow({ metrics: { _readingId: 'rdg-9' } }));
    expect(linked.readingId).toBe('rdg-9');
  });

  it('defaults absent lifecycle columns and maps set ones', () => {
    const bare = alertRow({
      acknowledgedAt: undefined,
      acknowledgedByUserId: undefined,
      assignedToUserId: undefined,
      resolvedAt: undefined,
      resolvedByUserId: undefined,
    });
    const alert = toDomainAlert(bare);
    expect(alert.acknowledgedAt).toBeNull();
    expect(alert.acknowledgedBy).toBeNull();
    expect(alert.assignedTo).toBeNull();
    expect(alert.resolvedAt).toBeNull();
    expect(alert.resolvedBy).toBeNull();

    const done = toDomainAlert(
      alertRow({
        acknowledgedAt: NOW,
        resolvedAt: NOW,
        resolvedByUserId: 'user-2',
        assignedToUserId: 'user-1',
      }),
    );
    expect(done.acknowledgedAt).toBe(NOW.toISOString());
    expect(done.resolvedAt).toBe(NOW.toISOString());
    expect(done.resolvedBy).toBe('user-2');
    expect(done.assignedTo).toBe('user-1');
  });

  it('stores the reading reference inside metrics only when present', () => {
    const without = toPrismaAlertInput(makeAlert({ readingId: null }));
    expect(without.metrics).not.toHaveProperty('_readingId');
    const withReading = toPrismaAlertInput(
      makeAlert({
        readingId: 'rdg-9' as Alert['readingId'],
        acknowledgedAt: NOW.toISOString(),
        resolvedAt: NOW.toISOString(),
      }),
    );
    expect(withReading.metrics['_readingId']).toBe('rdg-9');
    expect(withReading.acknowledgedAt).toBeInstanceOf(Date);
    expect(withReading.resolvedAt).toBeInstanceOf(Date);
    expect(
      toPrismaAlertInput(makeAlert({ acknowledgedAt: null, resolvedAt: null })).acknowledgedAt,
    ).toBeNull();
  });
});

describe('event, delivery, audit and raw rows', () => {
  function eventRow(overrides: Record<string, unknown> = {}): FuelEventRow {
    return {
      id: 'evt-1',
      tenantId: 'tenant-a',
      tankId: 'tank-1',
      type: 'candidate_delivery',
      status: 'pending',
      confidence: 0.8,
      volumeChangeLitres: 350,
      windowStart: NOW,
      windowEnd: NOW,
      evidence: null,
      notes: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }

  it('defaults missing evidence and decision columns', () => {
    const event = toDomainFuelEvent(eventRow());
    expect(event.evidence).toEqual({});
    expect(event.decidedAt).toBeNull();
    const decided = toDomainFuelEvent(eventRow({ decidedAt: NOW, notes: 'checked' }));
    expect(decided.decidedAt).toBe(NOW.toISOString());
    expect(decided.notes).toBe('checked');
  });

  it('maps decisions back to Prisma with both decidedAt forms', () => {
    expect(toPrismaFuelEventInput(makeEvent({ decidedAt: null })).decidedAt).toBeNull();
    const input = toPrismaFuelEventInput(
      makeEvent({
        decidedAt: NOW.toISOString() as FuelEvent['decidedAt'],
        evidence: makeEvidence(),
      }),
    );
    expect(input.decidedAt).toBeInstanceOf(Date);
    expect(input.volumeChangeLitres).toBeTypeOf('string');
  });

  it('defaults delivery supplier and event links in both directions', () => {
    const bare = toDomainDelivery({ ...deliveryRow({ supplier: undefined, fuelEventId: null }) });
    expect(bare.supplier).toBeNull();
    expect(bare.fuelEventId).toBeNull();
    const linked = toDomainDelivery({ ...deliveryRow({ supplier: 'Puma', fuelEventId: 'evt-1' }) });
    expect(linked.supplier).toBe('Puma');
    expect(linked.fuelEventId).toBe('evt-1');
    expect(toPrismaDeliveryInput(makeDelivery({ recordedVolumeMl: 350_000 })).volumeLitres).toBe(
      '350.000',
    );
  });

  it('filters audit metadata to primitives and keeps tenant-less entries readable', () => {
    const row: AuditRow = {
      id: 'aud-1',
      tenantId: null,
      actorType: 'system',
      actorUserId: null,
      actorDeviceId: null,
      action: 'health.ping',
      resourceType: 'system',
      resourceId: null,
      ipHash: null,
      metadata: { ok: true, count: 3, label: 'x', missing: null, nested: { no: 1 }, list: [1] },
      occurredAt: NOW,
    };
    const entry = toDomainAuditEntry(row);
    expect(entry.tenantId).toBeNull();
    expect(entry.metadata).toEqual({ ok: true, count: 3, label: 'x', missing: null });

    const emptyMeta = toDomainAuditEntry({ ...row, metadata: null });
    expect(emptyMeta.metadata).toEqual({});
  });

  it('tolerates null raw payloads in both directions', () => {
    const record = toDomainRawMessage(rawRow({ deviceId: null }));
    expect(record.deviceId).toBeNull();
    expect(toPrismaRawMessageInput(makeRawMessage({ payload: null })).payload).toBeNull();
    expect(toPrismaRawMessageInput(makeRawMessage({ payload: { a: 1 } })).payload).toEqual({
      a: 1,
    });
  });
});

describe('geometry json', () => {
  it('renders every supported geometry kind for storage', () => {
    expect(toPrismaGeometry({ kind: 'vertical-cylinder', diameterMm: 1, heightMm: 2 })).toEqual({
      kind: 'vertical-cylinder',
      diameterMm: 1,
      heightMm: 2,
    });
    expect(toPrismaGeometry({ kind: 'horizontal-cylinder', diameterMm: 1, lengthMm: 5 })).toEqual({
      kind: 'horizontal-cylinder',
      diameterMm: 1,
      lengthMm: 5,
    });
    expect(
      toPrismaGeometry({
        kind: 'strapping-table',
        points: [{ levelMm: 0, volumeLitres: 0 }],
      }),
    ).toEqual({ kind: 'strapping-table', points: [{ levelMm: 0, volumeLitres: 0 }] });
  });
});

describe('station row', () => {
  it('maps a station row through the shared coercions', () => {
    const station = toDomainStation({
      id: 'st-1',
      tenantId: 'tenant-a',
      name: 'N',
      code: 'C',
      timezone: 'UTC',
      status: 'inactive',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(station.status).toBe('inactive');
    expect(station.createdAt).toBe(NOW.toISOString());
  });
});

function deviceRow(overrides: Record<string, unknown> = {}): DeviceRow {
  return {
    id: 'dev-1',
    tenantId: 'tenant-a',
    manufacturer: 'Acme',
    model: 'P2',
    serialNumber: 'SN-1',
    protocol: 'http',
    firmwareVersion: null,
    status: 'active',
    connectionState: 'online',
    lastSeenAt: null,
    credentialRef: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function assignmentRow(overrides: Record<string, unknown> = {}): AssignmentRow {
  return {
    id: 'asg-1',
    tenantId: 'tenant-a',
    deviceId: 'dev-1',
    tankId: 'tank-1',
    status: 'active',
    assignedAt: NOW,
    unassignedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function deliveryRow(overrides: Record<string, unknown> = {}): DeliveryRow {
  return {
    id: 'dly-1',
    tenantId: 'tenant-a',
    tankId: 'tank-1',
    fuelEventId: null,
    volumeLitres: { toNumber: () => 350 },
    reference: null,
    supplier: null,
    confirmedByUserId: 'user-1',
    confirmedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function rawRow(overrides: Record<string, unknown> = {}): RawMessageRow {
  return {
    id: 'raw-1',
    tenantId: 'tenant-a',
    deviceId: null,
    protocol: 'http',
    payload: null,
    messageHash: 'hash-1',
    receivedAt: NOW,
    ...overrides,
  };
}
