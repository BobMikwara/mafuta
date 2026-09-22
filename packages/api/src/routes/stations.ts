import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createStationSchema,
  listStationsQuerySchema,
  parseInput,
  stationParamsSchema,
  updateStationSchema,
  type AuditService,
  type FleetService,
} from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';
import { actorFrom } from './shared.js';

export interface StationRoutesDependencies {
  readonly fleet: FleetService;
  readonly audit: AuditService;
  readonly ipHashSecret?: string;
}

export function registerStationRoutes(
  app: FastifyInstance,
  dependencies: StationRoutesDependencies,
): void {
  app.post(
    '/stations',
    { onRequest: [requireScopes('stations:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = currentTenantId(request);
      const input = parseInput(createStationSchema, request.body);
      const station = await dependencies.fleet.createStation(tenantId, input);
      await dependencies.audit.record({
        tenantId,
        action: 'station.created',
        resourceType: 'station',
        resourceId: station.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { code: station.code, timezone: station.timezone },
      });
      return reply.code(201).send({ station });
    },
  );

  app.get(
    '/stations',
    { onRequest: [requireScopes('stations:read')] },
    async (request: FastifyRequest) => {
      const query = parseInput(listStationsQuerySchema, request.query);
      return { stations: await dependencies.fleet.listStations(currentTenantId(request), query) };
    },
  );

  app.get(
    '/stations/:stationId',
    { onRequest: [requireScopes('stations:read')] },
    async (request: FastifyRequest) => {
      const { stationId } = parseInput(stationParamsSchema, request.params);
      return {
        station: await dependencies.fleet.requireStation(currentTenantId(request), stationId),
      };
    },
  );

  app.patch(
    '/stations/:stationId',
    { onRequest: [requireScopes('stations:write')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { stationId } = parseInput(stationParamsSchema, request.params);
      const input = parseInput(updateStationSchema, request.body);
      const station = await dependencies.fleet.updateStation(tenantId, stationId, input);
      await dependencies.audit.record({
        tenantId,
        action: 'station.updated',
        resourceType: 'station',
        resourceId: station.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { name: station.name, status: station.status },
      });
      return { station };
    },
  );
}
