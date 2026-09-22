import {
  evaluateTankAlerts,
  materializeAlert,
  selectNewAlertDrafts,
  selectResolvedAlerts,
  type TankDeviceOnTank,
} from '../alerts/alert-engine.js';
import type { Alert, AlertDraft } from '../domain/alert.js';
import { DEFAULT_DEVICE_OFFLINE_MINUTES, type Device } from '../domain/device.js';
import type { FuelEvent } from '../domain/event.js';
import { deriveIdempotencyKey } from '../domain/idempotency.js';
import type { ProbeSample } from '../domain/normalize.js';
import { normalizeProbeSample } from '../domain/normalize.js';
import type { TankReading } from '../domain/reading.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { payloadFingerprint } from '../tenancy/ip-hash.js';
import type { Logger } from '../logging/logger.js';
import type { Clock } from '../ports/clock.js';
import type { RawMessageRecord, Repositories } from '../ports/repositories.js';
import type { DeviceId, RawMessageId, TenantId } from '../types/ids.js';
import { newId } from '../types/ids.js';
import { DeviceService } from './device-service.js';
import { EventService } from './event-service.js';

/**
 * Future clock skew tolerated on a device timestamp. A probe whose clock is
 * minutes ahead is normal; one reporting hours in the future would push the
 * ledger into the future and corrupt every freshness calculation, so it is
 * rejected with an explanatory error instead (TRD section 5).
 */
export const DEFAULT_MAX_FUTURE_SKEW_MINUTES = 10;

export interface IngestServiceDependencies {
  readonly repositories: Repositories;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How many recent readings to feed the alert and event rules. */
  readonly recentReadingCount?: number;
  readonly deviceService?: DeviceService;
  readonly eventService?: EventService;
  readonly maxFutureSkewMinutes?: number;
  readonly deviceOfflineAfterMinutes?: number;
}

export interface IngestContext {
  /** Principal that submitted the reading, for audit and event decisions. */
  readonly actorReference?: string;
  readonly rawPayload?: unknown;
}

export interface IngestResult {
  readonly reading: TankReading;
  readonly raisedAlerts: ReadonlyArray<Alert>;
  readonly resolvedAlerts: ReadonlyArray<Alert>;
  readonly raisedEvents: ReadonlyArray<FuelEvent>;
  /**
   * True when the submission was a retry of an observation already recorded.
   * The stored reading is returned unchanged and no rules are re-evaluated,
   * because re-running them against the same reading would raise duplicate
   * investigation alerts.
   */
  readonly duplicate: boolean;
}

/**
 * Single entry point for every tank observation, whether it arrives from a real
 * probe adapter, a manual dip or the simulator.
 *
 * The tenant id is always taken from the authenticated context, never from the
 * payload. The order of operations matters: identity first (so a retry is
 * recognised before anything is written), then validation, then the ledger, and
 * only then the rules, which read the ledger back.
 */
export class IngestService {
  private readonly repositories: Repositories;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly recentReadingCount: number;
  private readonly devices: DeviceService;
  private readonly events: EventService;
  private readonly maxFutureSkewMinutes: number;
  private readonly deviceOfflineAfterMinutes: number;

  constructor(dependencies: IngestServiceDependencies) {
    this.repositories = dependencies.repositories;
    this.clock = dependencies.clock;
    this.logger = dependencies.logger;
    this.recentReadingCount = dependencies.recentReadingCount ?? 32;
    this.maxFutureSkewMinutes =
      dependencies.maxFutureSkewMinutes ?? DEFAULT_MAX_FUTURE_SKEW_MINUTES;
    this.deviceOfflineAfterMinutes =
      dependencies.deviceOfflineAfterMinutes ?? DEFAULT_DEVICE_OFFLINE_MINUTES;
    this.devices =
      dependencies.deviceService ??
      new DeviceService({
        repositories: this.repositories,
        clock: this.clock,
        logger: this.logger,
        offlineAfterMinutes: this.deviceOfflineAfterMinutes,
      });
    this.events =
      dependencies.eventService ??
      new EventService({
        repositories: this.repositories,
        clock: this.clock,
        logger: this.logger,
      });
  }

