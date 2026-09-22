import { netVolumeMl } from '../domain/reading.js';
import { formatLitres, mlToLitres } from '../domain/quantity.js';
import { fillPercentMl, freeCapacityMl, stockStatus, usableCapacityMl } from '../domain/tank.js';
import type { FuelEvent } from '../domain/event.js';
import type { ReportTable } from '../reporting/report-table.js';
import type { Logger } from '../logging/logger.js';
import type { Clock } from '../ports/clock.js';
import type { Repositories } from '../ports/repositories.js';
import type { StationId, TankId, TenantId } from '../types/ids.js';
import { DeviceService } from './device-service.js';
import { EventService } from './event-service.js';
import { FleetService } from './fleet-service.js';

export const REPORT_NAMES = [
  'inventory',
  'stock-movement',
  'deliveries',
  'device-health',
  'alerts',
  'reconciliation',
] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export interface ReportQuery {
  readonly from?: string;
  readonly to?: string;
  readonly stationId?: StationId;
  readonly tankId?: TankId;
}

export interface ReportServiceDependencies {
  readonly repositories: Repositories;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fleetService?: FleetService;
  readonly deviceService?: DeviceService;
  readonly eventService?: EventService;
}

/**
 * Reporting (PRD section 5).
 *
 * Every report states its formula and its limitations in `notes`, because a
 * number without its derivation is exactly the kind of figure an operator will
 * over-trust. Reports never label a movement as theft: an unexplained decrease
 * is reported as a candidate requiring investigation.
 */
export class ReportService {
  private readonly repositories: Repositories;
  private readonly clock: Clock;
  private readonly fleet: FleetService;
  private readonly devices: DeviceService;
  private readonly events: EventService;

  constructor(dependencies: ReportServiceDependencies) {
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
    this.events =
      dependencies.eventService ??
      new EventService({
        repositories: this.repositories,
        clock: this.clock,
        logger: dependencies.logger,
      });
  }

  async build(tenantId: TenantId, report: ReportName, query: ReportQuery): Promise<ReportTable> {
    switch (report) {
      case 'inventory':
        return this.inventory(tenantId, query);
      case 'stock-movement':
        return this.stockMovement(tenantId, query);
      case 'deliveries':
        return this.deliveries(tenantId, query);
      case 'device-health':
        return this.deviceHealth(tenantId, query);
      case 'alerts':
        return this.alertHistory(tenantId, query);
      case 'reconciliation':
        return this.reconciliation(tenantId, query);
    }
  }

  async inventory(tenantId: TenantId, query: ReportQuery): Promise<ReportTable> {
    const summaries = await this.fleet.listTankSummaries(tenantId, {
      limit: 500,
      ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
    });
    const tanks =
      query.tankId === undefined
        ? summaries
        : summaries.filter((summary) => summary.tank.id === query.tankId);

    const rows = tanks.map((summary) => {
      const capacityMl = usableCapacityMl(summary.tank);
      const volumeMl = summary.netVolumeMl;
      return {
        station: summary.station?.name ?? 'unknown station',
        tank: summary.tank.name,
        product: summary.tank.product,
        status: summary.tank.status,
        capacityLitres: mlToLitres(capacityMl),
        netVolumeLitres: volumeMl === null ? null : mlToLitres(volumeMl),
        fillPercent: summary.fillPercent,
        freeCapacityLitres:
          volumeMl === null ? null : mlToLitres(freeCapacityMl(summary.tank, volumeMl)),
        stockStatus: summary.stockStatus,
        freshness: summary.latestReading?.freshness ?? 'no reading',
        quality: summary.latestReading?.quality ?? null,
        provenance: summary.latestReading?.provenance ?? null,
        lastReadingAt: summary.latestReading?.recordedAt ?? null,
        openAlerts: summary.openAlertCount,
      };
    });

    const totalVolumeMl = tanks.reduce((total, summary) => total + (summary.netVolumeMl ?? 0), 0);
    const totalCapacityMl = tanks.reduce(
      (total, summary) => total + usableCapacityMl(summary.tank),
      0,
    );

    return {
      report: 'inventory',
      title: 'Current inventory',
      generatedAt: this.clock.now().toISOString(),
      range: { from: null, to: null },
      columns: [
        { key: 'station', label: 'Station' },
        { key: 'tank', label: 'Tank' },
        { key: 'product', label: 'Product' },
        { key: 'status', label: 'Tank status' },
        { key: 'capacityLitres', label: 'Capacity (L)', align: 'right' },
        { key: 'netVolumeLitres', label: 'Net volume (L)', align: 'right' },
        { key: 'fillPercent', label: 'Fill (%)', align: 'right' },
        { key: 'freeCapacityLitres', label: 'Free capacity (L)', align: 'right' },
        { key: 'stockStatus', label: 'Stock status' },
        { key: 'freshness', label: 'Freshness' },
        { key: 'quality', label: 'Quality' },
        { key: 'provenance', label: 'Provenance' },
        { key: 'lastReadingAt', label: 'Last reading (UTC)' },
        { key: 'openAlerts', label: 'Open alerts', align: 'right' },
      ],
      rows,
      totals: {
        tank: `${tanks.length} tanks`,
        capacityLitres: mlToLitres(totalCapacityMl),
        netVolumeLitres: mlToLitres(totalVolumeMl),
        fillPercent:
          totalCapacityMl === 0 ? 0 : Math.round((totalVolumeMl / totalCapacityMl) * 1000) / 10,
      },
      notes: [
        'Net volume is product volume excluding free water, derived from the tank geometry and the latest usable reading.',
        'Capacity is the safe working capacity configured for the tank, not its geometric capacity.',
        'A tank with no usable reading shows no volume: a stale or invalid reading is never presented as current stock.',
      ],
    };
  }

