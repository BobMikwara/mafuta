import type { Alert, AlertStatus } from '../domain/alert.js';
import type { TankReading } from '../domain/reading.js';
import { DEFAULT_STATION_TIMEZONE, type Station, type StationStatus } from '../domain/station.js';
import {
  assertCapacityWithinGeometry,
  DEFAULT_TANK_THRESHOLDS,
  type Tank,
  type TankThresholds,
} from '../domain/tank.js';
import {
  toReadingView,
  toTankSummary,
  type ReadingView,
  type TankSummary,
} from '../domain/views.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { Logger } from '../logging/logger.js';
import type { Clock } from '../ports/clock.js';
import type { AlertQuery, Repositories, TankQuery } from '../ports/repositories.js';
import type {
  CreateStationInput,
  CreateTankInput,
  ListAlertsQuery,
  ListReadingsQuery,
  ListTanksQuery,
  UpdateStationInput,
  UpdateTankInput,
} from '../validation/schemas.js';
import { newId, type AlertId, type StationId, type TankId, type TenantId } from '../types/ids.js';

export interface FleetServiceDependencies {
  readonly repositories: Repositories;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Application service for stations, tanks, readings and alerts.
 *
 * Every method takes the tenant id explicitly; there is no method that operates
 * across tenants, and the repositories re-assert ownership on every write.
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

  // -------------------- Stations --------------------

