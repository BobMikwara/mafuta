import { clampLimit, type ReadingQuery, type ReadingRepository } from '../../ports/repositories.js';
import type { TankReading } from '../../domain/reading.js';
import { assertOwnedByTenant } from '../../tenancy/guard.js';
import type { ReadingId, TankId, TenantId } from '../../types/ids.js';
import {
  cloneEntity,
  compareAscending,
  idempotencyKey,
  scopedKey,
  type MemoryStore,
} from './memory-store.js';

export function createMemoryReadingRepository(store: MemoryStore): ReadingRepository {
  /** Every reading of the tenant, oldest first. */
  function tenantReadings(tenantId: TenantId): Array<TankReading> {
    return [...store.readings.values()]
      .filter((reading) => reading.tenantId === tenantId)
      .sort((left, right) =>
        compareAscending(
          left,
          right,
          (value) => value.recordedAt,
          (value) => value.id,
        ),
      );
  }

  return {
    async append(tenantId: TenantId, reading: TankReading): Promise<TankReading> {
      assertOwnedByTenant(tenantId, reading, 'readings.append');
      const stored = cloneEntity(reading);
      store.readings.set(scopedKey(tenantId, reading.id), stored);
      store.readingIdempotency.set(
        idempotencyKey(tenantId, reading.idempotencyKey),
        scopedKey(tenantId, reading.id),
      );
      return cloneEntity(stored);
    },
    async findById(tenantId: TenantId, id: ReadingId): Promise<TankReading | null> {
      const reading = store.readings.get(scopedKey(tenantId, id));
      return reading === undefined ? null : cloneEntity(reading);
    },
    async findByIdempotencyKey(tenantId: TenantId, key: string): Promise<TankReading | null> {
      const id = store.readingIdempotency.get(idempotencyKey(tenantId, key));
      if (id === undefined) {
        return null;
      }
      const reading = store.readings.get(id);
      return reading === undefined ? null : cloneEntity(reading);
    },
    async list(tenantId: TenantId, query: ReadingQuery): Promise<ReadonlyArray<TankReading>> {
      const from = query.from === undefined ? null : Date.parse(query.from);
      const to = query.to === undefined ? null : Date.parse(query.to);
      const matching = tenantReadings(tenantId)
        .filter((reading) => reading.tankId === query.tankId)
        .filter((reading) => {
          const recorded = Date.parse(reading.recordedAt);
          if (from !== null && recorded < from) return false;
          if (to !== null && recorded > to) return false;
          return true;
        });
      // Default ordering is newest first, matching the API list contract.
      const ordered = query.ascending === true ? matching : [...matching].reverse();
      return ordered.slice(0, clampLimit(query.limit)).map(cloneEntity);
    },
    async latest(tenantId: TenantId, tankId: TankId): Promise<TankReading | null> {
      const readings = tenantReadings(tenantId).filter((reading) => reading.tankId === tankId);
      const latest = readings[readings.length - 1];
      return latest === undefined ? null : cloneEntity(latest);
    },
    async latestByTank(tenantId: TenantId): Promise<ReadonlyMap<TankId, TankReading>> {
      const latest = new Map<TankId, TankReading>();
      for (const reading of tenantReadings(tenantId)) {
        latest.set(reading.tankId, cloneEntity(reading));
      }
      return latest;
    },
  };
}
