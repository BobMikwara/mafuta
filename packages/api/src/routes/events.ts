import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  confirmEventSchema,
  eventParamsSchema,
  listDeliveriesQuerySchema,
  listEventsQuerySchema,
  parseInput,
  rejectEventSchema,
  type AuditService,
  type EventService,
} from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';
import { actorFrom } from './shared.js';

export interface EventRoutesDependencies {
  readonly events: EventService;
  readonly audit: AuditService;
  readonly ipHashSecret?: string;
}

export function registerEventRoutes(
  app: FastifyInstance,
  dependencies: EventRoutesDependencies,
): void {
  app.get(
    '/events',
    { onRequest: [requireScopes('events:read')] },
    async (request: FastifyRequest) => {
      const query = parseInput(listEventsQuerySchema, request.query);
      return { events: await dependencies.events.list(currentTenantId(request), query) };
    },
  );

  app.get(
    '/events/:eventId',
    { onRequest: [requireScopes('events:read')] },
    async (request: FastifyRequest) => {
      const { eventId } = parseInput(eventParamsSchema, request.params);
      return { event: await dependencies.events.detail(currentTenantId(request), eventId) };
    },
  );

  /**
   * Confirms a candidate delivery and records it.
   *
   * The recorded volume defaults to the measured rise, and the response carries
   * the variance either way. Deciding what a discrepancy means stays with the
   * operator: the platform only records what it observed and what it was told.
   */
  app.post(
    '/events/:eventId/confirm',
    { onRequest: [requireScopes('events:write')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { eventId } = parseInput(eventParamsSchema, request.params);
      const body = parseInput(confirmEventSchema, request.body ?? {});
      const result = await dependencies.events.confirm(
        tenantId,
        eventId,
        {
          ...(body.recordedVolumeLitres === undefined
            ? {}
            : { recordedVolumeLitres: body.recordedVolumeLitres }),
          ...(body.reference === undefined ? {} : { reference: body.reference }),
          ...(body.supplier === undefined ? {} : { supplier: body.supplier }),
          ...(body.note === undefined ? {} : { note: body.note }),
        },
        String(request.tenantContext?.principalId ?? 'unknown'),
      );
      await dependencies.audit.record({
        tenantId,
        action: 'delivery.confirmed',
        resourceType: 'delivery',
        resourceId: result.delivery.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: {
          eventId,
          measuredMl: result.delivery.measuredVolumeMl,
          recordedMl: result.delivery.recordedVolumeMl,
          varianceMl: result.varianceMl,
          reference: result.delivery.reference,
        },
      });
      return { event: result.event, delivery: result.delivery, varianceMl: result.varianceMl };
    },
  );

  /**
   * Rejects a candidate with a reason. The event is kept, so a later reviewer
   * can see that the movement was considered and why it was dismissed.
   */
  app.post(
    '/events/:eventId/reject',
    { onRequest: [requireScopes('events:write')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { eventId } = parseInput(eventParamsSchema, request.params);
      const body = parseInput(rejectEventSchema, request.body);
      const event = await dependencies.events.reject(
        tenantId,
        eventId,
        { note: body.note },
        String(request.tenantContext?.principalId ?? 'unknown'),
      );
      await dependencies.audit.record({
        tenantId,
        action: 'event.rejected',
        resourceType: 'fuel_event',
        resourceId: event.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { type: event.type, note: body.note },
      });
      return { event };
    },
  );

  app.get(
    '/deliveries',
    { onRequest: [requireScopes('deliveries:read')] },
    async (request: FastifyRequest) => {
      const query = parseInput(listDeliveriesQuerySchema, request.query);
      return {
        deliveries: await dependencies.events.listDeliveries(currentTenantId(request), query),
      };
    },
  );
}