  /**
   * Stock movement per tank: opening and closing volumes at the window edges,
   * the extremes inside the window, and the recorded deliveries.
   */
  async stockMovement(tenantId: TenantId, query: ReportQuery): Promise<ReportTable> {
    const range = this.resolveRange(query, 24);
    const summaries = await this.fleet.listTankSummaries(tenantId, {
      limit: 500,
      ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
    });
    const tanks =
      query.tankId === undefined
        ? summaries
        : summaries.filter((summary) => summary.tank.id === query.tankId);

    const rows: Array<Record<string, string | number | null>> = [];
    let totalChangeMl = 0;
    let totalDeliveredMl = 0;

    for (const summary of tanks) {
      const tank = summary.tank;
      const before = await this.repositories.readings.list(tenantId, {
        tankId: tank.id,
        to: range.from,
        limit: 1,
      });
      const within = await this.repositories.readings.list(tenantId, {
        tankId: tank.id,
        from: range.from,
        to: range.to,
        limit: 500,
      });
      const closing = within[0] ?? before[0] ?? null;
      const opening = before[0] ?? null;
      const usable = within.filter((reading) => reading.quality !== 'invalid');
      const volumes = usable.map(netVolumeMl);
      const deliveredMl = await this.events.deliveredVolumeMl(
        tenantId,
        tank.id,
        range.from,
        range.to,
      );
      const changeMl =
        opening !== null && closing !== null ? netVolumeMl(closing) - netVolumeMl(opening) : null;
      totalChangeMl += changeMl ?? 0;
      totalDeliveredMl += deliveredMl;

      rows.push({
        station: summary.station?.name ?? 'unknown station',
        tank: tank.name,
        product: tank.product,
        openingLitres: opening === null ? null : mlToLitres(netVolumeMl(opening)),
        closingLitres: closing === null ? null : mlToLitres(netVolumeMl(closing)),
        changeLitres: changeMl === null ? null : mlToLitres(changeMl),
        minimumLitres: volumes.length === 0 ? null : mlToLitres(Math.min(...volumes)),
        maximumLitres: volumes.length === 0 ? null : mlToLitres(Math.max(...volumes)),
        readings: within.length,
        invalidReadings: within.length - usable.length,
        deliveredLitres: mlToLitres(deliveredMl),
      });
    }

    return {
      report: 'stock-movement',
      title: 'Stock movement',
      generatedAt: this.clock.now().toISOString(),
      range,
      columns: [
        { key: 'station', label: 'Station' },
        { key: 'tank', label: 'Tank' },
        { key: 'product', label: 'Product' },
        { key: 'openingLitres', label: 'Opening (L)', align: 'right' },
        { key: 'closingLitres', label: 'Closing (L)', align: 'right' },
        { key: 'changeLitres', label: 'Change (L)', align: 'right' },
        { key: 'minimumLitres', label: 'Minimum (L)', align: 'right' },
        { key: 'maximumLitres', label: 'Maximum (L)', align: 'right' },
        { key: 'deliveredLitres', label: 'Confirmed deliveries (L)', align: 'right' },
        { key: 'readings', label: 'Readings', align: 'right' },
        { key: 'invalidReadings', label: 'Invalid readings', align: 'right' },
      ],
      rows,
      totals: {
        tank: `${rows.length} tanks`,
        changeLitres: mlToLitres(totalChangeMl),
        deliveredLitres: mlToLitres(totalDeliveredMl),
      },
      notes: [
        `Opening is the last reading at or before ${range.from}; closing is the latest reading at or before ${range.to}.`,
        'Change is closing minus opening. It includes deliveries, withdrawals and any measurement error.',
        'Invalid readings are excluded from every volume column and counted separately.',
      ],
    };
  }

