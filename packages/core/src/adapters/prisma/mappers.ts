import type { Site } from '../../domain/site.js';
import type { Tank } from '../../domain/tank.js';
import type { TankReading } from '../../domain/reading.js';
import type { Alarm, AlarmType } from '../../domain/alarm.js';
import type { SiteId, TankId, TenantId, ReadingId, AlarmId } from '../../types/ids.js';

// -------------------- JSON columns --------------------

/**
 * Values accepted by a Prisma `Json` column.
 *
 * Prisma declares JSON input as an index-signature based type, and interfaces
 * do not receive implicit index signatures, so domain objects (geometry,
 * alarm metrics) are copied into plain literals that satisfy this shape. The
 * mapping is explicit rather than a cast so a widening of the domain types is
 * caught at compile time instead of at the database boundary.
 */
export type JsonInputValue = string | number | boolean | JsonInputObject | JsonInputArray;

export type JsonInputArray = ReadonlyArray<JsonInputValue | null>;

export type JsonInputObject = { readonly [key: string]: JsonInputValue | null };

// -------------------- Site <-> Station --------------------

export function toPrismaStationStatus(status: Site['status']): 'active' | 'inactive' {
  return status === 'active' ? 'active' : 'inactive';
}

export function toDomainSiteStatus(status: string): Site['status'] {
  return status === 'inactive' ? 'inactive' : 'active';
}

