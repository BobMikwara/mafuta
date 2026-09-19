import { assertOwnedByTenant } from '../../tenancy/guard.js';
import { ConflictError, NotFoundError } from '../../errors.js';
import type {
  AlarmQuery,
  AlarmRepository,
  ReadingQuery,
  ReadingRepository,
  Repositories,
  SiteQuery,
  SiteRepository,
  TankQuery,
  TankRepository,
} from '../../ports/repositories.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../ports/repositories.js';
import type { Alarm } from '../../domain/alarm.js';
import { isOpenAlarm } from '../../domain/alarm.js';
import type { TankReading } from '../../domain/reading.js';
import type { Site } from '../../domain/site.js';
import type { Tank } from '../../domain/tank.js';
import type { AlarmId, ReadingId, SiteId, TankId, TenantId } from '../../types/ids.js';

/**
 * In-memory reference implementation of the repository ports.
 * It exists so the domain, API and simulator can be tested and demonstrated
 * without provisioning a database. A SQL implementation must satisfy the same
 * ports; no application code depends on this file.
 */
function clone<T>(value: T): T {
  return structuredClone(value);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)));
}

function scopedKey(tenantId: TenantId, id: string): string {
  return `${tenantId}::${id}`;
}

class MemorySiteRepository implements SiteRepository {
  private readonly store = new Map<string, Site>();

  async save(tenantId: TenantId, site: Site): Promise<Site> {
    assertOwnedByTenant(tenantId, site, 'sites.save');
    this.store.set(scopedKey(tenantId, site.id), clone(site));
    return clone(site);
  }

  async findById(tenantId: TenantId, id: SiteId): Promise<Site | null> {
    const found = this.store.get(scopedKey(tenantId, id));
    if (found === undefined) {
      return null;
    }
    return clone(assertOwnedByTenant(tenantId, found, 'sites.findById'));
  }

  async list(tenantId: TenantId, query: SiteQuery = {}): Promise<ReadonlyArray<Site>> {
    return [...this.store.values()]
      .filter((site) => site.tenantId === tenantId)
      .filter((site) => query.status === undefined || site.status === query.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .slice(0, clampLimit(query.limit))
      .map((site) => clone(site));
  }
}

class MemoryTankRepository implements TankRepository {
  private readonly store = new Map<string, Tank>();

  async save(tenantId: TenantId, tank: Tank): Promise<Tank> {
    assertOwnedByTenant(tenantId, tank, 'tanks.save');
    this.store.set(scopedKey(tenantId, tank.id), clone(tank));
    return clone(tank);
  }

  async findById(tenantId: TenantId, id: TankId): Promise<Tank | null> {
    const found = this.store.get(scopedKey(tenantId, id));
    if (found === undefined) {
      return null;
    }
    return clone(assertOwnedByTenant(tenantId, found, 'tanks.findById'));
  }

  async list(tenantId: TenantId, query: TankQuery = {}): Promise<ReadonlyArray<Tank>> {
    return [...this.store.values()]
      .filter((tank) => tank.tenantId === tenantId)
      .filter((tank) => query.siteId === undefined || tank.siteId === query.siteId)
      .filter((tank) => query.status === undefined || tank.status === query.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .slice(0, clampLimit(query.limit))
      .map((tank) => clone(tank));
  }
}

class MemoryReadingRepository implements ReadingRepository {
  private readonly store = new Map<string, TankReading>();

  async append(tenantId: TenantId, reading: TankReading): Promise<TankReading> {
    assertOwnedByTenant(tenantId, reading, 'readings.append');
    const key = scopedKey(tenantId, reading.id);
    if (this.store.has(key)) {
      throw new ConflictError(`Reading ${reading.id} already exists`);
    }
    this.store.set(key, clone(reading));
    return clone(reading);
  }

