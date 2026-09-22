import type { Alert } from '../../domain/alert.js';
import type { AuditLogEntry } from '../../domain/audit.js';
import type { Delivery } from '../../domain/delivery.js';
import type { Device, DeviceAssignment } from '../../domain/device.js';
import type { FuelEvent } from '../../domain/event.js';
import type { TankReading } from '../../domain/reading.js';
import type { Station } from '../../domain/station.js';
import type { Tank } from '../../domain/tank.js';
import type { RawMessageRecord } from '../../ports/repositories.js';
import type { TenantId } from '../../types/ids.js';

/**
 * In memory reference store.
 *
 * Used by unit tests and by development runs that do not have PostgreSQL. Every
 * collection is keyed by `tenantId:entityId`, so a lookup can never cross a
 * tenant boundary even if a caller forgets to filter: the key itself carries the
 * tenant.
 */
export interface MemoryStore {
  readonly stations: Map<string, Station>;
  readonly tanks: Map<string, Tank>;
  readonly readings: Map<string, TankReading>;
  /** `tenantId:idempotencyKey` to reading id, mirroring the database index. */
  readonly readingIdempotency: Map<string, string>;
  readonly alerts: Map<string, Alert>;
  readonly devices: Map<string, Device>;
  readonly assignments: Map<string, DeviceAssignment>;
  readonly events: Map<string, FuelEvent>;
  readonly deliveries: Map<string, Delivery>;
  readonly auditLogs: Map<string, AuditLogEntry>;
  readonly rawMessages: Map<string, RawMessageRecord>;
}

export function createMemoryStore(): MemoryStore {
  return {
    stations: new Map(),
    tanks: new Map(),
    readings: new Map(),
    readingIdempotency: new Map(),
    alerts: new Map(),
    devices: new Map(),
    assignments: new Map(),
    events: new Map(),
    deliveries: new Map(),
    auditLogs: new Map(),
    rawMessages: new Map(),
  };
}

/**
 * Defensive copy of a stored or returned entity.
 *
 * The in-memory store is a reference implementation of the ports, and the ports
 * promise value semantics: a caller that mutates an object it read must not be
 * able to change what the store holds. Without this copy a service that edits a
 * nested geometry or thresholds object in place would silently corrupt the
 * store, which is exactly the class of bug the database cannot have and tests
 * would not otherwise catch.
 */
export function cloneEntity<T>(value: T): T {
  return structuredClone(value);
}

export function scopedKey(tenantId: TenantId, id: string): string {
  return `${tenantId}:${id}`;
}

export function idempotencyKey(tenantId: TenantId, key: string): string {
  return `${tenantId}:${key}`;
}

/** Ascending by a string timestamp, with a stable tie break on id. */
export function compareAscending<T>(
  left: T,
  right: T,
  timestamp: (value: T) => string,
  id: (value: T) => string,
): number {
  const leftTime = Date.parse(timestamp(left));
  const rightTime = Date.parse(timestamp(right));
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return id(left) < id(right) ? -1 : id(left) > id(right) ? 1 : 0;
}

export function takeFirst<T>(
  values: ReadonlyArray<T>,
  limit: number | undefined,
): ReadonlyArray<T> {
  if (limit === undefined) {
    return values;
  }
  return values.slice(0, Math.max(0, limit));
}
