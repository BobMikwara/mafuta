import { DEFAULT_TANK_THRESHOLDS, type Tank, type TankThresholds } from '../src/domain/tank.js';
import type { Alarm } from '../src/domain/alarm.js';
import type { Site } from '../src/domain/site.js';
import type { TankReading } from '../src/domain/reading.js';
import type { ReadingQuality, ReadingSource } from '../src/domain/reading.js';
import type { TankGeometry } from '../src/domain/geometry.js';
import {
  toAlarmId,
  toReadingId,
  toSiteId,
  toTankId,
  toTenantId,
  type AlarmId,
  type ReadingId,
  type SiteId,
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

export function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id: toSiteId('site-1'),
    tenantId: TENANT_A,
    name: 'Test Site',
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
    siteId: toSiteId('site-1'),
    name: 'Diesel Tank 1',
    product: 'diesel',
    geometry: DEFAULT_TEST_GEOMETRY,
    capacityLitres: 19_000,
    thresholds: DEFAULT_TANK_THRESHOLDS,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeThresholds(overrides: Partial<TankThresholds> = {}): TankThresholds {
  return { ...DEFAULT_TANK_THRESHOLDS, ...overrides };
}

export function makeReading(overrides: Partial<TankReading> = {}): TankReading {
  return {
    id: toReadingId('rdg-1'),
    tenantId: TENANT_A,
    tankId: toTankId('tank-1'),
    recordedAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:00.000Z',
    levelMm: 2000,
    waterLevelMm: 2,
    grossVolumeLitres: 9817.48,
    netVolumeLitres: 9807.68,
    temperatureC: 24,
    source: 'device' as ReadingSource,
    quality: 'ok' as ReadingQuality,
    deviceId: null,
    idempotencyKey: 'idem-factory-default',
    ...overrides,
  };
}

export function makeAlarm(overrides: Partial<Alarm> = {}): Alarm {
  return {
    id: toAlarmId('alarm-1'),
    tenantId: TENANT_A,
    tankId: toTankId('tank-1'),
    type: 'low-level',
    severity: 'warning',
    status: 'open',
    message: 'Low level',
    raisedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    readingId: null,
    metrics: {},
    ...overrides,
  };
}

export function tankId(value: string): TankId {
  return toTankId(value);
}

export function siteId(value: string): SiteId {
  return toSiteId(value);
}

export function tenantId(value: string): TenantId {
  return toTenantId(value);
}

export function readingId(value: string): ReadingId {
  return toReadingId(value);
}

export function alarmId(value: string): AlarmId {
  return toAlarmId(value);
}
