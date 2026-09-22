import type { Alert, AlertSeverity, AlertStatus, AlertType } from '../../domain/alert.js';
import type { AuditActorType, AuditLogEntry, AuditMetadata } from '../../domain/audit.js';
import type { Delivery } from '../../domain/delivery.js';
import type {
  AssignmentStatus,
  Device,
  DeviceAssignment,
  DeviceConnectionState,
  DeviceProtocol,
  DeviceStatus,
} from '../../domain/device.js';
import type {
  FuelEvent,
  FuelEventEvidence,
  FuelEventStatus,
  FuelEventType,
} from '../../domain/event.js';
import { litresString } from '../../domain/quantity.js';
import type { ReadingFreshness, ReadingProvenance, TankReading } from '../../domain/reading.js';
import type { Station, StationStatus } from '../../domain/station.js';
import type { Tank, TankStatus } from '../../domain/tank.js';
import type { RawMessageRecord } from '../../ports/repositories.js';
import type {
  AlertId,
  DeliveryId,
  DeviceId,
  FuelEventId,
  RawMessageId,
  ReadingId,
  StationId,
  TankId,
  TenantId,
} from '../../types/ids.js';

/**
 * Domain to Prisma mapping.
 *
 * Every conversion in both directions lives here so the storage shape of the
 * database is never assumed by a service. Values that PostgreSQL holds as
 * `Decimal` are converted with `toNumber`/`litresString` from
 * `domain/quantity.ts`, which keeps the three decimal litre contract.
 */

// -------------------- JSON columns --------------------

/**
 * Values accepted by a Prisma `Json` column. Prisma declares JSON input as an
 * index-signature based type, so domain objects are copied into plain literals
 * that satisfy this shape. The mapping is explicit rather than a cast so a
 * widening of a domain type is caught at compile time, not at the database.
 */
export type JsonInputValue = string | number | boolean | JsonInputObject | JsonInputArray;
export type JsonInputArray = ReadonlyArray<JsonInputValue | null>;
export type JsonInputObject = { readonly [key: string]: JsonInputValue | null };

type DecimalLike = { toNumber(): number } | number | string;

function toNumber(value: DecimalLike): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return value.toNumber();
}

