import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createSiteSchema, parseInput, type FleetService } from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';

export interface SiteRoutesDependencies {
  readonly fleet: FleetService;
}

export function registerSiteRoutes(
  app: FastifyInstance,
  dependencies: SiteRoutesDependencies,
): void {
  app.post(
    '/sites',
    { onRequest: [requireScopes('sites:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const input = parseInput(createSiteSchema, request.body);
      const site = await dependencies.fleet.createSite(currentTenantId(request), input);
      return reply.code(201).send({ site });
    },
  );

  app.get(
    '/sites',
    { onRequest: [requireScopes('sites:read')] },
    async (request: FastifyRequest) => ({
      sites: await dependencies.fleet.listSites(currentTenantId(request)),
    }),
  );
}
