import type { Logger } from '../logging/logger.js';
import type { Clock } from '../ports/clock.js';
import type { Repositories } from '../ports/repositories.js';
import type { TenantId } from '../types/ids.js';
import { IngestService } from './ingest-service.js';

export interface AlertSweepServiceDependencies {
  readonly repositories: Repositories;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly ingestService?: IngestService;
  readonly recentReadingCount?: number;
}

export interface SweepResult {
  readonly tanksEvaluated: number;
  readonly alertsRaised: number;
  readonly alertsResolved: number;
  readonly eventsRaised: number;
  readonly failingTanks: number;
}

const EMPTY_RESULT: SweepResult = {
  tanksEvaluated: 0,
  alertsRaised: 0,
  alertsResolved: 0,
  eventsRaised: 0,
  failingTanks: 0,
};

/**
 * Periodic evaluation of the alert and event rules.
 *
 * Ingest covers a tank that is reporting. This covers the case that matters
 * most operationally: a tank that has *stopped* reporting, where the latest
 * reading silently ages into stale data and its device goes offline. Neither
 * condition can be raised by a new reading, because there is no new reading.
 *
 * Runs inside the long lived server, and behind a scheduled request in
 * serverless deployments (the scheduler cannot live in a function that only
 * runs on demand).
 */
export class AlertSweepService {
  private readonly repositories: Repositories;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly ingest: IngestService;
  private readonly recentReadingCount: number;

  constructor(dependencies: AlertSweepServiceDependencies) {
    this.repositories = dependencies.repositories;
    this.clock = dependencies.clock;
    this.logger = dependencies.logger;
    this.recentReadingCount = dependencies.recentReadingCount ?? 32;
    this.ingest =
      dependencies.ingestService ??
      new IngestService({
        repositories: this.repositories,
        clock: this.clock,
        logger: this.logger,
        recentReadingCount: this.recentReadingCount,
      });
  }

  async sweepTenant(tenantId: TenantId): Promise<SweepResult> {
    const tanks = await this.repositories.tanks.list(tenantId, { status: 'active', limit: 500 });
    let alertsRaised = 0;
    let alertsResolved = 0;
    let eventsRaised = 0;
    let failingTanks = 0;

    for (const tank of tanks) {
      try {
        const readings = await this.repositories.readings.list(tenantId, {
          tankId: tank.id,
          limit: this.recentReadingCount,
        });
        const outcome = await this.ingest.runRules(tenantId, tank, [...readings].reverse());
        alertsRaised += outcome.raisedAlerts.length;
        alertsResolved += outcome.resolvedAlerts.length;
        eventsRaised += outcome.raisedEvents.length;
      } catch (error) {
        // One bad tank must not stop the sweep: the remaining tanks still need
        // their stale and offline conditions evaluated.
        failingTanks += 1;
        this.logger.error('alert.sweep.tank_failed', {
          tenantId,
          tankId: tank.id,
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }
    }

    if (alertsRaised > 0 || alertsResolved > 0 || eventsRaised > 0) {
      this.logger.info('alert.sweep.completed', {
        tenantId,
        tanksEvaluated: tanks.length,
        alertsRaised,
        alertsResolved,
        eventsRaised,
      });
    }

    return {
      tanksEvaluated: tanks.length,
      alertsRaised,
      alertsResolved,
      eventsRaised,
      failingTanks,
    };
  }

  /** Every tenant, used by the platform scheduler. */
  async sweepAllTenants(): Promise<SweepResult> {
    const tenants = await this.repositories.tenants.list(500);
    let result: SweepResult = EMPTY_RESULT;
    for (const tenant of tenants) {
      const tenantResult = await this.sweepTenant(tenant.id);
      result = {
        tanksEvaluated: result.tanksEvaluated + tenantResult.tanksEvaluated,
        alertsRaised: result.alertsRaised + tenantResult.alertsRaised,
        alertsResolved: result.alertsResolved + tenantResult.alertsResolved,
        eventsRaised: result.eventsRaised + tenantResult.eventsRaised,
        failingTanks: result.failingTanks + tenantResult.failingTanks,
      };
    }
    return result;
  }
}