  async ingest(
    tenantId: TenantId,
    sample: ProbeSample,
    context: IngestContext = {},
  ): Promise<IngestResult> {
    const tank = await this.repositories.tanks.findById(tenantId, sample.tankId);
    if (tank === null) {
      throw new NotFoundError('Tank', sample.tankId);
    }
    if (tank.status !== 'active') {
      throw new ConflictError(`Tank ${tank.id} is decommissioned and rejects new readings`);
    }

    this.assertTimestampWithinSkew(sample.observedAt);

    const deviceId = await this.resolveDevice(tenantId, sample, tank.id);

    // Resolve the submission identity before touching the ledger. A device that
    // retries an upload after a dropped connection must not create a second
    // reading, because a duplicated dip looks exactly like a sudden drop to the
    // event rules.
    const idempotencyKey =
      sample.idempotencyKey ??
      deriveIdempotencyKey({
        tenantId,
        tankId: tank.id,
        deviceId,
        observedAt: sample.observedAt,
      });

    const existing = await this.repositories.readings.findByIdempotencyKey(
      tenantId,
      idempotencyKey,
    );
    if (existing !== null) {
      this.logger.info('reading.duplicate.ignored', {
        tenantId,
        tankId: tank.id,
        readingId: existing.id,
        idempotencyKey,
        source: sample.source,
      });
      return {
        reading: existing,
        raisedAlerts: [],
        resolvedAlerts: [],
        raisedEvents: [],
        duplicate: true,
      };
    }

    const receivedAt = this.clock.now().toISOString();
    const rawMessage = await this.retainRawPayload(tenantId, sample, context, receivedAt);

    const reading = normalizeProbeSample(
      tank,
      { ...sample, deviceId },
      {
        tenantId,
        receivedAt,
        idempotencyKey,
        rawMessageId: rawMessage?.id ?? null,
      },
    );
    await this.repositories.readings.append(tenantId, reading);

    if (deviceId !== null) {
      await this.devices.markSeen(tenantId, deviceId, receivedAt);
    }

    const recent = await this.repositories.readings.list(tenantId, {
      tankId: tank.id,
      limit: this.recentReadingCount,
    });
    const ascending = [...recent].reverse();

    const outcome = await this.runRules(tenantId, tank, ascending);
    const { raisedAlerts: alertOutcomeRaised, resolvedAlerts, raisedEvents } = outcome;

    this.logger.info('reading.ingested', {
      tenantId,
      tankId: tank.id,
      readingId: reading.id,
      quality: reading.quality,
      source: reading.source,
      freshness: reading.freshness,
      netVolumeLitres: reading.netVolumeLitres,
      alertsRaised: alertOutcomeRaised.length,
      alertsResolved: resolvedAlerts.length,
      eventsRaised: raisedEvents.length,
    });

    return {
      reading,
      raisedAlerts: alertOutcomeRaised,
      resolvedAlerts,
      raisedEvents,
      duplicate: false,
    };
  }

  private assertTimestampWithinSkew(observedAt: string): void {
    const recorded = Date.parse(observedAt);
    if (Number.isNaN(recorded)) {
      throw new ValidationError('Reading timestamp is not a valid instant', [
        { path: 'observedAt', message: 'must be an ISO 8601 timestamp' },
      ]);
    }
    const skewMinutes = (recorded - this.clock.now().getTime()) / 60_000;
    if (skewMinutes > this.maxFutureSkewMinutes) {
      throw new ValidationError('Reading timestamp is too far in the future', [
        {
          path: 'observedAt',
          message: `is ${skewMinutes.toFixed(1)} minutes ahead of server time, limit is ${this.maxFutureSkewMinutes}`,
        },
      ]);
    }
  }

