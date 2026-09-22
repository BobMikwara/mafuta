import type { FastifyInstance, FastifyRequest } from 'fastify';
import { auditQuerySchema, parseInput, type AuditService } from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';

export interface AuditRoutesDependencies {
  readonly audit: AuditService;
}

export function registerAuditRoutes(
  app: FastifyInstance,
  dependencies: AuditRoutesDependencies,
): void {
  /**
   * The tenant's own audit trail: who changed what, and when. Scoped by tenant
   * in the repository, so one tenant can never read another's history.
   */
  app.get(
    '/audit-logs',
    { onRequest: [requireScopes('audit:read')] },
    async (request: FastifyRequest) => {
      const query = parseInput(auditQuerySchema, request.query);
      return {
        auditLogs: await dependencies.audit.list(currentTenantId(request), {
          ...(query.action === undefined ? {} : { action: query.action }),
          ...(query.resourceType === undefined ? {} : { resourceType: query.resourceType }),
          ...(query.from === undefined ? {} : { from: query.from }),
          ...(query.to === undefined ? {} : { to: query.to }),
          limit: query.limit,
        }),
      };
    },
  );
}