function toNumberOrNull(value: DecimalLike | null): number | null {
  return value === null ? null : toNumber(value);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toIso(value: Date | string): string {
  return toDate(value).toISOString();
}

// -------------------- Station --------------------

export function toPrismaStationStatus(status: StationStatus): 'active' | 'inactive' {
  return status;
}

export function toDomainStationStatus(status: string): StationStatus {
  return status === 'inactive' ? 'inactive' : 'active';
}

export function toDomainStation(row: {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  timezone: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Station {
  return {
    id: row.id as StationId,
    tenantId: row.tenantId as TenantId,
    name: row.name,
    code: row.code,
    timezone: row.timezone,
    status: toDomainStationStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPrismaStationInput(station: Station): {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  timezone: string;
  status: 'active' | 'inactive';
} {
  return {
    id: station.id,
    tenantId: station.tenantId,
    name: station.name,
    code: station.code,
    timezone: station.timezone,
    status: toPrismaStationStatus(station.status),
  };
}

// -------------------- Tank --------------------

type FuelProductDomain = Tank['product'];
type FuelProductPrisma = 'diesel' | 'petrol_91' | 'petrol_95' | 'kerosene' | 'adblue';

const PRODUCT_TO_PRISMA: Record<FuelProductDomain, FuelProductPrisma> = {
  diesel: 'diesel',
  'petrol-91': 'petrol_91',
  'petrol-95': 'petrol_95',
  kerosene: 'kerosene',
  adblue: 'adblue',
};

const PRODUCT_TO_DOMAIN: Record<string, FuelProductDomain> = {
  diesel: 'diesel',
  petrol_91: 'petrol-91',
  petrol_95: 'petrol-95',
  kerosene: 'kerosene',
  adblue: 'adblue',
};

export function toPrismaFuelProduct(product: FuelProductDomain): FuelProductPrisma {
  return PRODUCT_TO_PRISMA[product];
}

export function toDomainFuelProduct(product: string): FuelProductDomain {
  return PRODUCT_TO_DOMAIN[product] ?? 'diesel';
}

export interface TankRow {
  id: string;
  tenantId: string;
  stationId: string;
  name: string;
  product: string;
  capacityLitres: DecimalLike;
  geometry: unknown;
  calibrationSource?: string | null;
  calibrationAt?: Date | null;
  criticalLowPercent: DecimalLike;
  lowPercent: DecimalLike;
  highPercent: DecimalLike;
  waterAlarmMm: DecimalLike;
  unexplainedDecreaseLitresPerHour: DecimalLike;
  deliveryMinLitres: DecimalLike;
  deliveryWindowMinutes: number;
  staleAfterMinutes: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export function toDomainTank(row: TankRow): Tank {
  return {
    id: row.id as TankId,
    tenantId: row.tenantId as TenantId,
    stationId: row.stationId as StationId,
    name: row.name,
    product: toDomainFuelProduct(row.product),
    geometry: (row.geometry as Tank['geometry']) ?? {
      kind: 'vertical-cylinder',
      diameterMm: 2000,
      heightMm: 3000,
    },
    capacityLitres: toNumber(row.capacityLitres),
    thresholds: {
      criticalLowPercent: toNumber(row.criticalLowPercent),
      lowPercent: toNumber(row.lowPercent),
      highPercent: toNumber(row.highPercent),
      waterAlarmMm: toNumber(row.waterAlarmMm),
      rapidDropLitresPerHour: toNumber(row.unexplainedDecreaseLitresPerHour),
      deliveryLitres: toNumber(row.deliveryMinLitres),
      deliveryWindowMinutes: row.deliveryWindowMinutes,
      staleAfterMinutes: row.staleAfterMinutes,
    },
    status: (row.status === 'decommissioned' ? 'decommissioned' : 'active') as TankStatus,
    calibrationSource: row.calibrationSource ?? null,
    calibrationAt:
      row.calibrationAt === null || row.calibrationAt === undefined
        ? null
        : toIso(row.calibrationAt),
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
  calibrationSource: string | null;
  calibrationAt: Date | null;
} {
  return {
    id: tank.id,
    tenantId: tank.tenantId,
    stationId: tank.stationId,
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
    calibrationSource: tank.calibrationSource,
    calibrationAt: tank.calibrationAt === null ? null : new Date(tank.calibrationAt),
  };
}

// -------------------- Reading --------------------

export interface ReadingRow {
  id: string;
  tenantId: string;
  tankId: string;
  deviceId: string | null;
  recordedAt: Date;
  receivedAt: Date;
  levelMm: DecimalLike;
  waterLevelMm: DecimalLike | null;
  volumeLitres: DecimalLike;
  temperatureC: DecimalLike | null;
  provenance: string;
  qualityStatus: string;
  freshnessStatus: string;
  sourceProtocol: string;
  idempotencyKey: string;
  rawMessageId?: string | null;
}

export function toDomainReading(row: ReadingRow): TankReading {
  const volume = toNumber(row.volumeLitres);
  let source: TankReading['source'] = 'device';
  if (row.sourceProtocol === 'simulated') source = 'simulated';
  else if (row.sourceProtocol === 'manual') source = 'manual';

  return {
    id: row.id as ReadingId,
    tenantId: row.tenantId as TenantId,
    tankId: row.tankId as TankId,
    recordedAt: row.recordedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    levelMm: toNumber(row.levelMm),
    waterLevelMm: row.waterLevelMm === null ? 0 : toNumber(row.waterLevelMm),
    grossVolumeLitres: volume,
    // The schema keeps one volume column per reading, which is the net product
    // volume after water is subtracted. Gross is not stored.
    netVolumeLitres: volume,
    temperatureC: toNumberOrNull(row.temperatureC),
    source,
    quality: (row.qualityStatus as TankReading['quality']) ?? 'ok',
    provenance: (row.provenance as ReadingProvenance) ?? 'measured',
    sourceProtocol: (row.sourceProtocol as TankReading['sourceProtocol']) ?? 'http',
    freshness: (row.freshnessStatus as ReadingFreshness) ?? 'fresh',
    signalQualityPercent: null,
    deviceId: row.deviceId,
    rawMessageId: row.rawMessageId ?? null,
    qualityReason: qualityReasonFrom(row.provenance, row.qualityStatus),
    idempotencyKey: row.idempotencyKey,
  };
}

/**
 * The database stores the verdict, not the sentence that explains it. The raw
 * payload referenced by `rawMessageId` holds the sample the verdict was made
 * from, which is what an investigation needs.
 */
function qualityReasonFrom(_provenance: string, qualityStatus: string): string | null {
  return qualityStatus === 'ok' ? null : 'see the retained raw payload for this reading';
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
  freshnessStatus: 'fresh' | 'delayed' | 'stale';
  idempotencyKey: string;
  rawMessageId: string | null;
} {
  return {
    id: reading.id,
    tenantId: reading.tenantId,
    tankId: reading.tankId,
    // Null unless the device exists: the column is a foreign key, and an
    // unregistered identifier must never be written straight through.
    deviceId: reading.deviceId,
    recordedAt: new Date(reading.recordedAt),
    receivedAt: new Date(reading.receivedAt),
    levelMm: reading.levelMm,
    waterLevelMm: reading.waterLevelMm,
    volumeLitres: reading.netVolumeLitres,
    temperatureC: reading.temperatureC,
    sourceProtocol: reading.sourceProtocol,
    qualityStatus: reading.quality,
    provenance: reading.provenance,
    freshnessStatus: reading.freshness,
    idempotencyKey: reading.idempotencyKey,
    rawMessageId: reading.rawMessageId,
  };
}

// -------------------- Device --------------------

const DEVICE_PROTOCOLS: ReadonlyArray<DeviceProtocol> = [
  'simulated',
  'http',
  'mqtt',
  'modbus_rtu',
  'modbus_tcp',
  'other',
];

function toDomainProtocol(value: string): DeviceProtocol {
  return (DEVICE_PROTOCOLS as ReadonlyArray<string>).includes(value)
    ? (value as DeviceProtocol)
    : 'other';
}

export interface DeviceRow {
  id: string;
  tenantId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  protocol: string;
  firmwareVersion: string | null;
  status: string;
  connectionState: string;
  lastSeenAt: Date | null;
  credentialRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toDomainDevice(row: DeviceRow): Device {
  return {
    id: row.id as DeviceId,
    tenantId: row.tenantId as TenantId,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serialNumber,
    protocol: toDomainProtocol(row.protocol),
    firmwareVersion: row.firmwareVersion,
    status: row.status as DeviceStatus,
    connectionState: row.connectionState as DeviceConnectionState,
    lastSeenAt: row.lastSeenAt === null ? null : toIso(row.lastSeenAt),
    credentialRef: row.credentialRef,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPrismaDeviceInput(device: Device): {
  id: string;
  tenantId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  protocol: DeviceProtocol;
  firmwareVersion: string | null;
  status: DeviceStatus;
  connectionState: DeviceConnectionState;
  lastSeenAt: Date | null;
  credentialRef: string | null;
} {
  return {
    id: device.id,
    tenantId: device.tenantId,
    manufacturer: device.manufacturer,
    model: device.model,
    serialNumber: device.serialNumber,
    protocol: device.protocol,
    firmwareVersion: device.firmwareVersion,
    status: device.status,
    connectionState: device.connectionState,
    lastSeenAt: device.lastSeenAt === null ? null : new Date(device.lastSeenAt),
    credentialRef: device.credentialRef,
  };
}

export interface AssignmentRow {
  id: string;
  tenantId: string;
  deviceId: string;
  tankId: string;
  status: string;
  assignedAt: Date;
  unassignedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toDomainAssignment(row: AssignmentRow): DeviceAssignment {
  return {
    id: row.id,
    tenantId: row.tenantId as TenantId,
    deviceId: row.deviceId as DeviceId,
    tankId: row.tankId as TankId,
    status: row.status as AssignmentStatus,
    assignedAt: row.assignedAt.toISOString(),
    unassignedAt: row.unassignedAt === null ? null : toIso(row.unassignedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPrismaAssignmentInput(assignment: DeviceAssignment): {
  id: string;
  tenantId: string;
  deviceId: string;
  tankId: string;
  status: AssignmentStatus;
  assignedAt: Date;
  unassignedAt: Date | null;
} {
  return {
    id: assignment.id,
    tenantId: assignment.tenantId,
    deviceId: assignment.deviceId,
    tankId: assignment.tankId,
    status: assignment.status,
    assignedAt: new Date(assignment.assignedAt),
    unassignedAt: assignment.unassignedAt === null ? null : new Date(assignment.unassignedAt),
  };
}

// -------------------- Alert --------------------

/**
 * Alert enums as declared by the Prisma schema. The domain `AlertType` is the
 * same union, so these functions exist to fail loudly if the two ever diverge.
 */
export type AlertTypePrisma = AlertType;
export type AlertSeverityPrisma = AlertSeverity;
export type AlertStatusPrisma = AlertStatus;

const ALERT_TYPES: ReadonlyArray<string> = [
  'low_stock',
  'critical_stock',
  'device_offline',
  'stale_data',
  'probe_quality',
  'candidate_delivery',
  'candidate_unexplained_decrease',
  'water_level',
];

export function toPrismaAlertType(type: AlertType): AlertTypePrisma {
  if (!ALERT_TYPES.includes(type)) {
    throw new Error(`Unsupported alert type: ${type}`);
  }
  return type;
}

export function toDomainAlertType(type: string): AlertType {
  if (!ALERT_TYPES.includes(type)) {
    throw new Error(`Unknown alert type in storage: ${type}`);
  }
  return type as AlertType;
}

export interface AlertRow {
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
  acknowledgedAt?: Date | null;
  acknowledgedByUserId?: string | null;
  assignedToUserId?: string | null;
  resolvedAt?: Date | null;
  resolvedByUserId?: string | null;
}

/** Reading reference is carried inside the metrics JSON, which the schema lacks. */
const READING_ID_METRIC_KEY = '_readingId';

function readMetrics(raw: unknown): {
  metrics: Record<string, number | string | boolean | null>;
  readingId: ReadingId | null;
} {
  const metrics: Record<string, number | string | boolean | null> = {};
  let readingId: ReadingId | null = null;
  if (raw !== null && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key === READING_ID_METRIC_KEY) {
        readingId = typeof value === 'string' ? (value as ReadingId) : null;
        continue;
      }
      if (
        typeof value === 'number' ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        metrics[key] = value;
      }
    }
  }
  return { metrics, readingId };
}

export function toDomainAlert(row: AlertRow): Alert {
  const { metrics, readingId } = readMetrics(row.metrics);
  return {
    id: row.id as AlertId,
    tenantId: row.tenantId as TenantId,
    tankId: (row.tankId as TankId | null) ?? null,
    type: toDomainAlertType(row.type),
    severity: row.severity as AlertSeverity,
    status: row.status as AlertStatus,
    message: row.message,
    raisedAt: row.raisedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    readingId,
    acknowledgedAt:
      row.acknowledgedAt === null || row.acknowledgedAt === undefined
        ? null
        : toIso(row.acknowledgedAt),
    acknowledgedBy: row.acknowledgedByUserId ?? null,
    assignedTo: row.assignedToUserId ?? null,
    resolvedAt:
      row.resolvedAt === null || row.resolvedAt === undefined ? null : toIso(row.resolvedAt),
    resolvedBy: row.resolvedByUserId ?? null,
    metrics,
  };
}

export function toPrismaAlertInput(alert: Alert): {
  id: string;
  tenantId: string;
  tankId: string | null;
  type: AlertTypePrisma;
  severity: AlertSeverityPrisma;
  status: AlertStatusPrisma;
  message: string;
  metrics: JsonInputObject;
  raisedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedByUserId: string | null;
  assignedToUserId: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  updatedAt: Date;
} {
  const metrics: Record<string, JsonInputValue | null> = { ...alert.metrics };
  if (alert.readingId !== null) {
    metrics[READING_ID_METRIC_KEY] = alert.readingId;
  }
  return {
    id: alert.id,
    tenantId: alert.tenantId,
    tankId: alert.tankId,
    type: toPrismaAlertType(alert.type),
    severity: alert.severity,
    status: alert.status,
    message: alert.message,
    metrics,
    raisedAt: new Date(alert.raisedAt),
    acknowledgedAt: alert.acknowledgedAt === null ? null : new Date(alert.acknowledgedAt),
    acknowledgedByUserId: alert.acknowledgedBy,
    assignedToUserId: alert.assignedTo,
    resolvedAt: alert.resolvedAt === null ? null : new Date(alert.resolvedAt),
    resolvedByUserId: alert.resolvedBy,
    updatedAt: new Date(alert.updatedAt),
  };
}

// -------------------- Fuel event --------------------

export interface FuelEventRow {
  id: string;
  tenantId: string;
  tankId: string;
  type: string;
  status: string;
  confidence: DecimalLike;
  volumeChangeLitres: DecimalLike;
  windowStart: Date;
  windowEnd: Date;
  evidence: unknown;
  notes: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toDomainFuelEvent(row: FuelEventRow): FuelEvent {
  const evidence = (row.evidence ?? {}) as Partial<FuelEventEvidence>;
  return {
    id: row.id as FuelEventId,
    tenantId: row.tenantId as TenantId,
    tankId: row.tankId as TankId,
    type: row.type as FuelEventType,
    status: row.status as FuelEventStatus,
    confidence: toNumber(row.confidence),
    volumeChangeMl: Math.round(toNumber(row.volumeChangeLitres) * 1000),
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    evidence: evidence as FuelEventEvidence,
    notes: row.notes,
    decidedBy: row.decidedByUserId,
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPrismaFuelEventInput(event: FuelEvent): {
  id: string;
  tenantId: string;
  tankId: string;
  type: FuelEventType;
  status: FuelEventStatus;
  confidence: number;
  volumeChangeLitres: string;
  windowStart: Date;
  windowEnd: Date;
  evidence: JsonInputObject;
  notes: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
} {
  return {
    id: event.id,
    tenantId: event.tenantId,
    tankId: event.tankId,
    type: event.type,
    status: event.status,
    confidence: event.confidence,
    volumeChangeLitres: litresString(event.volumeChangeMl),
    windowStart: new Date(event.windowStart),
    windowEnd: new Date(event.windowEnd),
    evidence: evidenceToJson(event.evidence),
    notes: event.notes,
    decidedByUserId: event.decidedBy,
    decidedAt: event.decidedAt === null ? null : new Date(event.decidedAt),
  };
}

function evidenceToJson(evidence: FuelEventEvidence): JsonInputObject {
  return {
    windowStart: evidence.windowStart,
    windowEnd: evidence.windowEnd,
    windowMinutes: evidence.windowMinutes,
    volumeBeforeMl: evidence.volumeBeforeMl,
    volumeAfterMl: evidence.volumeAfterMl,
    volumeChangeMl: evidence.volumeChangeMl,
    readingIds: Array.from(evidence.readingIds),
    firstReadingId: evidence.firstReadingId,
    lastReadingId: evidence.lastReadingId,
    thresholdLitresPerHour: evidence.thresholdLitresPerHour,
    thresholdLitres: evidence.thresholdLitres,
    rule: evidence.rule,
    suspectReadingIds: Array.from(evidence.suspectReadingIds),
    dataQuality: evidence.dataQuality,
    possibleExplanations: Array.from(evidence.possibleExplanations),
    investigationRequired: evidence.investigationRequired,
  };
}

// -------------------- Delivery --------------------

export interface DeliveryRow {
  id: string;
  tenantId: string;
  tankId: string;
  fuelEventId: string | null;
  volumeLitres: DecimalLike;
  reference: string | null;
  supplier?: string | null;
  confirmedByUserId: string;
  confirmedAt: Date;
  createdAt: Date;
}

export function toDomainDelivery(row: DeliveryRow): Delivery {
  const volumeMl = Math.round(toNumber(row.volumeLitres) * 1000);
  return {
    id: row.id as DeliveryId,
    tenantId: row.tenantId as TenantId,
    tankId: row.tankId as TankId,
    fuelEventId: (row.fuelEventId as FuelEventId | null) ?? null,
    // The schema records one volume. It is the volume stated by the operator
    // when the delivery was confirmed; the measured volume lives on the event.
    measuredVolumeMl: volumeMl,
    recordedVolumeMl: volumeMl,
    reference: row.reference,
    supplier: row.supplier ?? null,
    confirmedBy: row.confirmedByUserId,
    confirmedAt: row.confirmedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPrismaDeliveryInput(delivery: Delivery): {
  id: string;
  tenantId: string;
  tankId: string;
  fuelEventId: string | null;
  volumeLitres: string;
  reference: string | null;
  confirmedByUserId: string;
  confirmedAt: Date;
} {
  return {
    id: delivery.id,
    tenantId: delivery.tenantId,
    tankId: delivery.tankId,
    fuelEventId: delivery.fuelEventId,
    volumeLitres: litresString(delivery.recordedVolumeMl),
    reference: delivery.reference,
    confirmedByUserId: delivery.confirmedBy,
    confirmedAt: new Date(delivery.confirmedAt),
  };
}

// -------------------- Audit log --------------------

export interface AuditRow {
  id: string;
  tenantId: string | null;
  actorType: string;
  actorUserId: string | null;
  actorDeviceId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipHash: string | null;
  metadata: unknown;
  occurredAt: Date;
}

export function toDomainAuditEntry(row: AuditRow): AuditLogEntry {
  const metadata: Record<string, string | number | boolean | null> = {};
  if (row.metadata !== null && typeof row.metadata === 'object') {
    for (const [key, value] of Object.entries(row.metadata as Record<string, unknown>)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        metadata[key] = value;
      }
    }
  }
  return {
    id: row.id,
    tenantId: (row.tenantId as TenantId | null) ?? null,
    actorType: row.actorType as AuditActorType,
    actorReference: row.actorUserId,
    actorDeviceId: row.actorDeviceId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    ipHash: row.ipHash,
    metadata,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export function toPrismaAuditInput(entry: AuditLogEntry): {
  id: string;
  tenantId: string | null;
  actorType: AuditActorType;
  actorUserId: string | null;
  actorDeviceId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipHash: string | null;
  metadata: JsonInputObject;
  occurredAt: Date;
} {
  const metadata: Record<string, JsonInputValue | null> = { ...(entry.metadata as AuditMetadata) };
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    actorType: entry.actorType,
    actorUserId: entry.actorReference,
    actorDeviceId: entry.actorDeviceId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    ipHash: entry.ipHash,
    metadata,
    occurredAt: new Date(entry.occurredAt),
  };
}

// -------------------- Raw device message --------------------

export interface RawMessageRow {
  id: string;
  tenantId: string;
  deviceId: string | null;
  protocol: string;
  payload: unknown;
  messageHash: string;
  receivedAt: Date;
}

export function toDomainRawMessage(row: RawMessageRow): RawMessageRecord {
  return {
    id: row.id as RawMessageId,
    tenantId: row.tenantId as TenantId,
    deviceId: (row.deviceId as DeviceId | null) ?? null,
    protocol: row.protocol as RawMessageRecord['protocol'],
    payload: row.payload,
    messageHash: row.messageHash,
    receivedAt: row.receivedAt.toISOString(),
  };
}

export function toPrismaRawMessageInput(record: RawMessageRecord): {
  id: string;
  tenantId: string;
  deviceId: string | null;
  protocol: RawMessageRecord['protocol'];
  payload: JsonInputValue;
  messageHash: string;
  receivedAt: Date;
} {
  return {
    id: record.id,
    tenantId: record.tenantId,
    deviceId: record.deviceId,
    protocol: record.protocol,
    payload: (record.payload ?? null) as JsonInputValue,
    messageHash: record.messageHash,
    receivedAt: new Date(record.receivedAt),
  };
}