  /**
   * Resolves the reporting device. A hardware reading must come from a device
   * the operator registered and assigned to this tank, because accepting an
   * unknown serial number would let any credential write into the fuel ledger
   * under any name. Simulated identifiers are registered on first use, and only
   * for readings the caller already proved it may label as simulated.
   */
  private async resolveDevice(
    tenantId: TenantId,
    sample: ProbeSample,
    tankId: TankReading['tankId'],
  ): Promise<DeviceId | null> {
    if (sample.deviceId === null) {
      if (sample.source === 'device') {
        throw new ValidationError('A device reading must identify the device', [
          { path: 'deviceId', message: 'is required when source is device' },
        ]);
      }
      return null;
    }

    let found: Device | null = await this.repositories.devices.findById(
      tenantId,
      sample.deviceId as DeviceId,
    );
    if (found === null) {
      if (sample.source !== 'simulated') {
        throw new ValidationError('Unknown device', [
          { path: 'deviceId', message: 'is not registered for this tenant' },
        ]);
      }
      found = await this.devices.registerSimulated(tenantId, sample.deviceId as DeviceId);
    }
    const device: Device = found;
    if (device.status === 'retired') {
      throw new ConflictError(`Device ${device.id} is retired and may not submit readings`);
    }

    if (sample.source === 'device') {
      const assignment = await this.repositories.assignments.findActiveByDevice(
        tenantId,
        device.id,
      );
      if (assignment === null || assignment.tankId !== tankId) {
        throw new ForbiddenError('Device is not assigned to this tank');
      }
    } else if (sample.source === 'simulated') {
      const assignment = await this.repositories.assignments.findActiveByDevice(
        tenantId,
        device.id,
      );
      if (assignment === null) {
        // Keeps the simulated fleet coherent in the UI: a simulated reading
        // implies the simulated device measures this tank.
        await this.devices.assignToTank(tenantId, device.id, tankId);
      }
    }

    return device.id;
  }

