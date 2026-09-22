import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  alertParamsSchema,
  assignAlertSchema,
  listAlertsQuerySchema,
  parseInput,
  updateAlertSchema,
  type AlertSweepService,
  type AuditService,
  type FleetService,
} from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';
import { actorFrom } from './shared.js';

export interface AlertRoutesDependencies {
  readonly fleet: FleetService;
  readonly sweep: AlertSweepService;
  readonly audit: AuditService;
  readonly ipHashSecret?: string;
}

export function registerAlertRoutes(
  app: FastifyInstance,
  dependencies: AlertRoutesDependencies,
): void {
  app.get(
    '/alerts',
    { onRequest: [requireScopes('alerts:read')] },
    async (request: FastifyRequest) => {
      const query = parseInput(listAlertsQuerySchema, request.query);
      return { alerts: await dependencies.fleet.listAlerts(currentTenantId(request), query) };
    },
  );

  app.get(
    '/alerts/:alertId',
    { onRequest: [requireScopes('alerts:read')] },
    async (request: FastifyRequest) => {
      const { alertId } = parseInput(alertParamsSchema, request.params);
      return { alert: await dependencies.fleet.requireAlert(currentTenantId(request), alertId) };
    },
  );

  app.post(
    '/alerts/:alertId/acknowledge',
    { onRequest: [requireScopes('alerts:write')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { alertId } = parseInput(alertParamsSchema, request.params);
      const body = parseInput(updateAlertSchema, request.body ?? {});
      const principal = String(request.tenantContext?.principalId ?? 'unknown');
      const alert = await dependencies.fleet.acknowledgeAlert(tenantId, alertId, {
        actor: principal,
        ...(body.note === undefined ? {} : { note: body.note }),
      });
      await dependencies.audit.record({
        tenantId,
        action: 'alert.acknowledged',
        resourceType: 'alert',
        resourceId: alert.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { type: alert.type, severity: alert.severity },
      });
      return { alert };
    },
  );

  app.post(
    '/alerts/:alertId/resolve',
    { onRequest: [requireScopes('alerts:write')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { alertId } = parseInput(alertParamsSchema, request.params);
      const body = parseInput(updateAlertSchema, request.body ?? {});
      const principal = String(request.tenantContext?.principalId ?? 'unknown');
      const alert = await dependencies.fleet.resolveAlert(tenantId, alertId, {
        actor: principal,
        ...(body.note === undefined ? {} : { note: body.note }),
      });
      await dependencies.audit.record({
        tenantId,
        action: 'alert.resolved',
        resourceType: 'alert',
        resourceId: alert.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { type: alert.type, severity: alert.severity },
      });
      return { alert };
    },
  );

  app.post(
    '/alerts/:alertId/assign',
    { onRequest: [requireScopes('alerts:write')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { alertId } = parseInput(alertParamsSchema, request.params);
      const body = parseInput(assignAlertSchema, request.body);
      const alert = await dependencies.fleet.assignAlert(tenantId, alertId, body.assignee);
      await dependencies.audit.record({
        tenantId,
        action: 'alert.assigned',
        resourceType: 'alert',
        resourceId: alert.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { assignee: alert.assignedTo },
      });
      return { alert };
    },
  );

  /**
   * Runs the alert and event rules for the calling tenant on demand.
   *
   * The rules also run after every reading, but a tank that has *stopped*
   * reporting cannot raise a stale-data or device-offline alert, because no new
   * reading arrives. The long lived server therefore sweeps on a timer; a
   * serverless deployment cannot keep a timer, so its scheduler calls this
   * endpoint instead. It is always scoped to the caller's own tenant.
   */
  app.post(
    '/alerts/evaluate',
    { onRequest: [requireScopes('alerts:write')] },
    async (request: FastifyRequest) => {
      return { sweep: await dependencies.sweep.sweepTenant(currentTenantId(request)) };
    },
  );
}
