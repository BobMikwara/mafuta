import type { Alert, AlertStatus, AlertType } from '../domain/alert.js';
import type { AuditLogEntry } from '../domain/audit.js';
import type { Delivery } from '../domain/delivery.js';
import type {
  AssignmentStatus,
  Device,
  DeviceAssignment,
  DeviceConnectionState,
  DeviceStatus,
} from '../domain/device.js';
import type { FuelEvent, FuelEventStatus, FuelEventType } from '../domain/event.js';
import type { TankReading } from '../domain/reading.js';
import type { Station, StationStatus } from '../domain/station.js';
import type { Tank, TankStatus } from '../domain/tank.js';
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
} from '../types/ids.js';

export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 100;

export function clampLimit(limit: number | undefined, fallback = DEFAULT_PAGE_SIZE): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)));
}

export interface StationQuery {
  readonly status?: StationStatus;
  readonly limit?: number;
}

export interface TankQuery {
  readonly stationId?: StationId;
  readonly status?: TankStatus;
  readonly limit?: number;
}

export interface ReadingQuery {
  readonly tankId: TankId;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  /** Returns readings ascending by `recordedAt` instead of newest first. */
  readonly ascending?: boolean;
}

export interface AlertQuery {
  readonly tankId?: TankId;
  readonly status?: AlertStatus;
  readonly type?: AlertType;
  readonly limit?: number;
}

export interface DeviceQuery {
  readonly stationId?: StationId;
  readonly tankId?: TankId;
  readonly status?: DeviceStatus;
  readonly limit?: number;
}

