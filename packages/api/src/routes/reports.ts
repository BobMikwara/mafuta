import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  parseInput,
  reportParamsSchema,
  reportQuerySchema,
  toCsv,
  type AuditService,
  type ReportService,
} from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';
import { actorFrom } from './shared.js';

export interface ReportRoutesDependencies {
  readonly reports: ReportService;
  readonly audit: AuditService;
  readonly ipHashSecret?: string;
}

export function registerReportRoutes(
  app: FastifyInstance,
  dependencies: ReportRoutesDependencies,
): void {
  /**
   * Reports are returned as a table (columns, rows, totals, notes) so every
   * client renders the same thing, and `format=csv` returns the same table as a
   * file. Exports are audited because they are the operation that takes tenant
   * data out of the platform.
   */
  app.get(
    '/reports/:report',
    { onRequest: [requireScopes('reports:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = currentTenantId(request);
      const { report } = parseInput(reportParamsSchema, request.params);
      const query = parseInput(reportQuerySchema, request.query);
      const table = await dependencies.reports.build(tenantId, report, {
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
        ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
        ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
      });

      if (query.format === 'csv') {
        await dependencies.audit.record({
          tenantId,
          action: 'export.downloaded',
          resourceType: 'report',
          resourceId: report,
          actor: actorFrom(request, dependencies.ipHashSecret),
          metadata: { rows: table.rows.length, from: table.range.from, to: table.range.to },
        });
        const filename = `${report}-${table.generatedAt.slice(0, 10)}.csv`;
        return reply
          .type('text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(toCsv(table));
      }

      return table;
    },
  );
}
