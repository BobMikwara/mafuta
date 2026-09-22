import type { Delivery, DeliveryWithContext } from '../domain/delivery.js';
import {
  DEFAULT_EXPLANATIONS_FOR_DECREASE,
  DEFAULT_EXPLANATIONS_FOR_DELIVERY,
  type FuelEvent,
  type FuelEventType,
} from '../domain/event.js';
import { deliveryVarianceMl } from '../domain/delivery.js';
import { litresToMl, mlToLitres } from '../domain/quantity.js';
import type { Tank } from '../domain/tank.js';
import type { TankReading } from '../domain/reading.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { Logger } from '../logging/logger.js';
import type { Clock } from '../ports/clock.js';
import type { DeliveryQuery, EventQuery, Repositories } from '../ports/repositories.js';
import {
  newId,
  type FuelEventId,
  type StationId,
  type TankId,
  type TenantId,
} from '../types/ids.js';
import type { ConfirmEventInput, ListEventsQuery } from '../validation/schemas.js';
import { detectTankEvents } from '../events/detection.js';

export interface EventServiceDependencies {
  readonly repositories: Repositories;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Event with the tank and station names a reviewer needs. */
export interface EventView {
  readonly event: FuelEvent;
  readonly tankName: string | null;
  readonly stationName: string | null;
  readonly product: string | null;
  /** Signed volume change in litres, for display. The stored value is millilitres. */
  readonly volumeChangeLitres: number;
}

export interface ConfirmEventResult {
  readonly event: FuelEvent;
  readonly delivery: Delivery;
  readonly varianceMl: number;
}

/**
 * Candidate events and deliveries (PRD sections 5 and 6).
 *
 * The service records what was observed and what a person decided. It never
 * labels a movement with a cause: `candidate_unexplained_decrease` is the
 * strongest statement the platform makes on its own, and it is deliberately a
 * description of the platform's knowledge, not of anyone's intent.
 */
export class EventService {
  private readonly repositories: Repositories;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(dependencies: EventServiceDependencies) {
    this.repositories = dependencies.repositories;
    this.clock = dependencies.clock;
    this.logger = dependencies.logger;
  }