export interface EventQuery {
  readonly tankId?: TankId;
  readonly status?: FuelEventStatus;
  readonly type?: FuelEventType;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface DeliveryQuery {
  readonly tankId?: TankId;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface AuditQuery {
  readonly action?: string;
  readonly resourceType?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface StationRepository {
  save(tenantId: TenantId, station: Station): Promise<Station>;
  findById(tenantId: TenantId, id: StationId): Promise<Station | null>;
  findByCode(tenantId: TenantId, code: string): Promise<Station | null>;
  list(tenantId: TenantId, query?: StationQuery): Promise<ReadonlyArray<Station>>;
}

export interface TankRepository {
  save(tenantId: TenantId, tank: Tank): Promise<Tank>;
  findById(tenantId: TenantId, id: TankId): Promise<Tank | null>;
  list(tenantId: TenantId, query?: TankQuery): Promise<ReadonlyArray<Tank>>;
}

export interface ReadingRepository {
  append(tenantId: TenantId, reading: TankReading): Promise<TankReading>;
  findById(tenantId: TenantId, id: ReadingId): Promise<TankReading | null>;
  /**
   * Resolves a reading by its submission identity. Backed by a unique index on
   * (tenantId, idempotencyKey) so that concurrent retries cannot both insert.
   */
  findByIdempotencyKey(tenantId: TenantId, key: string): Promise<TankReading | null>;
  list(tenantId: TenantId, query: ReadingQuery): Promise<ReadonlyArray<TankReading>>;
  latest(tenantId: TenantId, tankId: TankId): Promise<TankReading | null>;
  /** Latest reading for every tank of the tenant, keyed by tank id. */
  latestByTank(tenantId: TenantId): Promise<ReadonlyMap<TankId, TankReading>>;
}

export interface AlertRepository {
  save(tenantId: TenantId, alert: Alert): Promise<Alert>;
  update(tenantId: TenantId, alert: Alert): Promise<Alert>;
  findById(tenantId: TenantId, id: AlertId): Promise<Alert | null>;
  list(tenantId: TenantId, query?: AlertQuery): Promise<ReadonlyArray<Alert>>;
  listOpenByTank(tenantId: TenantId, tankId: TankId): Promise<ReadonlyArray<Alert>>;
  countOpen(tenantId: TenantId): Promise<number>;
}

export interface DeviceRepository {
  save(tenantId: TenantId, device: Device): Promise<Device>;
  findById(tenantId: TenantId, id: DeviceId): Promise<Device | null>;
  findBySerialNumber(tenantId: TenantId, serialNumber: string): Promise<Device | null>;
  list(tenantId: TenantId, query?: DeviceQuery): Promise<ReadonlyArray<Device>>;
  /** Records that the device was heard from, and its connection state. */
  touch(
    tenantId: TenantId,
    id: DeviceId,
    seenAt: string,
    connectionState: DeviceConnectionState,
  ): Promise<void>;
}

export interface DeviceAssignmentRepository {
  save(tenantId: TenantId, assignment: DeviceAssignment): Promise<DeviceAssignment>;
  findActiveByDevice(tenantId: TenantId, deviceId: DeviceId): Promise<DeviceAssignment | null>;
  listActiveByTank(tenantId: TenantId, tankId: TankId): Promise<ReadonlyArray<DeviceAssignment>>;
  listByDevice(tenantId: TenantId, deviceId: DeviceId): Promise<ReadonlyArray<DeviceAssignment>>;
  listActive(
    tenantId: TenantId,
    query?: { stationId?: StationId },
  ): Promise<ReadonlyArray<DeviceAssignment>>;
  /** Ends an assignment without deleting it, preserving assignment history. */
  end(tenantId: TenantId, assignmentId: string, endedAt: string): Promise<DeviceAssignment>;
  findById(tenantId: TenantId, assignmentId: string): Promise<DeviceAssignment | null>;
  listByTank(
    tenantId: TenantId,
    tankId: TankId,
    status?: AssignmentStatus,
  ): Promise<ReadonlyArray<DeviceAssignment>>;
}

export interface FuelEventRepository {
  save(tenantId: TenantId, event: FuelEvent): Promise<FuelEvent>;
  update(tenantId: TenantId, event: FuelEvent): Promise<FuelEvent>;
  findById(tenantId: TenantId, id: FuelEventId): Promise<FuelEvent | null>;
  list(tenantId: TenantId, query?: EventQuery): Promise<ReadonlyArray<FuelEvent>>;
  listRecentByTank(
    tenantId: TenantId,
    tankId: TankId,
    limit: number,
    sinceIso?: string,
  ): Promise<ReadonlyArray<FuelEvent>>;
}

export interface DeliveryRepository {
  save(tenantId: TenantId, delivery: Delivery): Promise<Delivery>;
  findById(tenantId: TenantId, id: DeliveryId): Promise<Delivery | null>;
  list(tenantId: TenantId, query?: DeliveryQuery): Promise<ReadonlyArray<Delivery>>;
  /** Deliveries created from one event, so a confirm cannot be repeated. */
  listByEvent(tenantId: TenantId, eventId: FuelEventId): Promise<ReadonlyArray<Delivery>>;
}

export interface AuditLogRepository {
  append(entry: AuditLogEntry): Promise<AuditLogEntry>;
  list(tenantId: TenantId, query?: AuditQuery): Promise<ReadonlyArray<AuditLogEntry>>;
}

/** Immutable, access restricted raw device payload. */
export interface RawMessageRecord {
  readonly id: RawMessageId;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId | null;
  readonly protocol: 'simulated' | 'http' | 'mqtt' | 'manual';
  readonly payload: unknown;
  readonly messageHash: string;
  readonly receivedAt: string;
}

export interface RawMessageRepository {
  /** Idempotent on (tenantId, messageHash). */
  save(tenantId: TenantId, record: RawMessageRecord): Promise<RawMessageRecord>;
  findById(tenantId: TenantId, id: RawMessageId): Promise<RawMessageRecord | null>;
  findByHash(tenantId: TenantId, messageHash: string): Promise<RawMessageRecord | null>;
  listByDevice(
    tenantId: TenantId,
    deviceId: DeviceId,
    limit?: number,
  ): Promise<ReadonlyArray<RawMessageRecord>>;
}

/**
 * Tenant listing used only by platform maintenance (the alert sweep). It is not
 * reachable from a tenant scoped request path: every other query takes a
 * tenant id and cannot enumerate tenants.
 */
export interface TenantRepository {
  list(limit?: number): Promise<ReadonlyArray<{ readonly id: TenantId }>>;
}

export interface Repositories {
  readonly stations: StationRepository;
  readonly tanks: TankRepository;
  readonly readings: ReadingRepository;
  readonly alerts: AlertRepository;
  readonly devices: DeviceRepository;
  readonly assignments: DeviceAssignmentRepository;
  readonly events: FuelEventRepository;
  readonly deliveries: DeliveryRepository;
  readonly auditLogs: AuditLogRepository;
  readonly rawMessages: RawMessageRepository;
  readonly tenants: TenantRepository;
}