  async deliveries(tenantId: TenantId, query: ReportQuery): Promise<ReportTable> {
    const range = this.resolveRange(query, 24 * 30);
    const deliveries = await this.events.listDeliveries(tenantId, {
      limit: 500,
      from: range.from,
      to: range.to,
      ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
    });

    const rows = deliveries.map((entry) => ({
      confirmedAt: entry.delivery.confirmedAt,
      station: entry.stationName,
      tank: entry.tankName,
      product: entry.product,
      reference: entry.delivery.reference,
      supplier: entry.delivery.supplier,
      measuredLitres: mlToLitres(entry.delivery.measuredVolumeMl),
      recordedLitres: mlToLitres(entry.delivery.recordedVolumeMl),
      varianceLitres: mlToLitres(entry.varianceMl),
      variancePercent:
        entry.variancePercent === null ? null : Math.round(entry.variancePercent * 100) / 100,
      confirmedBy: entry.delivery.confirmedBy,
    }));

    const measured = deliveries.reduce(
      (total, entry) => total + entry.delivery.measuredVolumeMl,
      0,
    );
    const recorded = deliveries.reduce(
      (total, entry) => total + entry.delivery.recordedVolumeMl,
      0,
    );

    return {
      report: 'deliveries',
      title: 'Confirmed deliveries',
      generatedAt: this.clock.now().toISOString(),
      range,
      columns: [
        { key: 'confirmedAt', label: 'Confirmed (UTC)' },
        { key: 'station', label: 'Station' },
        { key: 'tank', label: 'Tank' },
        { key: 'product', label: 'Product' },
        { key: 'reference', label: 'Reference' },
        { key: 'supplier', label: 'Supplier' },
        { key: 'measuredLitres', label: 'Measured (L)', align: 'right' },
        { key: 'recordedLitres', label: 'Recorded (L)', align: 'right' },
        { key: 'varianceLitres', label: 'Variance (L)', align: 'right' },
        { key: 'variancePercent', label: 'Variance (%)', align: 'right' },
        { key: 'confirmedBy', label: 'Confirmed by' },
      ],
      rows,
      totals: {
        tank: `${rows.length} deliveries`,
        measuredLitres: mlToLitres(measured),
        recordedLitres: mlToLitres(recorded),
        varianceLitres: mlToLitres(recorded - measured),
      },
      notes: [
        'Measured volume is the increase the probe observed across the event window.',
        'Recorded volume is what the operator or supplier docket states was delivered.',
        'Variance is recorded minus measured. It is a question to investigate, never a conclusion about a person or a supplier.',
      ],
    };
  }

