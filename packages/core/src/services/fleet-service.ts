import type { Alarm } from '../domain/alarm.js';
import type { TankReading } from '../domain/reading.js';
import type { Site } from '../domain/site.js';
import {
  assertCapacityWithinGeometry,
  DEFAULT_TANK_THRESHOLDS,
  type Tank,
} from '../domain/tank.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { Logger } from '../logging/logger.js';
import type { Clock } from '../ports/clock.js';
import type { AlarmQuery, Repositories, TankQuery } from '../ports/repositories.js';
import type { ListAlarmsQuery, ListReadingsQuery, ListTanksQuery } from '../validation/schemas.js';
import type { CreateSiteInput, CreateTankInput } from '../validation/schemas.js';
import { newId, type AlarmId, type SiteId, type TankId, type TenantId } from '../types/ids.js';

export interface FleetServiceDependencies {
  readonly repositories: Repositories;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Application service for the fleet read and write model. Every method takes
 * the tenant id explicitly; there is no method that operates across tenants.
 */
export class FleetService {
  private readonly repositories: Repositories;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(dependencies: FleetServiceDependencies) {
    this.repositories = dependencies.repositories;
    this.clock = dependencies.clock;
    this.logger = dependencies.logger;
  }

  async createSite(tenantId: TenantId, input: CreateSiteInput): Promise<Site> {
    const now = this.clock.now().toISOString();
    const site: Site = {
      id: input.id ?? (newId('site') as SiteId),
      tenantId,
      name: input.name,
      timezone: input.timezone,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.repositories.sites.save(tenantId, site);
    this.logger.info('site.created', { tenantId, siteId: saved.id });
    return saved;
  }

  async listSites(tenantId: TenantId): Promise<ReadonlyArray<Site>> {
    return this.repositories.sites.list(tenantId);
  }

  async createTank(tenantId: TenantId, input: CreateTankInput): Promise<Tank> {
    const site = await this.repositories.sites.findById(tenantId, input.siteId);
    if (site === null) {
      throw new NotFoundError('Site', input.siteId);
    }

    try {
      assertCapacityWithinGeometry(input.capacityLitres, input.geometry);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ValidationError('Tank capacity exceeds the declared geometry', [
          { path: 'capacityLitres', message: error.message },
        ]);
      }
      throw error;
    }

    const now = this.clock.now().toISOString();
    const tank: Tank = {
      id: input.id ?? (newId('tank') as TankId),
      tenantId,
      siteId: site.id,
      name: input.name,
      product: input.product,
      geometry: input.geometry,
      capacityLitres: input.capacityLitres,
      thresholds: input.thresholds ?? DEFAULT_TANK_THRESHOLDS,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.repositories.tanks.save(tenantId, tank);
    this.logger.info('tank.created', { tenantId, tankId: saved.id, siteId: saved.siteId });
    return saved;
  }

  async requireTank(tenantId: TenantId, tankId: TankId): Promise<Tank> {
    const tank = await this.repositories.tanks.findById(tenantId, tankId);
    if (tank === null) {
      throw new NotFoundError('Tank', tankId);
    }
    return tank;
  }

  async listTanks(tenantId: TenantId, query: ListTanksQuery): Promise<ReadonlyArray<Tank>> {
    const filter: TankQuery = {
      limit: query.limit,
      ...(query.siteId === undefined ? {} : { siteId: query.siteId }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    return this.repositories.tanks.list(tenantId, filter);
  }

  async listReadings(
    tenantId: TenantId,
    tankId: TankId,
    query: ListReadingsQuery,
  ): Promise<ReadonlyArray<TankReading>> {
    await this.requireTank(tenantId, tankId);
    return this.repositories.readings.list(tenantId, {
      tankId,
      limit: query.limit,
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    });
  }

  async listAlarms(tenantId: TenantId, query: ListAlarmsQuery): Promise<ReadonlyArray<Alarm>> {
    const filter: AlarmQuery = {
      limit: query.limit,
      ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    return this.repositories.alarms.list(tenantId, filter);
  }

  async acknowledgeAlarm(
    tenantId: TenantId,
    alarmId: AlarmId,
    note: string | undefined,
  ): Promise<Alarm> {
    const alarm = await this.repositories.alarms.findById(tenantId, alarmId);
    if (alarm === null) {
      throw new NotFoundError('Alarm', alarmId);
    }
    if (alarm.status === 'resolved') {
      throw new ConflictError(`Alarm ${alarmId} is already resolved`);
    }
    const updated = await this.repositories.alarms.update(tenantId, {
      ...alarm,
      status: 'acknowledged',
      updatedAt: this.clock.now().toISOString(),
      ...(note === undefined ? {} : { message: `${alarm.message} | ack: ${note}` }),
    });
    this.logger.info('alarm.acknowledged', { tenantId, alarmId, tankId: alarm.tankId });
    return updated;
  }
}