  /**
   * Retains the submitted payload, unchanged, for troubleshooting (PRD device
   * management, TRD section 5). Deduplication is on the payload fingerprint, so
   * a retry stores nothing new. Access to these rows is scope restricted and
   * audited at the API layer.
   */
  private async retainRawPayload(
    tenantId: TenantId,
    sample: ProbeSample,
    context: IngestContext,
    receivedAt: string,
  ): Promise<RawMessageRecord | null> {
    const payload = context.rawPayload ?? {
      observedAt: sample.observedAt,
      levelMm: sample.levelMm,
      waterLevelMm: sample.waterLevelMm,
      temperatureC: sample.temperatureC,
      source: sample.source,
      deviceId: sample.deviceId,
    };
    const record: RawMessageRecord = {
      id: newId('raw') as RawMessageId,
      tenantId,
      deviceId: (sample.deviceId as DeviceId | null) ?? null,
      protocol:
        sample.source === 'simulated'
          ? 'simulated'
          : sample.source === 'manual'
            ? 'manual'
            : 'http',
      payload,
      messageHash: payloadFingerprint({
        tankId: sample.tankId,
        observedAt: sample.observedAt,
        payload,
      }),
      receivedAt,
    };
    try {
      return await this.repositories.rawMessages.save(tenantId, record);
    } catch (error) {
      // Raw retention is diagnostics, not the ledger: a failure here must not
      // reject a valid measurement, but it must be visible in the logs.
      this.logger.warn('reading.raw_payload.failed', {
        tenantId,
        tankId: sample.tankId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }
  }

  /**
   * Runs the alert and event rules for a tank against its recent readings.
   *
   * Shared by ingest (which calls it right after a reading is stored) and by
   * the alert sweep (which calls it on a timer so a tank that has gone silent
   * still raises stale data and device offline alerts). Both paths must produce
   * identical alerts, so there is exactly one implementation.
   */
  async runRules(
    tenantId: TenantId,
    tank: Parameters<typeof evaluateTankAlerts>[0]['tank'],
    readingsAscending: ReadonlyArray<TankReading>,
  ): Promise<{
    raisedAlerts: ReadonlyArray<Alert>;
    resolvedAlerts: ReadonlyArray<Alert>;
    raisedEvents: ReadonlyArray<FuelEvent>;
  }> {
    const alertOutcome = await this.evaluateAlerts(tenantId, tank, readingsAscending);
    const raisedEvents = await this.events.detectAndRecord(tenantId, tank, readingsAscending);
    const eventAlerts =
      raisedEvents.length === 0 ? [] : await this.raiseEventAlerts(tenantId, tank.id, raisedEvents);
    return {
      raisedAlerts: [...alertOutcome.raised, ...eventAlerts],
      resolvedAlerts: alertOutcome.resolved,
      raisedEvents,
    };
  }

  private async evaluateAlerts(
    tenantId: TenantId,
    tank: Parameters<typeof evaluateTankAlerts>[0]['tank'],
    ascending: ReadonlyArray<TankReading>,
  ): Promise<{ raised: ReadonlyArray<Alert>; resolved: ReadonlyArray<Alert> }> {
    const assigned = await this.assignedDevices(tenantId, tank.id);
    const evaluation = evaluateTankAlerts({
      tenantId,
      tank,
      readings: ascending,
      now: this.clock.now(),
      assignedDevices: assigned,
      deviceOfflineAfterMinutes: this.deviceOfflineAfterMinutes,
    });

    const now = this.clock.now();
    const candidates = await this.candidateAlertDrafts(tenantId, tank.id);
    const drafts = [...evaluation.drafts, ...candidates];
    const openAlerts = await this.repositories.alerts.listOpenByTank(tenantId, tank.id);

    const raised: Alert[] = [];
    for (const draft of selectNewAlertDrafts(drafts, openAlerts)) {
      raised.push(
        await this.repositories.alerts.save(tenantId, materializeAlert(draft, tenantId, now)),
      );
    }
    for (const stale of selectResolvedAlerts(drafts, openAlerts)) {
      await this.repositories.alerts.update(tenantId, {
        ...stale,
        status: 'resolved',
        resolvedAt: now.toISOString(),
        resolvedBy: 'system',
        updatedAt: now.toISOString(),
      });
    }
    return { raised, resolved: selectResolvedAlerts(drafts, openAlerts) };
  }

  /**
   * Alert drafts derived from open candidate events, so an alert stays open
   * while its event awaits a decision and closes when the event is decided.
   */
  private async candidateAlertDrafts(
    tenantId: TenantId,
    tankId: TankReading['tankId'],
  ): Promise<AlertDraft[]> {
    const events = await this.events.candidateEvents(tenantId, tankId);
    return events.map((event) => ({
      tankId: event.tankId,
      type:
        event.type === 'candidate_delivery'
          ? 'candidate_delivery'
          : 'candidate_unexplained_decrease',
      severity: event.type === 'candidate_delivery' ? 'info' : 'warning',
      message:
        event.type === 'candidate_delivery'
          ? `Candidate delivery of ${(Math.abs(event.volumeChangeMl) / 1000).toFixed(0)} L awaiting confirmation`
          : `Candidate unexplained decrease of ${(Math.abs(event.volumeChangeMl) / 1000).toFixed(0)} L awaiting investigation`,
      readingId: event.evidence.lastReadingId,
      metrics: {
        eventId: event.id,
        confidence: event.confidence,
        volumeChangeMl: event.volumeChangeMl,
      },
    }));
  }

  private async raiseEventAlerts(
    tenantId: TenantId,
    tankId: TankReading['tankId'],
    events: ReadonlyArray<FuelEvent>,
  ): Promise<ReadonlyArray<Alert>> {
    const now = this.clock.now();
    const raised: Alert[] = [];
    const openAlerts = await this.repositories.alerts.listOpenByTank(tenantId, tankId);
    const drafts: AlertDraft[] = events.map((event) => ({
      tankId: event.tankId,
      type:
        event.type === 'candidate_delivery'
          ? 'candidate_delivery'
          : 'candidate_unexplained_decrease',
      severity: event.type === 'candidate_delivery' ? 'info' : 'warning',
      message:
        event.type === 'candidate_delivery'
          ? `Candidate delivery of ${(Math.abs(event.volumeChangeMl) / 1000).toFixed(0)} L awaiting confirmation`
          : `Candidate unexplained decrease of ${(Math.abs(event.volumeChangeMl) / 1000).toFixed(0)} L awaiting investigation`,
      readingId: event.evidence.lastReadingId,
      metrics: {
        eventId: event.id,
        confidence: event.confidence,
        volumeChangeMl: event.volumeChangeMl,
      },
    }));
    for (const draft of selectNewAlertDrafts(drafts, openAlerts)) {
      raised.push(
        await this.repositories.alerts.save(tenantId, materializeAlert(draft, tenantId, now)),
      );
    }
    return raised;
  }

  private async assignedDevices(
    tenantId: TenantId,
    tankId: TankReading['tankId'],
  ): Promise<ReadonlyArray<TankDeviceOnTank>> {
    const assignments = await this.repositories.assignments.listActiveByTank(tenantId, tankId);
    const result: TankDeviceOnTank[] = [];
    for (const assignment of assignments) {
      const device = await this.repositories.devices.findById(tenantId, assignment.deviceId);
      if (device !== null) {
        result.push({ device, assignment });
      }
    }
    return result;
  }
}