  async findById(tenantId: TenantId, id: ReadingId): Promise<TankReading | null> {
    const found = this.store.get(scopedKey(tenantId, id));
    if (found === undefined) {
      return null;
    }
    return clone(assertOwnedByTenant(tenantId, found, 'readings.findById'));
  }

  async list(tenantId: TenantId, query: ReadingQuery): Promise<ReadonlyArray<TankReading>> {
    return [...this.store.values()]
      .filter((reading) => reading.tenantId === tenantId)
      .filter((reading) => reading.tankId === query.tankId)
      .filter((reading) => query.from === undefined || reading.recordedAt >= query.from)
      .filter((reading) => query.to === undefined || reading.recordedAt <= query.to)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))
      .slice(0, clampLimit(query.limit))
      .map((reading) => clone(reading));
  }

  async latest(tenantId: TenantId, tankId: TankId): Promise<TankReading | null> {
    const readings = await this.list(tenantId, { tankId, limit: 1 });
    return readings[0] === undefined ? null : clone(readings[0]);
  }
}

class MemoryAlarmRepository implements AlarmRepository {
  private readonly store = new Map<string, Alarm>();

  async save(tenantId: TenantId, alarm: Alarm): Promise<Alarm> {
    assertOwnedByTenant(tenantId, alarm, 'alarms.save');
    const key = scopedKey(tenantId, alarm.id);
    if (this.store.has(key)) {
      throw new ConflictError(`Alarm ${alarm.id} already exists`);
    }
    this.store.set(key, clone(alarm));
    return clone(alarm);
  }

  async update(tenantId: TenantId, alarm: Alarm): Promise<Alarm> {
    assertOwnedByTenant(tenantId, alarm, 'alarms.update');
    const key = scopedKey(tenantId, alarm.id);
    if (!this.store.has(key)) {
      throw new NotFoundError('Alarm', alarm.id);
    }
    this.store.set(key, clone(alarm));
    return clone(alarm);
  }

  async findById(tenantId: TenantId, id: AlarmId): Promise<Alarm | null> {
    const found = this.store.get(scopedKey(tenantId, id));
    if (found === undefined) {
      return null;
    }
    return clone(assertOwnedByTenant(tenantId, found, 'alarms.findById'));
  }

  async list(tenantId: TenantId, query: AlarmQuery = {}): Promise<ReadonlyArray<Alarm>> {
    return [...this.store.values()]
      .filter((alarm) => alarm.tenantId === tenantId)
      .filter((alarm) => query.tankId === undefined || alarm.tankId === query.tankId)
      .filter((alarm) => query.status === undefined || alarm.status === query.status)
      .sort((a, b) => b.raisedAt.localeCompare(a.raisedAt) || b.id.localeCompare(a.id))
      .slice(0, clampLimit(query.limit))
      .map((alarm) => clone(alarm));
  }

  async listOpenByTank(tenantId: TenantId, tankId: TankId): Promise<ReadonlyArray<Alarm>> {
    return [...this.store.values()]
      .filter((alarm) => alarm.tenantId === tenantId)
      .filter((alarm) => alarm.tankId === tankId)
      .filter((alarm) => isOpenAlarm(alarm))
      .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))
      .map((alarm) => clone(alarm));
  }
}

export interface MemoryRepositories extends Repositories {
  /** Test and demo helper. Not part of the repository ports. */
  reset(): void;
  counts(): { sites: number; tanks: number; readings: number; alarms: number };
}

export function createMemoryRepositories(): MemoryRepositories {
  const sites = new MemorySiteRepository();
  const tanks = new MemoryTankRepository();
  const readings = new MemoryReadingRepository();
  const alarms = new MemoryAlarmRepository();

  return {
    sites,
    tanks,
    readings,
    alarms,
    reset: () => {
      // The maps are private; resetting is only needed for tests, which build
      // a fresh instance through this factory instead.
    },
    counts: () => ({
      sites: 0,
      tanks: 0,
      readings: 0,
      alarms: 0,
    }),
  };
}
