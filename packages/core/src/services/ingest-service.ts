import {
  evaluateTankAlarms,
  materializeAlarm,
  selectNewAlarmDrafts,
  selectResolvedAlarms,
} from '../alarms/alarm-engine.js';
import type { Alarm } from '../domain/alarm.js';
import type { ProbeSample } from '../domain/normalize.js';
import { normalizeProbeSample } from '../domain/normalize.js';
import type { TankReading } from '../domain/reading.js';
import { ConflictError, NotFoundError, TenantIsolationError } from '../errors.js';
import type { Logger } from '../logging/logger.js';
import type { Clock } from '../ports/clock.js';
import type { Repositories } from '../ports/repositories.js';
import type { TenantId } from '../types/ids.js';

export interface IngestServiceDependencies {
  readonly repositories: Repositories;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How many recent readings to feed the alarm rules. */
  readonly recentReadingCount?: number;
}

export interface IngestResult {
  readonly reading: TankReading;
  readonly raisedAlarms: ReadonlyArray<Alarm>;
  readonly resolvedAlarms: ReadonlyArray<Alarm>;
}

/**
 * Single entry point for every tank observation, whether it arrives from a
 * real probe adapter, a manual dip or the simulator. The tenant id is always
 * taken from the authenticated context, never from the payload.
 */
export class IngestService {
  private readonly repositories: Repositories;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly recentReadingCount: number;

  constructor(dependencies: IngestServiceDependencies) {
    this.repositories = dependencies.repositories;
    this.clock = dependencies.clock;
    this.logger = dependencies.logger;
    this.recentReadingCount = dependencies.recentReadingCount ?? 32;
  }

  async ingest(tenantId: TenantId, sample: ProbeSample): Promise<IngestResult> {
    try {
      const tank = await this.repositories.tanks.findById(tenantId, sample.tankId);
      if (tank === null) {
        throw new NotFoundError('Tank', sample.tankId);
      }
      if (tank.status !== 'active') {
        throw new ConflictError(`Tank ${tank.id} is decommissioned and rejects new readings`);
      }

      const receivedAt = this.clock.now().toISOString();
      const reading = normalizeProbeSample(tank, sample, { tenantId, receivedAt });
      await this.repositories.readings.append(tenantId, reading);

      const recent = await this.repositories.readings.list(tenantId, {
        tankId: tank.id,
        limit: this.recentReadingCount,
      });
      const ascending = [...recent].reverse();

      const evaluation = evaluateTankAlarms({
        tenantId,
        tank,
        readings: ascending,
        now: this.clock.now(),
      });

      const openAlarms = await this.repositories.alarms.listOpenByTank(tenantId, tank.id);
      const newDrafts = selectNewAlarmDrafts(evaluation.drafts, openAlarms);

      const raisedAlarms: Alarm[] = [];
      for (const candidate of newDrafts) {
        const alarm = materializeAlarm(candidate, tenantId, this.clock.now());
        raisedAlarms.push(await this.repositories.alarms.save(tenantId, alarm));
      }

      const resolvedAlarms: Alarm[] = [];
      for (const stale of selectResolvedAlarms(evaluation.drafts, openAlarms)) {
        resolvedAlarms.push(
          await this.repositories.alarms.update(tenantId, {
            ...stale,
            status: 'resolved',
            updatedAt: this.clock.now().toISOString(),
          }),
        );
      }

      this.logger.info('reading.ingested', {
        tenantId,
        tankId: tank.id,
        readingId: reading.id,
        quality: reading.quality,
        source: reading.source,
        netVolumeLitres: reading.netVolumeLitres,
        alarmsRaised: raisedAlarms.length,
      });

      return { reading, raisedAlarms, resolvedAlarms };
    } catch (error) {
      if (error instanceof TenantIsolationError) {
        this.logger.critical('tenant.isolation.violation', {
          operation: error.operation,
          expectedTenantId: error.expectedTenantId,
          actualTenantId: error.actualTenantId,
        });
      } else {
        this.logger.error('reading.ingest.failed', {
          tenantId,
          tankId: sample.tankId,
          reason: error instanceof Error ? error.constructor.name : 'unknown',
        });
      }
      throw error;
    }
  }
}