  /**
   * Runs detection for a tank and persists any new candidate.
   *
   * Existing events are consulted so that one movement is recorded once even
   * though detection runs again after every reading.
   */
  async detectAndRecord(
    tenantId: TenantId,
    tank: Tank,
    readingsAscending: ReadonlyArray<TankReading>,
  ): Promise<ReadonlyArray<FuelEvent>> {
    const since = new Date(
      this.clock.now().getTime() - DEFAULT_DUPLICATE_LOOKBACK_HOURS * 3_600_000,
    ).toISOString();
    const existing = await this.repositories.events.listRecentByTank(
      tenantId,
      tank.id,
      RECENT_EVENT_LOOKBACK_LIMIT,
      since,
    );
    const drafts = detectTankEvents({
      tank,
      readings: readingsAscending,
      existingEvents: existing,
    });
    const created: FuelEvent[] = [];

    for (const draft of drafts) {
      const now = this.clock.now().toISOString();
      const event: FuelEvent = {
        id: newId('evt') as FuelEventId,
        tenantId,
        tankId: draft.tankId,
        type: draft.type,
        status: 'candidate',
        confidence: draft.confidence,
        volumeChangeMl: draft.volumeChangeMl,
        windowStart: draft.windowStart,
        windowEnd: draft.windowEnd,
        evidence: draft.evidence,
        notes: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const saved = await this.repositories.events.save(tenantId, event);
      created.push(saved);
      this.logger.info('event.candidate.recorded', {
        tenantId,
        tankId: tank.id,
        eventId: saved.id,
        type: saved.type,
        confidence: saved.confidence,
      });
    }

    return created;
  }

  async list(tenantId: TenantId, query: ListEventsQuery): Promise<ReadonlyArray<EventView>> {
    const filter: EventQuery = {
      ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      limit: query.limit,
    };
    const events = await this.repositories.events.list(tenantId, filter);
    return this.decorate(tenantId, events);
  }

  async detail(tenantId: TenantId, eventId: FuelEventId): Promise<EventView> {
    const event = await this.requireEvent(tenantId, eventId);
    const [view] = await this.decorate(tenantId, [event]);
    if (view === undefined) {
      throw new NotFoundError('Fuel event', eventId);
    }
    return view;
  }

  async requireEvent(tenantId: TenantId, eventId: FuelEventId): Promise<FuelEvent> {
    const event = await this.repositories.events.findById(tenantId, eventId);
    if (event === null) {
      throw new NotFoundError('Fuel event', eventId);
    }
    return event;
  }

  /**
   * Confirms a candidate as a delivery and records it.
   *
   * `recordedVolumeLitres` is what the supplier docket says. When the operator
   * does not supply it, the measured rise is stored as the recorded volume as
   * well: the platform then knows that no independent figure was entered, and
   * the reconciliation report shows a zero variance rather than a fabricated
   * discrepancy.
   */
  async confirm(
    tenantId: TenantId,
    eventId: FuelEventId,
    input: ConfirmEventInput,
    actorReference: string,
  ): Promise<ConfirmEventResult> {
    const event = await this.requireEvent(tenantId, eventId);
    if (event.status !== 'candidate') {
      throw new ConflictError(`Event ${eventId} has already been ${event.status}`);
    }
    if (event.type !== 'candidate_delivery') {
      throw new ValidationError('Only a candidate delivery can be confirmed as a delivery', [
        { path: 'eventId', message: `event type is ${event.type}` },
      ]);
    }

    const measuredMl = Math.abs(event.volumeChangeMl);
    if (measuredMl <= 0) {
      throw new ValidationError('The candidate has no measurable volume change', [
        { path: 'eventId', message: 'volumeChangeMl is zero' },
      ]);
    }
    const recordedMl =
      input.recordedVolumeLitres === undefined
        ? measuredMl
        : litresToMl(input.recordedVolumeLitres);
    if (recordedMl <= 0) {
      throw new ValidationError('Recorded volume must be greater than zero', [
        { path: 'recordedVolumeLitres', message: 'must be greater than zero' },
      ]);
    }

    const now = this.clock.now().toISOString();
    const existing = await this.repositories.deliveries.listByEvent(tenantId, eventId);
    if (existing.length > 0) {
      // A retried confirmation must not create a second delivery record for one
      // physical delivery.
      throw new ConflictError(`Event ${eventId} already has a delivery record`);
    }

    const delivery: Delivery = {
      id: newId('dlv'),
      tenantId,
      tankId: event.tankId,
      fuelEventId: event.id,
      measuredVolumeMl: measuredMl,
      recordedVolumeMl: recordedMl,
      reference: input.reference ?? null,
      supplier: input.supplier ?? null,
      confirmedBy: actorReference,
      confirmedAt: now,
      createdAt: now,
    };
    const savedDelivery = await this.repositories.deliveries.save(tenantId, delivery);

    const updated = await this.repositories.events.update(tenantId, {
      ...event,
      status: 'confirmed',
      decidedBy: actorReference,
      decidedAt: now,
      notes: input.note ?? event.notes,
      updatedAt: now,
    });

    const varianceMl = recordedMl - measuredMl;
    this.logger.info('delivery.confirmed', {
      tenantId,
      tankId: event.tankId,
      eventId,
      deliveryId: savedDelivery.id,
      measuredMl,
      recordedMl,
      varianceMl,
    });

    return { event: updated, delivery: savedDelivery, varianceMl };
  }

  /**
   * Rejects a candidate. The event stays in the ledger as rejected, with the
   * reason, so a later reviewer can see that a human considered the movement
   * and why they dismissed it.
   */
  async reject(
    tenantId: TenantId,
    eventId: FuelEventId,
    input: { note: string },
    actorReference: string,
  ): Promise<FuelEvent> {
    const event = await this.requireEvent(tenantId, eventId);
    if (event.status !== 'candidate') {
      throw new ConflictError(`Event ${eventId} has already been ${event.status}`);
    }
    const now = this.clock.now().toISOString();
    const updated = await this.repositories.events.update(tenantId, {
      ...event,
      status: 'rejected',
      notes: input.note,
      decidedBy: actorReference,
      decidedAt: now,
      updatedAt: now,
    });
    this.logger.info('event.rejected', { tenantId, tankId: event.tankId, eventId });
    return updated;
  }

  /**
   * Deliveries with the tank and station context a reviewer needs, including
   * the variance between what was recorded and what was measured.
   */
  async listDeliveries(
    tenantId: TenantId,
    query: {
      tankId?: TankId | undefined;
      from?: string | undefined;
      to?: string | undefined;
      limit?: number | undefined;
    } = {},
  ): Promise<ReadonlyArray<DeliveryWithContext>> {
    const filter: DeliveryQuery = {
      ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    };
    const deliveries = await this.repositories.deliveries.list(tenantId, filter);
    const views: DeliveryWithContext[] = [];
    for (const delivery of deliveries) {
      const tank = await this.repositories.tanks.findById(tenantId, delivery.tankId);
      const station =
        tank === null ? null : await this.repositories.stations.findById(tenantId, tank.stationId);
      const varianceMl = deliveryVarianceMl(delivery);
      const stationId: StationId | null = station?.id ?? tank?.stationId ?? null;
      if (stationId === null) {
        // A delivery whose tank has been removed cannot be presented with its
        // station context, so it is left out rather than shown misleadingly.
        continue;
      }
      views.push({
        delivery,
        tankName: tank?.name ?? '',
        stationId,
        stationName: station?.name ?? '',
        product: tank?.product ?? '',
        varianceMl,
        variancePercent:
          delivery.recordedVolumeMl === 0 ? null : (varianceMl / delivery.recordedVolumeMl) * 100,
      });
    }
    return views;
  }

  /** Confirmed delivery volume for a tank in a window, used by reconciliation. */
  async deliveredVolumeMl(
    tenantId: TenantId,
    tankId: TankId,
    from: string,
    to: string,
  ): Promise<number> {
    const deliveries = await this.repositories.deliveries.list(tenantId, {
      tankId,
      from,
      to,
      limit: 500,
    });
    return deliveries.reduce((total, delivery) => total + delivery.recordedVolumeMl, 0);
  }

  /** Candidate events for a tank, used to keep the linked alert open. */
  async candidateEvents(tenantId: TenantId, tankId: TankId): Promise<ReadonlyArray<FuelEvent>> {
    return this.repositories.events.list(tenantId, {
      tankId,
      status: 'candidate',
      limit: 20,
    });
  }

  /** Events of one type in a window, used by the reconciliation report. */
  async eventsInWindow(
    tenantId: TenantId,
    query: { tankId?: TankId; type?: FuelEventType; from?: string; to?: string },
  ): Promise<ReadonlyArray<FuelEvent>> {
    return this.repositories.events.list(tenantId, {
      ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      limit: 500,
    });
  }

  private async decorate(
    tenantId: TenantId,
    events: ReadonlyArray<FuelEvent>,
  ): Promise<ReadonlyArray<EventView>> {
    const views: EventView[] = [];
    for (const event of events) {
      const tank = await this.repositories.tanks.findById(tenantId, event.tankId);
      const station =
        tank === null ? null : await this.repositories.stations.findById(tenantId, tank.stationId);
      views.push({
        event,
        tankName: tank?.name ?? null,
        stationName: station?.name ?? null,
        product: tank?.product ?? null,
        volumeChangeLitres: mlToLitres(event.volumeChangeMl),
      });
    }
    return views;
  }
}

/**
 * How far back detection looks for an event that already covers a movement.
 * Long enough to survive a device that reports late, short enough that a second
 * delivery on the same tank later in the day is still detected.
 */
export const DEFAULT_DUPLICATE_LOOKBACK_HOURS = 72;

/** Upper bound on the events scanned when suppressing a duplicate candidate. */
export const RECENT_EVENT_LOOKBACK_LIMIT = 50;

/** Station of an event's tank, exposed for tests and callers that need the id. */
export async function stationIdForEvent(
  repositories: Repositories,
  tenantId: TenantId,
  event: FuelEvent,
): Promise<StationId | null> {
  const tank = await repositories.tanks.findById(tenantId, event.tankId);
  return tank === null ? null : tank.stationId;
}

export { DEFAULT_EXPLANATIONS_FOR_DECREASE, DEFAULT_EXPLANATIONS_FOR_DELIVERY };