  async deviceHealth(tenantId: TenantId, query: ReportQuery): Promise<ReportTable> {
    const views = await this.devices.health(
      tenantId,
      query.stationId === undefined ? undefined : query.stationId,
    );
    const rows = views.map((view) => ({
      serialNumber: view.device.serialNumber,
      manufacturer: view.device.manufacturer,
      model: view.device.model,
      protocol: view.device.protocol,
      status: view.device.status,
      connection: view.online ? 'online' : 'offline',
      lastSeenAt: view.device.lastSeenAt,
      silentMinutes:
        view.minutesSinceLastSeen === null ? null : Math.round(view.minutesSinceLastSeen),
      station: view.stationName ?? 'unassigned',
      tank: view.tankName ?? 'unassigned',
      firmware: view.device.firmwareVersion,
    }));

    return {
      report: 'device-health',
      title: 'Device health',
      generatedAt: this.clock.now().toISOString(),
      range: { from: null, to: null },
      columns: [
        { key: 'serialNumber', label: 'Serial number' },
        { key: 'manufacturer', label: 'Manufacturer' },
        { key: 'model', label: 'Model' },
        { key: 'protocol', label: 'Protocol' },
        { key: 'status', label: 'Lifecycle status' },
        { key: 'connection', label: 'Connection' },
        { key: 'lastSeenAt', label: 'Last seen (UTC)' },
        { key: 'silentMinutes', label: 'Silent (minutes)', align: 'right' },
        { key: 'station', label: 'Station' },
        { key: 'tank', label: 'Tank' },
        { key: 'firmware', label: 'Firmware' },
      ],
      rows,
      totals: {
        serialNumber: `${rows.length} devices`,
        connection: `${rows.filter((row) => row.connection === 'online').length} online`,
      },
      notes: [
        'A device is offline when it has not reported within the platform offline window, or has never reported.',
        'A registered device that has never reported is shown as offline on purpose: it is not delivering data.',
      ],
    };
  }

  async alertHistory(tenantId: TenantId, query: ReportQuery): Promise<ReportTable> {
    const range = this.resolveRange(query, 24 * 30);
    const alerts = await this.repositories.alerts.list(tenantId, { limit: 500 });
    const filtered = alerts.filter((alert) => {
      const raised = Date.parse(alert.raisedAt);
      if (raised < Date.parse(range.from)) return false;
      if (raised > Date.parse(range.to)) return false;
      if (query.tankId !== undefined && alert.tankId !== query.tankId) return false;
      return true;
    });

    const rows = await Promise.all(
      filtered.map(async (alert) => {
        const tank =
          alert.tankId === null
            ? null
            : await this.repositories.tanks.findById(tenantId, alert.tankId);
        const station =
          tank === null
            ? null
            : await this.repositories.stations.findById(tenantId, tank.stationId);
        return {
          raisedAt: alert.raisedAt,
          station: station?.name ?? null,
          tank: tank?.name ?? null,
          type: alert.type,
          severity: alert.severity,
          status: alert.status,
          message: alert.message,
          acknowledgedAt: alert.acknowledgedAt,
          resolvedAt: alert.resolvedAt,
          ageHours:
            Math.round(
              ((this.clock.now().getTime() - Date.parse(alert.raisedAt)) / 3_600_000) * 10,
            ) / 10,
        };
      }),
    );

    return {
      report: 'alerts',
      title: 'Alert history',
      generatedAt: this.clock.now().toISOString(),
      range,
      columns: [
        { key: 'raisedAt', label: 'Raised (UTC)' },
        { key: 'station', label: 'Station' },
        { key: 'tank', label: 'Tank' },
        { key: 'type', label: 'Type' },
        { key: 'severity', label: 'Severity' },
        { key: 'status', label: 'Status' },
        { key: 'message', label: 'Message' },
        { key: 'acknowledgedAt', label: 'Acknowledged (UTC)' },
        { key: 'resolvedAt', label: 'Resolved (UTC)' },
        { key: 'ageHours', label: 'Age (hours)', align: 'right' },
      ],
      rows,
      totals: {
        raisedAt: `${rows.length} alerts`,
        status: `${rows.filter((row) => row.status !== 'resolved').length} unresolved`,
      },
      notes: [
        'Alerts are operational conditions. Candidate events are recorded separately and require an operator decision.',
        'An alert is resolved automatically when its condition is no longer observed, or manually by an operator.',
      ],
    };
  }