export function toDomainSite(row: {
  id: string;
  tenantId: string;
  name: string;
  timezone: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Site {
  return {
    id: row.id as SiteId,
    tenantId: row.tenantId as TenantId,
    name: row.name,
    timezone: row.timezone,
    status: toDomainSiteStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPrismaStationInput(site: Site): {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  timezone: string;
  status: 'active' | 'inactive';
} {
  return {
    id: site.id,
    tenantId: site.tenantId,
    name: site.name,
    code: site.id, // code must be unique per tenant, use id
    timezone: site.timezone,
    status: toPrismaStationStatus(site.status),
  };
}

// -------------------- Tank --------------------

type FuelProductDomain = Tank['product'];
type FuelProductPrisma = 'diesel' | 'petrol_91' | 'petrol_95' | 'kerosene' | 'adblue';

export function toPrismaFuelProduct(product: FuelProductDomain): FuelProductPrisma {
  switch (product) {
    case 'diesel':
      return 'diesel';
    case 'petrol-91':
      return 'petrol_91';
    case 'petrol-95':
      return 'petrol_95';
    case 'kerosene':
      return 'kerosene';
    case 'adblue':
      return 'adblue';
    default:
      return 'diesel';
  }
}

export function toDomainFuelProduct(product: string): FuelProductDomain {
  switch (product) {
    case 'diesel':
      return 'diesel';
    case 'petrol_91':
      return 'petrol-91';
    case 'petrol_95':
      return 'petrol-95';
    case 'kerosene':
      return 'kerosene';
    case 'adblue':
      return 'adblue';
    default:
      return 'diesel';
  }
}

export function toDomainTank(row: {
  id: string;
  tenantId: string;
  stationId: string;
  name: string;
  product: string;
  capacityLitres: { toNumber(): number } | number;
  geometry: unknown;
  criticalLowPercent: { toNumber(): number } | number;
  lowPercent: { toNumber(): number } | number;
  highPercent: { toNumber(): number } | number;
  waterAlarmMm: { toNumber(): number } | number;
  unexplainedDecreaseLitresPerHour: { toNumber(): number } | number;
  deliveryMinLitres: { toNumber(): number } | number;
  deliveryWindowMinutes: number;
  staleAfterMinutes: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Tank {
  const toNum = (v: { toNumber(): number } | number): number =>
    typeof v === 'number' ? v : v.toNumber();

  return {
    id: row.id as TankId,
    tenantId: row.tenantId as TenantId,
    siteId: row.stationId as SiteId,
    name: row.name,
    product: toDomainFuelProduct(row.product),
    geometry: (row.geometry as Tank['geometry']) ?? {
      kind: 'vertical-cylinder',
      diameterMm: 2000,
      heightMm: 3000,
    },
    capacityLitres: toNum(row.capacityLitres),
    thresholds: {
      criticalLowPercent: toNum(row.criticalLowPercent),
      lowPercent: toNum(row.lowPercent),
      highPercent: toNum(row.highPercent),
      waterAlarmMm: toNum(row.waterAlarmMm),
      rapidDropLitresPerHour: toNum(row.unexplainedDecreaseLitresPerHour),
      deliveryLitres: toNum(row.deliveryMinLitres),
      deliveryWindowMinutes: row.deliveryWindowMinutes,
      staleAfterMinutes: row.staleAfterMinutes,
    },
    status: row.status === 'decommissioned' ? 'decommissioned' : 'active',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPrismaGeometry(geometry: Tank['geometry']): JsonInputValue {
  switch (geometry.kind) {
    case 'vertical-cylinder':
      return {
        kind: geometry.kind,
        diameterMm: geometry.diameterMm,
        heightMm: geometry.heightMm,
      };
    case 'horizontal-cylinder':
      return {
        kind: geometry.kind,
        diameterMm: geometry.diameterMm,
        lengthMm: geometry.lengthMm,
      };
    case 'strapping-table':
      return {
        kind: geometry.kind,
        points: geometry.points.map((point) => ({
          levelMm: point.levelMm,
          volumeLitres: point.volumeLitres,
        })),
      };
  }
}

export function toPrismaTankInput(tank: Tank): {
  id: string;
  tenantId: string;
  stationId: string;
  name: string;
  product: FuelProductPrisma;
  capacityLitres: number;
  geometry: JsonInputValue;
  criticalLowPercent: number;
  lowPercent: number;
  highPercent: number;
  waterAlarmMm: number;
  unexplainedDecreaseLitresPerHour: number;
  deliveryMinLitres: number;
  deliveryWindowMinutes: number;
  staleAfterMinutes: number;
  status: 'active' | 'decommissioned';
} {
  return {
    id: tank.id,
    tenantId: tank.tenantId,
    stationId: tank.siteId,
    name: tank.name,
    product: toPrismaFuelProduct(tank.product),
    capacityLitres: tank.capacityLitres,
    geometry: toPrismaGeometry(tank.geometry),
    criticalLowPercent: tank.thresholds.criticalLowPercent,
    lowPercent: tank.thresholds.lowPercent,
    highPercent: tank.thresholds.highPercent,
    waterAlarmMm: tank.thresholds.waterAlarmMm,
    unexplainedDecreaseLitresPerHour: tank.thresholds.rapidDropLitresPerHour,
    deliveryMinLitres: tank.thresholds.deliveryLitres,
    deliveryWindowMinutes: tank.thresholds.deliveryWindowMinutes,
    staleAfterMinutes: tank.thresholds.staleAfterMinutes,
    status: tank.status,
  };
}

// -------------------- Reading --------------------

export function toDomainReading(row: {
  id: string;
  tenantId: string;
  tankId: string;
  recordedAt: Date;
  receivedAt: Date;
  levelMm: { toNumber(): number } | number;
  waterLevelMm: { toNumber(): number } | number | null;
  volumeLitres: { toNumber(): number } | number;
  temperatureC: { toNumber(): number } | number | null;
  sourceProtocol: string;
  qualityStatus: string;
  deviceId: string | null;
  idempotencyKey: string;
}): TankReading {
  const toNum = (v: { toNumber(): number } | number): number =>
    typeof v === 'number' ? v : v.toNumber();
  const toNumOrNull = (v: { toNumber(): number } | number | null): number | null =>
    v === null ? null : toNum(v);

  const level = toNum(row.levelMm);
  const water = row.waterLevelMm === null ? 0 : toNum(row.waterLevelMm);
  const volume = toNum(row.volumeLitres);

  let source: TankReading['source'] = 'device';
  if (row.sourceProtocol === 'simulated') source = 'simulated';
  else if (row.sourceProtocol === 'manual') source = 'manual';
  else source = 'device';

  return {
    id: row.id as ReadingId,
    tenantId: row.tenantId as TenantId,
    tankId: row.tankId as TankId,
    recordedAt: row.recordedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    levelMm: level,
    waterLevelMm: water,
    grossVolumeLitres: volume,
    netVolumeLitres: volume,
    temperatureC: toNumOrNull(row.temperatureC),
    source,
    quality: (row.qualityStatus as TankReading['quality']) ?? 'ok',
    deviceId: row.deviceId,
    idempotencyKey: row.idempotencyKey,
  };
}

export function toPrismaReadingInput(reading: TankReading): {
  id: string;
  tenantId: string;
  tankId: string;
  deviceId: string | null;
  recordedAt: Date;
  receivedAt: Date;
  levelMm: number;
  waterLevelMm: number;
  volumeLitres: number;
  temperatureC: number | null;
  sourceProtocol: 'simulated' | 'http' | 'manual' | 'mqtt';
  qualityStatus: 'ok' | 'suspect' | 'invalid';
  provenance: 'measured' | 'estimated' | 'manual' | 'recorded' | 'inferred';
  freshnessStatus: 'fresh';
  idempotencyKey: string;
} {
  let sourceProtocol: 'simulated' | 'http' | 'manual' | 'mqtt' = 'http';
  let provenance: 'measured' | 'estimated' | 'manual' | 'recorded' | 'inferred' = 'measured';
  if (reading.source === 'simulated') {
    sourceProtocol = 'simulated';
    provenance = 'estimated';
  } else if (reading.source === 'manual') {
    sourceProtocol = 'manual';
    provenance = 'manual';
  } else {
    sourceProtocol = 'http';
    provenance = 'measured';
  }

  return {
    id: reading.id,
    tenantId: reading.tenantId,
    tankId: reading.tankId,
    deviceId: null, // avoid FK violation if device doesn't exist; store null
    recordedAt: new Date(reading.recordedAt),
    receivedAt: new Date(reading.receivedAt),
    levelMm: reading.levelMm,
    waterLevelMm: reading.waterLevelMm,
    volumeLitres: reading.netVolumeLitres,
    temperatureC: reading.temperatureC,
    sourceProtocol,
    qualityStatus: reading.quality,
    provenance,
    freshnessStatus: 'fresh',
    idempotencyKey: reading.idempotencyKey,
  };
}

// -------------------- Alarm --------------------

/** Alert enums as declared by the Prisma schema. */
export type AlertTypePrisma =
  | 'low_stock'
  | 'critical_stock'
  | 'device_offline'
  | 'stale_data'
  | 'probe_quality'
  | 'candidate_delivery'
  | 'candidate_unexplained_decrease'
  | 'water_level';

export type AlertSeverityPrisma = 'info' | 'warning' | 'critical';

export type AlertStatusPrisma = 'open' | 'acknowledged' | 'resolved';

const ALARM_TO_ALERT: Record<AlarmType, AlertTypePrisma> = {
  'critical-low-level': 'critical_stock',
  'low-level': 'low_stock',
  'high-level': 'low_stock',
  'rapid-drop': 'candidate_unexplained_decrease',
  'water-ingress': 'water_level',
  'sensor-fault': 'probe_quality',
  'stale-reading': 'stale_data',
  'delivery-detected': 'candidate_delivery',
};

const ALERT_TO_ALARM: Record<string, AlarmType> = {
  critical_stock: 'critical-low-level',
  low_stock: 'low-level',
  device_offline: 'sensor-fault',
  stale_data: 'stale-reading',
  probe_quality: 'sensor-fault',
  candidate_delivery: 'delivery-detected',
  candidate_unexplained_decrease: 'rapid-drop',
  water_level: 'water-ingress',
};

export function toPrismaAlertType(type: AlarmType): AlertTypePrisma {
  return ALARM_TO_ALERT[type];
}

export function toDomainAlarmType(type: string): AlarmType {
  return (ALERT_TO_ALARM[type] as AlarmType) ?? 'low-level';
}

export function toDomainAlarm(row: {
  id: string;
  tenantId: string;
  tankId: string | null;
  type: string;
  severity: string;
  status: string;
  message: string;
  metrics: unknown;
  raisedAt: Date;
  updatedAt: Date;
}): Alarm {
  // Metrics may contain _readingId stored by us
  const rawMetrics = (row.metrics as Record<string, unknown>) ?? {};
  const metrics: Record<string, number> = {};
  let readingId: string | null = null;

  for (const [k, v] of Object.entries(rawMetrics)) {
    if (k === '_readingId' && typeof v === 'string') {
      readingId = v;
    } else if (typeof v === 'number') {
      metrics[k] = v;
    }
  }

  return {
    id: row.id as AlarmId,
    tenantId: row.tenantId as TenantId,
    tankId: (row.tankId ?? 'unknown-tank') as TankId,
    type: toDomainAlarmType(row.type),
    severity: (row.severity as Alarm['severity']) ?? 'warning',
    status: (row.status as Alarm['status']) ?? 'open',
    message: row.message,
    raisedAt: row.raisedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    readingId: readingId as ReadingId | null,
    metrics,
  };
}

export function toPrismaAlertInput(alarm: Alarm): {
  id: string;
  tenantId: string;
  tankId: string | null;
  type: AlertTypePrisma;
  severity: AlertSeverityPrisma;
  status: AlertStatusPrisma;
  message: string;
  metrics: JsonInputObject;
  raisedAt: Date;
} {
  // Metrics are assembled as a mutable record because the reading reference is
  // only added when the alarm carries one. The value is handed to Prisma as a
  // JSON object, so the mutable record is a superset of the accepted type.
  const metrics: Record<string, JsonInputValue | null> = { ...alarm.metrics };
  if (alarm.readingId) {
    metrics._readingId = alarm.readingId;
  }

  return {
    id: alarm.id,
    tenantId: alarm.tenantId,
    tankId: alarm.tankId,
    type: toPrismaAlertType(alarm.type),
    severity: alarm.severity,
    status: alarm.status,
    message: alarm.message,
    metrics,
    raisedAt: new Date(alarm.raisedAt),
  };
}