  async createStation(tenantId: TenantId, input: CreateStationInput): Promise<Station> {
    const now = this.clock.now().toISOString();
    const station: Station = {
      id: input.id ?? (newId('stn') as StationId),
      tenantId,
      name: input.name,
      code: input.code,
      timezone: input.timezone ?? DEFAULT_STATION_TIMEZONE,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const existingCode = await this.repositories.stations.findByCode(tenantId, station.code);
    if (existingCode !== null) {
      throw new ConflictError(`Station code ${station.code} is already used by this tenant`);
    }
    const saved = await this.repositories.stations.save(tenantId, station);
    this.logger.info('station.created', { tenantId, stationId: saved.id });
    return saved;
  }

  async updateStation(
    tenantId: TenantId,
    stationId: StationId,
    input: UpdateStationInput,
  ): Promise<Station> {
    const station = await this.requireStation(tenantId, stationId);
    const updated: Station = {
      ...station,
      name: input.name ?? station.name,
      timezone: input.timezone ?? station.timezone,
      status: (input.status as StationStatus | undefined) ?? station.status,
      updatedAt: this.clock.now().toISOString(),
    };
    const saved = await this.repositories.stations.save(tenantId, updated);
    this.logger.info('station.updated', { tenantId, stationId: saved.id });
    return saved;
  }

  async requireStation(tenantId: TenantId, stationId: StationId): Promise<Station> {
    const station = await this.repositories.stations.findById(tenantId, stationId);
    if (station === null) {
      throw new NotFoundError('Station', stationId);
    }
    return station;
  }

  async listStations(
    tenantId: TenantId,
    query: { status?: StationStatus | undefined; limit?: number | undefined } = {},
  ): Promise<ReadonlyArray<Station>> {
    // Request DTO: an absent filter arrives as an explicit `undefined` from a
    // parsed query string, so it is stripped before reaching the repository,
    // whose query types distinguish `{ status: undefined }` from `{}`.
    return this.repositories.stations.list(tenantId, {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
  }

  // -------------------- Tanks --------------------

  async createTank(tenantId: TenantId, input: CreateTankInput): Promise<Tank> {
    const station = await this.repositories.stations.findById(tenantId, input.stationId);
    if (station === null) {
      throw new NotFoundError('Station', input.stationId);
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
      id: input.id ?? (newId('tnk') as TankId),
      tenantId,
      stationId: station.id,
      name: input.name,
      product: input.product,
      geometry: input.geometry,
      capacityLitres: input.capacityLitres,
      thresholds: input.thresholds ?? DEFAULT_TANK_THRESHOLDS,
      status: 'active',
      calibrationSource: input.calibrationSource ?? null,
      calibrationAt: input.calibrationAt ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.repositories.tanks.save(tenantId, tank);
    this.logger.info('tank.created', { tenantId, tankId: saved.id, stationId: saved.stationId });
    return saved;
  }

  async updateTank(tenantId: TenantId, tankId: TankId, input: UpdateTankInput): Promise<Tank> {
    const tank = await this.requireTank(tenantId, tankId);
    const geometry = input.geometry ?? tank.geometry;
    const capacityLitres = input.capacityLitres ?? tank.capacityLitres;
    try {
      assertCapacityWithinGeometry(capacityLitres, geometry);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ValidationError('Tank capacity exceeds the declared geometry', [
          { path: 'capacityLitres', message: error.message },
        ]);
      }
      throw error;
    }

    const thresholds: TankThresholds = input.thresholds ?? tank.thresholds;
    const updated: Tank = {
      ...tank,
      name: input.name ?? tank.name,
      product: input.product ?? tank.product,
      geometry,
      capacityLitres,
      thresholds,
      status: input.status ?? tank.status,
      calibrationSource:
        input.calibrationSource === undefined ? tank.calibrationSource : input.calibrationSource,
      calibrationAt: input.calibrationAt === undefined ? tank.calibrationAt : input.calibrationAt,
      updatedAt: this.clock.now().toISOString(),
    };
    const saved = await this.repositories.tanks.save(tenantId, updated);
    this.logger.info('tank.updated', { tenantId, tankId: saved.id });
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
      ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    return this.repositories.tanks.list(tenantId, filter);
  }

  /**
   * Tanks with their station, latest reading and open alerts. Used by the tank
   * list, the dashboard and the inventory report, so the freshness and stock
   * arithmetic is computed once.
   */
  async listTankSummaries(
    tenantId: TenantId,
    query: ListTanksQuery,
  ): Promise<ReadonlyArray<TankSummary>> {
    const tanks = await this.listTanks(tenantId, query);
    const now = this.clock.now();
    const stations = await this.repositories.stations.list(tenantId);
    const stationById = new Map(stations.map((station) => [station.id, station]));
    const summaries: TankSummary[] = [];
    for (const tank of tanks) {
      const latest = await this.repositories.readings.latest(tenantId, tank.id);
      const openAlerts = await this.repositories.alerts.listOpenByTank(tenantId, tank.id);
      summaries.push(
        toTankSummary({
          tank,
          station: stationById.get(tank.stationId) ?? null,
          latestReading: latest,
          openAlerts,
          now,
        }),
      );
    }
    return summaries;
  }

  async tankSummary(tenantId: TenantId, tankId: TankId): Promise<TankSummary> {
    const tank = await this.requireTank(tenantId, tankId);
    const station = await this.repositories.stations.findById(tenantId, tank.stationId);
    const latest = await this.repositories.readings.latest(tenantId, tank.id);
    const openAlerts = await this.repositories.alerts.listOpenByTank(tenantId, tank.id);
    return toTankSummary({
      tank,
      station,
      latestReading: latest,
      openAlerts,
      now: this.clock.now(),
    });
  }

  // -------------------- Readings --------------------

  async listReadings(
    tenantId: TenantId,
    tankId: TankId,
    query: ListReadingsQuery,
  ): Promise<ReadonlyArray<ReadingView>> {
    const tank = await this.requireTank(tenantId, tankId);
    const readings = await this.repositories.readings.list(tenantId, {
      tankId,
      limit: query.limit,
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.ascending === undefined ? {} : { ascending: query.ascending }),
    });
    const now = this.clock.now();
    return readings.map((reading) =>
      toReadingView(reading, now, tank.thresholds.staleAfterMinutes),
    );
  }

  // -------------------- Alerts --------------------

  async listAlerts(tenantId: TenantId, query: ListAlertsQuery): Promise<ReadonlyArray<Alert>> {
    const filter: AlertQuery = {
      limit: query.limit,
      ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.type === undefined ? {} : { type: query.type }),
    };
    return this.repositories.alerts.list(tenantId, filter);
  }

  async requireAlert(tenantId: TenantId, alertId: AlertId): Promise<Alert> {
    const alert = await this.repositories.alerts.findById(tenantId, alertId);
    if (alert === null) {
      throw new NotFoundError('Alert', alertId);
    }
    return alert;
  }

  async acknowledgeAlert(
    tenantId: TenantId,
    alertId: AlertId,
    input: { note?: string; actor: string },
  ): Promise<Alert> {
    const alert = await this.requireAlert(tenantId, alertId);
    if (alert.status === 'resolved') {
      throw new ConflictError(`Alert ${alertId} is already resolved`);
    }
    const now = this.clock.now().toISOString();
    const updated = await this.repositories.alerts.update(tenantId, {
      ...alert,
      status: 'acknowledged',
      acknowledgedAt: alert.acknowledgedAt ?? now,
      acknowledgedBy: alert.acknowledgedBy ?? input.actor,
      updatedAt: now,
      ...(input.note === undefined ? {} : { message: appendNote(alert.message, input.note) }),
    });
    this.logger.info('alert.acknowledged', { tenantId, alertId, tankId: alert.tankId });
    return updated;
  }

  async resolveAlert(
    tenantId: TenantId,
    alertId: AlertId,
    input: { note?: string; actor: string },
  ): Promise<Alert> {
    const alert = await this.requireAlert(tenantId, alertId);
    if (alert.status === 'resolved') {
      throw new ConflictError(`Alert ${alertId} is already resolved`);
    }
    const now = this.clock.now().toISOString();
    const updated = await this.repositories.alerts.update(tenantId, {
      ...alert,
      status: 'resolved',
      resolvedAt: now,
      resolvedBy: input.actor,
      // An alert that was resolved before anybody looked at it is still
      // acknowledged, so the trail shows it was seen.
      acknowledgedAt: alert.acknowledgedAt ?? now,
      acknowledgedBy: alert.acknowledgedBy ?? input.actor,
      updatedAt: now,
      ...(input.note === undefined ? {} : { message: appendNote(alert.message, input.note) }),
    });
    this.logger.info('alert.resolved', { tenantId, alertId, tankId: alert.tankId });
    return updated;
  }

  async assignAlert(tenantId: TenantId, alertId: AlertId, assignee: string | null): Promise<Alert> {
    const alert = await this.requireAlert(tenantId, alertId);
    const updated = await this.repositories.alerts.update(tenantId, {
      ...alert,
      assignedTo: assignee,
      updatedAt: this.clock.now().toISOString(),
    });
    this.logger.info('alert.assigned', { tenantId, alertId, assignee });
    return updated;
  }

  async countOpenAlerts(tenantId: TenantId): Promise<number> {
    return this.repositories.alerts.countOpen(tenantId);
  }

  /** Reads a single stored reading, used by the raw payload endpoint checks. */
  async requireReading(tenantId: TenantId, readingId: TankReading['id']): Promise<TankReading> {
    const reading = await this.repositories.readings.findById(tenantId, readingId);
    if (reading === null) {
      throw new NotFoundError('Reading', readingId);
    }
    return reading;
  }
}

function appendNote(message: string, note: string): string {
  return `${message} | note: ${note}`;
}

/** Alert statuses accepted by the list query, re-exported for route schemas. */
export type AlertStatusFilter = AlertStatus;
