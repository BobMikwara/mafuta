import type { Alert } from '../src/domain/alert.js';
import type { AuditLogEntry } from '../src/domain/audit.js';
import type { Delivery } from '../src/domain/delivery.js';
import type { Device, DeviceAssignment } from '../src/domain/device.js';
import type { FuelEvent, FuelEventEvidence } from '../src/domain/event.js';
import type { TankGeometry } from '../src/domain/geometry.js';
import { DEFAULT_TANK_THRESHOLDS, type Tank, type TankThresholds } from '../src/domain/tank.js';
import type { Station } from '../src/domain/station.js';
import type { TankReading, ReadingSource } from '../src/domain/reading.js';
import type { RawMessageRecord } from '../src/ports/repositories.js';
import {
  toAlertId,
  toDeviceId,
  toFuelEventId,
  toReadingId,
  toStationId,
  toTankId,
  toTenantId,
  type AlertId,
  type DeviceId,
  type FuelEventId,
  type ReadingId,
  type StationId,
  type TankId,
  type TenantId,
} from '../src/types/ids.js';

export const TENANT_A = toTenantId('tenant-a');
export const TENANT_B = toTenantId('tenant-b');

export const DEFAULT_TEST_GEOMETRY: TankGeometry = {
  kind: 'vertical-cylinder',
  diameterMm: 2500,
  heightMm: 4000,
};

export function makeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: toStationId('station-1'),
    tenantId: TENANT_A,
    name: 'Test Station',
    code: 'TST-01',
    timezone: 'Africa/Nairobi',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeTank(overrides: Partial<Tank> = {}): Tank {
  return {
    id: toTankId('tank-1'),
    tenantId: TENANT_A,
    stationId: toStationId('station-1'),
    name: 'Diesel Tank 1',
    product: 'diesel',
    geometry: DEFAULT_TEST_GEOMETRY,
    capacityLitres: 19_000,
    thresholds: DEFAULT_TANK_THRESHOLDS,
    status: 'active',
    calibrationSource: null,
    calibrationAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeThresholds(overrides: Partial<TankThresholds> = {}): TankThresholds {
  return { ...DEFAULT_TANK_THRESHOLDS, ...overrides };
}

const PROTOCOL_FOR_SOURCE: Record<ReadingSource, TankReading['sourceProtocol']> = {
  device: 'http',
  simulated: 'simulated',
  manual: 'manual',
};

export function makeReading(overrides: Partial<TankReading> = {}): TankReading {
  const source: ReadingSource = overrides.source ?? 'device';
  return {
    id: toReadingId('rdg-1'),
    tenantId: TENANT_A,
    tankId: toTankId('tank-1'),
    recordedAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:00.000Z',
    levelMm: 2000,
    waterLevelMm: 5,
    grossVolumeLitres: 9817.477,
    netVolumeLitres: 9807.68,
    temperatureC: 24,
    source,
    quality: 'ok',
    provenance: source === 'manual' ? 'manual' : 'measured',
    sourceProtocol: PROTOCOL_FOR_SOURCE[source],
    freshness: 'fresh',
    signalQualityPercent: 92,
    deviceId: null,
    rawMessageId: null,
    qualityReason: null,
    idempotencyKey: 'idem-factory-default',
    ...overrides,
  };
}

export function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: toAlertId('alt-1'),
    tenantId: TENANT_A,
    tankId: toTankId('tank-1'),
    type: 'low_stock',
    severity: 'warning',
    status: 'open',
    message: 'Low stock',
    raisedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    readingId: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    assignedTo: null,
    resolvedAt: null,
    resolvedBy: null,
    metrics: {},
    ...overrides,
  };
}

export function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: toDeviceId('dev-1'),
    tenantId: TENANT_A,
    manufacturer: 'Acme',
    model: 'Probe 3000',
    serialNumber: 'SN-0001',
    protocol: 'http',
    firmwareVersion: '1.4.2',
    status: 'active',
    connectionState: 'online',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    credentialRef: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeAssignment(overrides: Partial<DeviceAssignment> = {}): DeviceAssignment {
  return {
    id: 'asg-1',
    tenantId: TENANT_A,
    deviceId: toDeviceId('dev-1'),
    tankId: toTankId('tank-1'),
    status: 'active',
    assignedAt: '2026-01-01T00:00:00.000Z',
    unassignedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeEvidence(overrides: Partial<FuelEventEvidence> = {}): FuelEventEvidence {
  return {
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-01-01T00:30:00.000Z',
    windowMinutes: 30,
    volumeBeforeMl: 5_000_000,
    volumeAfterMl: 15_000_000,
    volumeChangeMl: 10_000_000,
    readingIds: ['rdg-1', 'rdg-2'],
    firstReadingId: toReadingId('rdg-1'),
    lastReadingId: toReadingId('rdg-2'),
    thresholdLitresPerHour: null,
    thresholdLitres: 300,
    rule: 'Rise sustained within the delivery window',
    suspectReadingIds: [],
    dataQuality: 'ok',
    possibleExplanations: ['Fuel delivery recorded by the supplier'],
    investigationRequired: true,
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<FuelEvent> = {}): FuelEvent {
  return {
    id: toFuelEventId('evt-1'),
    tenantId: TENANT_A,
    tankId: toTankId('tank-1'),
    type: 'candidate_delivery',
    status: 'candidate',
    confidence: 0.75,
    volumeChangeMl: 10_000_000,
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-01-01T00:30:00.000Z',
    evidence: makeEvidence(),
    notes: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-01-01T00:30:00.000Z',
    updatedAt: '2026-01-01T00:30:00.000Z',
    ...overrides,
  };
}

export function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'dlv-1',
    tenantId: TENANT_A,
    tankId: toTankId('tank-1'),
    fuelEventId: toFuelEventId('evt-1'),
    measuredVolumeMl: 10_000_000,
    recordedVolumeMl: 10_000_000,
    reference: null,
    supplier: null,
    confirmedBy: 'key:test',
    confirmedAt: '2026-01-01T01:00:00.000Z',
    createdAt: '2026-01-01T01:00:00.000Z',
    ...overrides,
  };
}

export function makeAuditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'aud-1',
    tenantId: TENANT_A,
    actorType: 'system',
    actorReference: 'key:test',
    actorDeviceId: null,
    action: 'tank.created',
    resourceType: 'tank',
    resourceId: 'tank-1',
    ipHash: null,
    metadata: {},
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeRawMessage(overrides: Partial<RawMessageRecord> = {}): RawMessageRecord {
  return {
    id: 'raw-1' as RawMessageRecord['id'],
    tenantId: TENANT_A,
    deviceId: toDeviceId('dev-1'),
    protocol: 'http',
    payload: { levelMm: 2000 },
    messageHash: 'hash-1',
    receivedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function tankId(value: string): TankId {
  return toTankId(value);
}

export function stationId(value: string): StationId {
  return toStationId(value);
}

export function tenantId(value: string): TenantId {
  return toTenantId(value);
}

export function readingId(value: string): ReadingId {
  return toReadingId(value);
}

export function alertId(value: string): AlertId {
  return toAlertId(value);
}

export function deviceId(value: string): DeviceId {
  return toDeviceId(value);
}

export function eventId(value: string): FuelEventId {
  return toFuelEventId(value);
}
