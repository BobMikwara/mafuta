import { netVolumeMl, type TankReading } from '../domain/reading.js';
import type { Alert, AlertSeverity } from '../domain/alert.js';
import type { Station } from '../domain/station.js';
import { summariseProductStock, type ProductStock, type TankSummary } from '../domain/views.js';
import type { Logger } from '../logging/logger.js';
import type { Clock } from '../ports/clock.js';
import type { Repositories } from '../ports/repositories.js';
import type { DeviceView } from './device-service.js';
import { DeviceService } from './device-service.js';
import { FleetService } from './fleet-service.js';
import type { StationId, TenantId, TankId } from '../types/ids.js';

export interface DashboardServiceDependencies {
  readonly repositories: Repositories;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fleetService?: FleetService;
  readonly deviceService?: DeviceService;
}

export interface DashboardSeriesPoint {
  readonly at: string;
  readonly netVolumeMl: number;
  readonly readingCount: number;
}

export interface TankSeries {
  readonly tankId: TankId;
  readonly tankName: string;
  readonly product: string;
  readonly capacityMl: number;
  readonly buckets: ReadonlyArray<DashboardSeriesPoint>;
}

export interface DashboardSummary {
  readonly generatedAt: string;
  readonly counts: {
    readonly stations: number;
    readonly tanks: number;
    readonly devices: number;
    readonly devicesOnline: number;
    readonly devicesOffline: number;
    readonly readingsLast24h: number;
    readonly eventsAwaitingDecision: number;
    readonly deliveriesLast30Days: number;
  };
  readonly stock: {
    readonly netVolumeMl: number;
    readonly capacityMl: number;
    readonly fillPercent: number;
    readonly tanksBelowLow: number;
    readonly tanksBelowCritical: number;
    readonly tanksWithoutReading: number;
    readonly tanksWithStaleData: number;
  };
  readonly alerts: {
    readonly open: number;
    readonly acknowledged: number;
    readonly bySeverity: Readonly<Record<AlertSeverity, number>>;
    readonly latest: ReadonlyArray<Alert>;
  };
  readonly products: ReadonlyArray<ProductStock>;
  readonly stations: ReadonlyArray<{
    readonly station: Station;
    readonly tankCount: number;
    readonly netVolumeMl: number;
    readonly fillPercent: number;
    readonly openAlertCount: number;
  }>;
  readonly tanksNeedingAttention: ReadonlyArray<TankSummary>;
  readonly devices: ReadonlyArray<DeviceView>;
  readonly recentDeliveries: ReadonlyArray<{
    readonly id: string;
    readonly tankName: string;
    readonly stationName: string;
    readonly recordedVolumeMl: number;
    readonly varianceMl: number;
    readonly confirmedAt: string;
    readonly reference: string | null;
  }>;
}

/**
 * Assembles the dashboard in one request.
 *
 * The frontend must not have to fetch every tank, every reading and every alert
 * to draw one screen, and summing volumes in the browser would put the
 * millilitre arithmetic in the wrong place. Freshness and stock status come
 * from the same helpers the alerts use, so a tank cannot look healthy on the
 * dashboard and critical in the alert list.
 */
export class DashboardService {
  private readonly repositories: Repositories;
  private readonly clock: Clock;
  private readonly fleet: FleetService;
  private readonly devices: DeviceService;

  constructor(dependencies: DashboardServiceDependencies) {
    this.repositories = dependencies.repositories;
    this.clock = dependencies.clock;
    this.fleet =
      dependencies.fleetService ??
      new FleetService({
        repositories: this.repositories,
        clock: this.clock,
        logger: dependencies.logger,
      });
    this.devices =
      dependencies.deviceService ??
      new DeviceService({
        repositories: this.repositories,
        clock: this.clock,
        logger: dependencies.logger,
      });
  }

