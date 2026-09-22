import {
  clampLimit,
  type DeliveryQuery,
  type DeliveryRepository,
  type EventQuery,
  type FuelEventRepository,
} from '../../ports/repositories.js';
import type { Delivery } from '../../domain/delivery.js';
import type { FuelEvent } from '../../domain/event.js';
import { assertOwnedByTenant } from '../../tenancy/guard.js';
import type { DeliveryId, FuelEventId, TankId, TenantId } from '../../types/ids.js';
import { cloneEntity, scopedKey, type MemoryStore } from './memory-store.js';

export function createMemoryFuelEventRepository(store: MemoryStore): FuelEventRepository {
  function tenantEvents(tenantId: TenantId): Array<FuelEvent> {
    return [...store.events.values()]
      .filter((event) => event.tenantId === tenantId)
      .sort((left, right) => Date.parse(right.windowEnd) - Date.parse(left.windowEnd));
  }

  return {
    async save(tenantId: TenantId, event: FuelEvent): Promise<FuelEvent> {
      assertOwnedByTenant(tenantId, event, 'events.save');
      const stored = cloneEntity(event);
      store.events.set(scopedKey(tenantId, event.id), stored);
      return cloneEntity(stored);
    },
    async update(tenantId: TenantId, event: FuelEvent): Promise<FuelEvent> {
      assertOwnedByTenant(tenantId, event, 'events.update');
      const stored = cloneEntity(event);
      store.events.set(scopedKey(tenantId, event.id), stored);
      return cloneEntity(stored);
    },
    async findById(tenantId: TenantId, id: FuelEventId): Promise<FuelEvent | null> {
      const event = store.events.get(scopedKey(tenantId, id));
      return event === undefined ? null : cloneEntity(event);
    },
    async list(tenantId: TenantId, query: EventQuery = {}): Promise<ReadonlyArray<FuelEvent>> {
      const from = query.from === undefined ? null : Date.parse(query.from);
      const to = query.to === undefined ? null : Date.parse(query.to);
      const events = tenantEvents(tenantId)
        .filter((event) => query.tankId === undefined || event.tankId === query.tankId)
        .filter((event) => query.status === undefined || event.status === query.status)
        .filter((event) => query.type === undefined || event.type === query.type)
        .filter((event) => {
          const at = Date.parse(event.windowEnd);
          if (from !== null && at < from) return false;
          if (to !== null && at > to) return false;
          return true;
        });
      return events.slice(0, clampLimit(query.limit)).map(cloneEntity);
    },
    async listRecentByTank(
      tenantId: TenantId,
      tankId: TankId,
      limit: number,
      sinceIso?: string,
    ): Promise<ReadonlyArray<FuelEvent>> {
      const since = sinceIso === undefined ? null : Date.parse(sinceIso);
      return tenantEvents(tenantId)
        .filter((event) => event.tankId === tankId)
        .filter((event) => since === null || Date.parse(event.windowEnd) >= since)
        .slice(0, clampLimit(limit, 20))
        .map(cloneEntity);
    },
  };
}

export function createMemoryDeliveryRepository(store: MemoryStore): DeliveryRepository {
  function tenantDeliveries(tenantId: TenantId): Array<Delivery> {
    return [...store.deliveries.values()]
      .filter((delivery) => delivery.tenantId === tenantId)
      .sort((left, right) => Date.parse(right.confirmedAt) - Date.parse(left.confirmedAt));
  }

  return {
    async save(tenantId: TenantId, delivery: Delivery): Promise<Delivery> {
      assertOwnedByTenant(tenantId, delivery, 'deliveries.save');
      const stored = cloneEntity(delivery);
      store.deliveries.set(scopedKey(tenantId, delivery.id), stored);
      return cloneEntity(stored);
    },
    async findById(tenantId: TenantId, id: DeliveryId): Promise<Delivery | null> {
      const delivery = store.deliveries.get(scopedKey(tenantId, id));
      return delivery === undefined ? null : cloneEntity(delivery);
    },
    async list(tenantId: TenantId, query: DeliveryQuery = {}): Promise<ReadonlyArray<Delivery>> {
      const from = query.from === undefined ? null : Date.parse(query.from);
      const to = query.to === undefined ? null : Date.parse(query.to);
      const deliveries = tenantDeliveries(tenantId)
        .filter((delivery) => query.tankId === undefined || delivery.tankId === query.tankId)
        .filter((delivery) => {
          const at = Date.parse(delivery.confirmedAt);
          if (from !== null && at < from) return false;
          if (to !== null && at > to) return false;
          return true;
        });
      return deliveries.slice(0, clampLimit(query.limit)).map(cloneEntity);
    },
    async listByEvent(tenantId: TenantId, eventId: FuelEventId): Promise<ReadonlyArray<Delivery>> {
      return tenantDeliveries(tenantId)
        .filter((delivery) => delivery.fuelEventId === eventId)
        .map(cloneEntity);
    },
  };
}
