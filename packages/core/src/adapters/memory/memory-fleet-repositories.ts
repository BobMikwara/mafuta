import { assertOwnedByTenant } from '../../tenancy/guard.js';
import { clampLimit } from '../../ports/repositories.js';
import type {
  StationQuery,
  StationRepository,
  TankQuery,
  TankRepository,
} from '../../ports/repositories.js';
import type { Station } from '../../domain/station.js';
import type { Tank } from '../../domain/tank.js';
import type { StationId, TankId, TenantId } from '../../types/ids.js';
import { cloneEntity, scopedKey, type MemoryStore } from './memory-store.js';

export function createMemoryStationRepository(store: MemoryStore): StationRepository {
  return {
    async save(tenantId: TenantId, station: Station): Promise<Station> {
      assertOwnedByTenant(tenantId, station, 'stations.save');
      const stored = cloneEntity(station);
      store.stations.set(scopedKey(tenantId, station.id), stored);
      return cloneEntity(stored);
    },
    async findById(tenantId: TenantId, id: StationId): Promise<Station | null> {
      const station = store.stations.get(scopedKey(tenantId, id));
      return station === undefined ? null : cloneEntity(station);
    },
    async findByCode(tenantId: TenantId, code: string): Promise<Station | null> {
      for (const station of store.stations.values()) {
        if (station.tenantId === tenantId && station.code === code) {
          return cloneEntity(station);
        }
      }
      return null;
    },
    async list(tenantId: TenantId, query: StationQuery = {}): Promise<ReadonlyArray<Station>> {
      const stations = [...store.stations.values()]
        .filter((station) => station.tenantId === tenantId)
        .filter((station) => query.status === undefined || station.status === query.status)
        .sort((left, right) => left.name.localeCompare(right.name));
      return stations.slice(0, clampLimit(query.limit)).map(cloneEntity);
    },
  };
}

export function createMemoryTankRepository(store: MemoryStore): TankRepository {
  return {
    async save(tenantId: TenantId, tank: Tank): Promise<Tank> {
      assertOwnedByTenant(tenantId, tank, 'tanks.save');
      const stored = cloneEntity(tank);
      store.tanks.set(scopedKey(tenantId, tank.id), stored);
      return cloneEntity(stored);
    },
    async findById(tenantId: TenantId, id: TankId): Promise<Tank | null> {
      const tank = store.tanks.get(scopedKey(tenantId, id));
      return tank === undefined ? null : cloneEntity(tank);
    },
    async list(tenantId: TenantId, query: TankQuery = {}): Promise<ReadonlyArray<Tank>> {
      const tanks = [...store.tanks.values()]
        .filter((tank) => tank.tenantId === tenantId)
        .filter((tank) => query.stationId === undefined || tank.stationId === query.stationId)
        .filter((tank) => query.status === undefined || tank.status === query.status)
        .sort((left, right) => left.name.localeCompare(right.name));
      return tanks.slice(0, clampLimit(query.limit)).map(cloneEntity);
    },
  };
}