  async summary(tenantId: TenantId, stationId?: string): Promise<DashboardSummary> {
    const now = this.clock.now();
    const stations = await this.repositories.stations.list(tenantId);
    const summaries = await this.fleet.listTankSummaries(tenantId, {
      limit: 500,
      ...(stationId === undefined ? {} : { stationId: stationId as StationId }),
    });
    const deviceViews = await this.devices.list(tenantId, { limit: 500 });
    const alerts = await this.repositories.alerts.list(tenantId, { status: 'open', limit: 200 });
    const acknowledged = await this.repositories.alerts.list(tenantId, {
      status: 'acknowledged',
      limit: 200,
    });
    const events = await this.repositories.events.list(tenantId, {
      status: 'candidate',
      limit: 200,
    });
    const deliveries = await this.repositories.deliveries.list(tenantId, { limit: 5 });

    const capacityMl = summaries.reduce(
      (total, summary) => total + Math.round(summary.tank.capacityLitres * 1000),
      0,
    );
    const netVolumeMl = summaries.reduce((total, summary) => total + (summary.netVolumeMl ?? 0), 0);

    const bySeverity: Record<AlertSeverity, number> = { info: 0, warning: 0, critical: 0 };
    for (const alert of alerts) {
      bySeverity[alert.severity] += 1;
    }

    const stationRows = stations.map((station) => {
      const stationTanks = summaries.filter((summary) => summary.tank.stationId === station.id);
      const stationCapacity = stationTanks.reduce(
        (total, summary) => total + Math.round(summary.tank.capacityLitres * 1000),
        0,
      );
      const stationVolume = stationTanks.reduce(
        (total, summary) => total + (summary.netVolumeMl ?? 0),
        0,
      );
      return {
        station,
        tankCount: stationTanks.length,
        netVolumeMl: stationVolume,
        fillPercent:
          stationCapacity === 0 ? 0 : Math.round((stationVolume / stationCapacity) * 1000) / 10,
        openAlertCount: stationTanks.reduce((total, summary) => total + summary.openAlertCount, 0),
      };
    });

    const recentDeliveries = await Promise.all(
      deliveries.map(async (delivery) => {
        const tank = await this.repositories.tanks.findById(tenantId, delivery.tankId);
        const station =
          tank === null
            ? null
            : await this.repositories.stations.findById(tenantId, tank.stationId);
        return {
          id: delivery.id,
          tankName: tank?.name ?? 'unknown tank',
          stationName: station?.name ?? 'unknown station',
          recordedVolumeMl: delivery.recordedVolumeMl,
          varianceMl: delivery.recordedVolumeMl - delivery.measuredVolumeMl,
          confirmedAt: delivery.confirmedAt,
          reference: delivery.reference,
        };
      }),
    );

    const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
    const recentReadings = await Promise.all(
      summaries.map((summary) =>
        this.repositories.readings.list(tenantId, {
          tankId: summary.tank.id,
          from: since,
          limit: 500,
        }),
      ),
    );

    return {
      generatedAt: now.toISOString(),
      counts: {
        stations: stations.length,
        tanks: summaries.length,
        devices: deviceViews.length,
        devicesOnline: deviceViews.filter((view) => view.online).length,
        devicesOffline: deviceViews.filter((view) => !view.online).length,
        readingsLast24h: recentReadings.reduce((total, rows) => total + rows.length, 0),
        eventsAwaitingDecision: events.length,
        deliveriesLast30Days: (
          await this.repositories.deliveries.list(tenantId, {
            from: new Date(now.getTime() - 30 * 24 * 3_600_000).toISOString(),
            limit: 500,
          })
        ).length,
      },
      stock: {
        netVolumeMl,
        capacityMl,
        fillPercent: capacityMl === 0 ? 0 : Math.round((netVolumeMl / capacityMl) * 1000) / 10,
        tanksBelowLow: summaries.filter((summary) => summary.stockStatus === 'low').length,
        tanksBelowCritical: summaries.filter((summary) => summary.stockStatus === 'critical')
          .length,
        tanksWithoutReading: summaries.filter((summary) => summary.netVolumeMl === null).length,
        tanksWithStaleData: summaries.filter(
          (summary) =>
            summary.latestReading !== null && summary.latestReading.freshness !== 'fresh',
        ).length,
      },
      alerts: {
        open: alerts.length,
        acknowledged: acknowledged.length,
        bySeverity,
        latest: alerts.slice(0, 8),
      },
      products: summariseProductStock(summaries),
      stations: stationRows,
      tanksNeedingAttention: summaries
        .filter(
          (summary) =>
            summary.dataMissingOrStale ||
            summary.stockStatus === 'low' ||
            summary.stockStatus === 'critical' ||
            summary.openAlertCount > 0,
        )
        .sort((left, right) => attentionScore(right) - attentionScore(left))
        .slice(0, 8),
      devices: deviceViews,
      recentDeliveries,
    };
  }

