import type { FastifyInstance, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@fueltrack/core';

/**
 * The calling credential, and nothing else.
 *
 * The console needs the tenant id and the granted scopes to decide which
 * actions to offer. It must not have to probe write endpoints to discover
 * that. The response carries no secret and no other tenant's data: the tenant
 * is the one already bound to the API key.
 */
export function registerSessionRoutes(app: FastifyInstance): void {
  app.get('/session', async (request: FastifyRequest) => {
    const context = request.tenantContext;
    if (context === undefined) {
      throw new UnauthorizedError();
    }
    return {
      tenantId: context.tenantId,
      principalId: context.principalId,
      scopes: [...context.scopes],
    };
  });
}
