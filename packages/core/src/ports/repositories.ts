import type { Alarm, AlarmStatus } from '../domain/alarm.js';
import type { TankReading } from '../domain/reading.js';
import type { Site, SiteStatus } from '../domain/site.js';
import type { Tank, TankStatus } from '../domain/tank.js';
import type { ReadingId, SiteId, TankId, TenantId } from '../types/ids.js';

export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 100;

export interface SiteQuery {
  readonly status?: SiteStatus;
  readonly limit?: number;
}

export interface TankQuery {
  readonly siteId?: SiteId;
  readonly status?: TankStatus;
  readonly limit?: number;
}

export interface ReadingQuery {
  readonly tankId: TankId;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface AlarmQuery {
  readonly tankId?: TankId;
  readonly status?: AlarmStatus;
  readonly limit?: number;
}

export interface SiteRepository {
  save(tenantId: TenantId, site: Site): Promise<Site>;
  findById(tenantId: TenantId, id: SiteId): Promise<Site | null>;
  list(tenantId: TenantId, query?: SiteQuery): Promise<ReadonlyArray<Site>>;
}

export interface TankRepository {
  save(tenantId: TenantId, tank: Tank): Promise<Tank>;
  findById(tenantId: TenantId, id: TankId): Promise<Tank | null>;
  list(tenantId: TenantId, query?: TankQuery): Promise<ReadonlyArray<Tank>>;
}

export interface ReadingRepository {
  append(tenantId: TenantId, reading: TankReading): Promise<TankReading>;
  findById(tenantId: TenantId, id: ReadingId): Promise<TankReading | null>;
  list(tenantId: TenantId, query: ReadingQuery): Promise<ReadonlyArray<TankReading>>;
  latest(tenantId: TenantId, tankId: TankId): Promise<TankReading | null>;
}

export interface AlarmRepository {
  save(tenantId: TenantId, alarm: Alarm): Promise<Alarm>;
  update(tenantId: TenantId, alarm: Alarm): Promise<Alarm>;
  findById(tenantId: TenantId, id: Alarm['id']): Promise<Alarm | null>;
  list(tenantId: TenantId, query?: AlarmQuery): Promise<ReadonlyArray<Alarm>>;
  listOpenByTank(tenantId: TenantId, tankId: TankId): Promise<ReadonlyArray<Alarm>>;
}

export interface Repositories {
  readonly sites: SiteRepository;
  readonly tanks: TankRepository;
  readonly readings: ReadingRepository;
  readonly alarms: AlarmRepository;
}
