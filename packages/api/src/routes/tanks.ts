import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createTankSchema,
  ForbiddenError,
  ingestReadingBodySchema,
  listReadingsQuerySchema,
  listTanksQuerySchema,
  parseInput,
  tankParamsSchema,
  tankSeriesQuerySchema,
  updateTankSchema,
  type AuditService,
  type DashboardService,
  type FleetService,
  type IngestService,
  type ProbeSample,
  type RateLimiter,
} from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';
import { actorFrom, applyRateLimit, hasScope, scopeOf } from './shared.js';

export interface TankRoutesDependencies {
  readonly fleet: FleetService;
  readonly ingest: IngestService;
  readonly dashboard: DashboardService;
  readonly audit: AuditService;
  /** Guards the ingestion endpoint. Absent means no ingestion throttling. */
  readonly ingestionLimiter?: RateLimiter;
  readonly ipHashSecret?: string;
}

export function registerTankRoutes(
  app: FastifyInstance,
  dependencies: TankRoutesDependencies,
): void {
  app.post(
    '/tanks',
    { onRequest: [requireScopes('tanks:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = currentTenantId(request);
      const input = parseInput(createTankSchema, request.body);
      const tank = await dependencies.fleet.createTank(tenantId, input);
      await dependencies.audit.record({
        tenantId,
        action: 'tank.created',
        resourceType: 'tank',
        resourceId: tank.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: {
          stationId: tank.stationId,
          product: tank.product,
          capacityLitres: tank.capacityLitres,
        },
      });
      return reply.code(201).send({ tank });
    },
  );

  app.get(
    '/tanks',
    { onRequest: [requireScopes('tanks:read')] },
    async (request: FastifyRequest) => {
      const query = parseInput(listTanksQuerySchema, request.query);
      // The list returns summaries as well as plain tanks: a tank list without
      // its current level, freshness and open alert count cannot answer the
      // question an operator is asking.
      const summaries = await dependencies.fleet.listTankSummaries(currentTenantId(request), query);
      return { tanks: summaries.map((summary) => summary.tank), summaries };
    },
  );

  app.get(
    '/tanks/:tankId',
    { onRequest: [requireScopes('tanks:read')] },
    async (request: FastifyRequest) => {
      const { tankId } = parseInput(tankParamsSchema, request.params);
      return dependencies.fleet.tankSummary(currentTenantId(request), tankId);
    },
  );

  app.patch(
    '/tanks/:tankId',
    { onRequest: [requireScopes('tanks:write')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { tankId } = parseInput(tankParamsSchema, request.params);
      const input = parseInput(updateTankSchema, request.body);
      const tank = await dependencies.fleet.updateTank(tenantId, tankId, input);
      await dependencies.audit.record({
        tenantId,
        action: 'tank.updated',
        resourceType: 'tank',
        resourceId: tank.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { status: tank.status, name: tank.name },
      });
      return { tank };
    },
  );

  app.get(
    '/tanks/:tankId/readings',
    { onRequest: [requireScopes('readings:read')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { tankId } = parseInput(tankParamsSchema, request.params);
      const query = parseInput(listReadingsQuerySchema, request.query);
      return { readings: await dependencies.fleet.listReadings(tenantId, tankId, query) };
    },
  );

  app.get(
    '/tanks/:tankId/series',
    { onRequest: [requireScopes('readings:read')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { tankId } = parseInput(tankParamsSchema, request.params);
      const query = parseInput(tankSeriesQuerySchema, request.query);
      return { series: await dependencies.dashboard.tankSeries(tenantId, tankId, query) };
    },
  );

  /**
   * Reading ingestion. This is the endpoint a device or gateway calls, so it
   * carries the ingestion rate limit and the simulated-data scope check.
   */
  app.post(
    '/tanks/:tankId/readings',
    { onRequest: [requireScopes('readings:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      applyRateLimit(dependencies.ingestionLimiter, request, 'ingest');
      const tenantId = currentTenantId(request);
      const { tankId } = parseInput(tankParamsSchema, request.params);
      const body = parseInput(ingestReadingBodySchema, request.body);

      // Only a credential that explicitly holds `simulator:write` may label a
      // reading as simulated. Without this check a device credential could
      // publish synthetic values into the fuel ledger under the device's name.
      if (body.source === 'simulated' && !hasScope(request, 'simulator:write')) {
        throw new ForbiddenError('This credential may not submit simulated readings');
      }

      const sample: ProbeSample = {
        tankId,
        observedAt: body.observedAt,
        levelMm: body.levelMm,
        waterLevelMm: body.waterLevelMm,
        temperatureC: body.temperatureC,
        deviceId: body.deviceId,
        source: body.source,
        ...(body.signalQualityPercent === undefined
          ? {}
          : { signalQualityPercent: body.signalQualityPercent }),
        ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
      };

      const result = await dependencies.ingest.ingest(tenantId, sample, {
        actorReference: String(request.tenantContext?.principalId ?? 'unknown'),
        rawPayload: request.body,
      });

      // 200 rather than 201 for a retry, so a device can tell "stored" from
      // "already stored" without parsing the body.
      return reply.code(result.duplicate ? 200 : 201).send({
        reading: result.reading,
        duplicate: result.duplicate,
        alertsRaised: result.raisedAlerts,
        alertsResolved: result.resolvedAlerts,
        eventsRaised: result.raisedEvents,
        scopes: [...scopeOf(request)],
      });
    },
  );
}