  /**
   * Reconciliation: what moved, what was recorded, and what is left over.
   *
   * The identity used is
   *   unexplained = closing - opening - confirmed deliveries recorded
   * and it is presented as a residual to investigate, with the candidate
   * unexplained decreases listed alongside it.
   */
  async reconciliation(tenantId: TenantId, query: ReportQuery): Promise<ReportTable> {
    const range = this.resolveRange(query, 24 * 7);
    const summaries = await this.fleet.listTankSummaries(tenantId, {
      limit: 500,
      ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
    });
    const tanks =
      query.tankId === undefined
        ? summaries
        : summaries.filter((summary) => summary.tank.id === query.tankId);

    const rows: Array<Record<string, string | number | null>> = [];
    let totalResidualMl = 0;

    for (const summary of tanks) {
      const tank = summary.tank;
      const before = await this.repositories.readings.list(tenantId, {
        tankId: tank.id,
        to: range.from,
        limit: 1,
      });
      const within = await this.repositories.readings.list(tenantId, {
        tankId: tank.id,
        from: range.from,
        to: range.to,
        limit: 500,
      });
      const opening = before[0] ?? null;
      const closing = within[0] ?? null;
      const deliveredMl = await this.events.deliveredVolumeMl(
        tenantId,
        tank.id,
        range.from,
        range.to,
      );
      const decreases = await this.events.eventsInWindow(tenantId, {
        tankId: tank.id,
        type: 'candidate_unexplained_decrease',
        from: range.from,
        to: range.to,
      });
      const candidateDecreaseMl = decreases.reduce(
        (total, event: FuelEvent) => total + Math.abs(event.volumeChangeMl),
        0,
      );

      const openingMl = opening === null ? null : netVolumeMl(opening);
      const closingMl = closing === null ? null : netVolumeMl(closing);
      const residualMl =
        openingMl === null || closingMl === null ? null : closingMl - openingMl - deliveredMl;
      totalResidualMl += residualMl ?? 0;

      rows.push({
        station: summary.station?.name ?? 'unknown station',
        tank: tank.name,
        product: tank.product,
        openingLitres: openingMl === null ? null : mlToLitres(openingMl),
        closingLitres: closingMl === null ? null : mlToLitres(closingMl),
        deliveredLitres: mlToLitres(deliveredMl),
        residualLitres: residualMl === null ? null : mlToLitres(residualMl),
        residualPercent:
          openingMl === null || openingMl === 0 || residualMl === null
            ? null
            : Math.round((residualMl / openingMl) * 10000) / 100,
        candidateDecreaseLitres: mlToLitres(candidateDecreaseMl),
        candidateEvents: decreases.length,
        capacityPercent:
          closingMl === null ? null : Math.round(fillPercentMl(tank, closingMl) * 10) / 10,
        stockStatus: closingMl === null ? null : stockStatus(tank, closingMl),
      });
    }

    return {
      report: 'reconciliation',
      title: 'Stock reconciliation',
      generatedAt: this.clock.now().toISOString(),
      range,
      columns: [
        { key: 'station', label: 'Station' },
        { key: 'tank', label: 'Tank' },
        { key: 'product', label: 'Product' },
        { key: 'openingLitres', label: 'Opening (L)', align: 'right' },
        { key: 'closingLitres', label: 'Closing (L)', align: 'right' },
        { key: 'deliveredLitres', label: 'Confirmed deliveries (L)', align: 'right' },
        { key: 'residualLitres', label: 'Residual (L)', align: 'right' },
        { key: 'residualPercent', label: 'Residual (%)', align: 'right' },
        { key: 'candidateDecreaseLitres', label: 'Candidate decreases (L)', align: 'right' },
        { key: 'candidateEvents', label: 'Candidate events', align: 'right' },
        { key: 'capacityPercent', label: 'Closing fill (%)', align: 'right' },
        { key: 'stockStatus', label: 'Stock status' },
      ],
      rows,
      totals: {
        tank: `${rows.length} tanks`,
        residualLitres: mlToLitres(totalResidualMl),
      },
      notes: [
        'Residual = closing - opening - confirmed deliveries recorded in the window. A negative residual means stock fell further than the recorded deliveries explain.',
        'Candidate decreases are events the platform could not explain from the data it holds. They are not conclusions, and no movement is ever classified as theft automatically.',
        'Dispenser and POS data is not integrated yet, so sales are not deducted. Until it is, every residual includes unreconciled sales.',
        `Residual percent is the residual divided by the opening volume. Volumes are net product litres, water excluded. Example: ${formatLitres(1234567, 1)} L renders as 1234.6 L.`,
      ],
    };
  }

  private resolveRange(query: ReportQuery, defaultHours: number): { from: string; to: string } {
    const now = this.clock.now();
    const to = query.to ?? now.toISOString();
    const from = query.from ?? new Date(Date.parse(to) - defaultHours * 3_600_000).toISOString();
    return { from, to };
  }
}
