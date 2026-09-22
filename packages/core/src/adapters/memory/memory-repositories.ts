import type { Repositories, TenantRepository } from '../../ports/repositories.js';
import type { TenantId } from '../../types/ids.js';
import { createMemoryAlertRepository } from './memory-alert-repository.js';
import {
  createMemoryAuditLogRepository,
  createMemoryRawMessageRepository,
} from './memory-audit-repository.js';
import {
  createMemoryDeviceAssignmentRepository,
  createMemoryDeviceRepository,
} from './memory-device-repositories.js';
import {
  createMemoryDeliveryRepository,
  createMemoryFuelEventRepository,
} from './memory-event-repositories.js';
import {
  createMemoryStationRepository,
  createMemoryTankRepository,
} from './memory-fleet-repositories.js';
import { createMemoryReadingRepository } from './memory-reading-repository.js';
import { createMemoryStore, type MemoryStore } from './memory-store.js';

export { createMemoryStore, type MemoryStore } from './memory-store.js';

/**
 * Complete in-memory `Repositories` implementation. Used by unit tests, by the
 * simulator runner, and by development servers started without a database.
 *
 * The same behaviour is implemented against PostgreSQL in
 * `adapters/prisma/prisma-repositories.ts`; the conformance suite in
 * `test/repository-contract.test.ts` runs the same scenarios against both so
 * they cannot drift apart.
 */
export function createMemoryRepositories(store: MemoryStore = createMemoryStore()): Repositories {
  return {
    stations: createMemoryStationRepository(store),
    tanks: createMemoryTankRepository(store),
    readings: createMemoryReadingRepository(store),
    alerts: createMemoryAlertRepository(store),
    devices: createMemoryDeviceRepository(store),
    assignments: createMemoryDeviceAssignmentRepository(store),
    events: createMemoryFuelEventRepository(store),
    deliveries: createMemoryDeliveryRepository(store),
    auditLogs: createMemoryAuditLogRepository(store),
    rawMessages: createMemoryRawMessageRepository(store),
    tenants: createMemoryTenantRepository(store),
  };
}

/**
 * The in-memory store has no tenant table, so the tenant list is derived from
 * the rows that reference a tenant. It exists for the same reason the database
 * version does: the alert sweep needs to visit every tenant.
 */
export function createMemoryTenantRepository(store: MemoryStore): TenantRepository {
  return {
    async list(limit = 500) {
      const ids = new Set<TenantId>();
      const collect = (tenantId: TenantId | null | undefined): void => {
        if (tenantId !== null && tenantId !== undefined) {
          ids.add(tenantId);
        }
      };
      for (const station of store.stations.values()) collect(station.tenantId);
      for (const tank of store.tanks.values()) collect(tank.tenantId);
      for (const device of store.devices.values()) collect(device.tenantId);
      for (const event of store.events.values()) collect(event.tenantId);
      for (const delivery of store.deliveries.values()) collect(delivery.tenantId);
      return [...ids].slice(0, limit).map((id) => ({ id }));
    },
  };
}
