import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createTankSchema,
  ForbiddenError,
  ingestReadingBodySchema,
  listReadingsQuerySchema,
  listTanksQuerySchema,
  parseInput,
  tankParamsSchema,
  type FleetService,
  type IngestService,
  type ProbeSample,
} from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';

export interface TankRoutesDependencies {
  readonly fleet: FleetService;
  readonly ingest: IngestService;
}

function scopeOf(request: FastifyRequest): ReadonlySet<string> {
  return new Set(request.tenantContext?.scopes ?? []);
}

export function registerTankRoutes(
  app: FastifyInstance,
  dependencies: TankRoutesDependencies,
): void {
  app.post(
    '/tanks',
    { onRequest: [requireScopes('tanks:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const input = parseInput(createTankSchema, request.body);
      const tank = await dependencies.fleet.createTank(currentTenantId(request), input);
      return reply.code(201).send({ tank });
    },
  );

  app.get(
    '/tanks',
    { onRequest: [requireScopes('tanks:read')] },
    async (request: FastifyRequest) => {
      const query = parseInput(listTanksQuerySchema, request.query);
      return { tanks: await dependencies.fleet.listTanks(currentTenantId(request), query) };
    },
  );

  app.get(
    '/tanks/:tankId',
    { onRequest: [requireScopes('tanks:read')] },
    async (request: FastifyRequest) => {
      const { tankId } = parseInput(tankParamsSchema, request.params);
      return { tank: await dependencies.fleet.requireTank(currentTenantId(request), tankId) };
    },
  );

  app.post(
    '/tanks/:tankId/readings',
    { onRequest: [requireScopes('readings:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tankId } = parseInput(tankParamsSchema, request.params);
      const body = parseInput(ingestReadingBodySchema, request.body);

      // Only credentials that explicitly hold the simulator scope may label
      // data as simulated, so synthetic values cannot be passed off as device
      // measurements by an ordinary device key.
      if (body.source === 'simulated' && !scopeOf(request).has('simulator:write')) {
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

      const result = await dependencies.ingest.ingest(currentTenantId(request), sample);
      // A retry returns 200 with the original reading. 201 is reserved for a
      // reading that was actually stored, so a client can tell the two apart.
      return reply.code(result.duplicate ? 200 : 201).send({
        reading: result.reading,
        duplicate: result.duplicate,
        alarmsRaised: result.raisedAlarms,
        alarmsResolved: result.resolvedAlarms,
      });
    },
  );

  app.get(
    '/tanks/:tankId/readings',
    { onRequest: [requireScopes('readings:read')] },
    async (request: FastifyRequest) => {
      const { tankId } = parseInput(tankParamsSchema, request.params);
      const query = parseInput(listReadingsQuerySchema, request.query);
      return {
        readings: await dependencies.fleet.listReadings(currentTenantId(request), tankId, query),
      };
    },
  );
}