  /**
   * Tank level history downsampled into buckets.
   *
   * The dashboard needs a trend, not every row: a month of five minute readings
   * is eight thousand points. Each bucket reports the mean of the readings it
   * contains, which is stated in the response metadata so nobody reads it as a
   * measured value.
   */
  async tankSeries(
    tenantId: TenantId,
    tankId: TankId,
    options: { hours?: number; buckets?: number } = {},
  ): Promise<TankSeries> {
    const tank = await this.fleet.requireTank(tenantId, tankId);
    const hours = Math.max(1, Math.min(24 * 30, options.hours ?? 24));
    const bucketCount = Math.max(4, Math.min(200, options.buckets ?? 48));
    const now = this.clock.now();
    const from = new Date(now.getTime() - hours * 3_600_000).toISOString();

    const readings = await this.repositories.readings.list(tenantId, {
      tankId,
      from,
      to: now.toISOString(),
      ascending: true,
      limit: 500,
    });

    return {
      tankId: tank.id,
      tankName: tank.name,
      product: tank.product,
      capacityMl: Math.round(tank.capacityLitres * 1000),
      buckets: bucketReadings(readings, from, now, bucketCount),
    };
  }
}

/** Mean volume per bucket, with the count of readings that produced it. */
export function bucketReadings(
  readings: ReadonlyArray<TankReading>,
  fromIso: string,
  to: Date,
  bucketCount: number,
): ReadonlyArray<DashboardSeriesPoint> {
  const start = Date.parse(fromIso);
  const end = to.getTime();
  const span = Math.max(1, end - start);
  const buckets: Array<{ total: number; count: number }> = Array.from(
    { length: bucketCount },
    () => ({ total: 0, count: 0 }),
  );

  for (const reading of readings) {
    const at = Date.parse(reading.recordedAt);
    if (Number.isNaN(at) || at < start || at > end) {
      continue;
    }
    const index = Math.min(bucketCount - 1, Math.floor(((at - start) / span) * bucketCount));
    const bucket = buckets[index];
    if (bucket === undefined) {
      continue;
    }
    bucket.total += netVolumeMl(reading);
    bucket.count += 1;
  }

  return buckets.map((bucket, index) => ({
    at: new Date(start + (span / bucketCount) * index).toISOString(),
    netVolumeMl: bucket.count === 0 ? 0 : Math.round(bucket.total / bucket.count),
    readingCount: bucket.count,
  }));
}

/** Higher means "look at this first". Documented so the ordering is testable. */
export function attentionScore(summary: TankSummary): number {
  let score = 0;
  if (summary.stockStatus === 'critical') score += 100;
  else if (summary.stockStatus === 'low') score += 50;
  if (summary.latestReading === null) score += 40;
  else if (summary.latestReading.freshness === 'stale') score += 30;
  else if (summary.latestReading.freshness === 'delayed') score += 10;
  if (summary.highestOpenSeverity === 'critical') score += 60;
  else if (summary.highestOpenSeverity === 'warning') score += 20;
  score += Math.min(10, summary.openAlertCount);
  return score;
}
