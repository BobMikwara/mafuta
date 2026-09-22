import type { FastifyInstance, FastifyRequest } from 'fastify';
import { dashboardQuerySchema, parseInput, type DashboardService } from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';

export interface DashboardRoutesDependencies {
  readonly dashboard: DashboardService;
}

export function registerDashboardRoutes(
  app: FastifyInstance,
  dependencies: DashboardRoutesDependencies,
): void {
  /**
   * One request that answers "what is happening right now": tank totals, stock,
   * open alerts by severity, device connectivity, today's movements and the
   * tanks that need attention first.
   */
  app.get(
    '/dashboard/summary',
    { onRequest: [requireScopes('dashboard:read')] },
    async (request: FastifyRequest) => {
      const query = parseInput(dashboardQuerySchema, request.query);
      return dependencies.dashboard.summary(currentTenantId(request), query.stationId);
    },
  );
}
