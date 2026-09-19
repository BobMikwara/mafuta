import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  acknowledgeAlarmSchema,
  alarmParamsSchema,
  listAlarmsQuerySchema,
  parseInput,
  type FleetService,
} from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';

export interface AlarmRoutesDependencies {
  readonly fleet: FleetService;
}

export function registerAlarmRoutes(
  app: FastifyInstance,
  dependencies: AlarmRoutesDependencies,
): void {
  app.get(
    '/alarms',
    { onRequest: [requireScopes('alarms:read')] },
    async (request: FastifyRequest) => {
      const query = parseInput(listAlarmsQuerySchema, request.query);
      return { alarms: await dependencies.fleet.listAlarms(currentTenantId(request), query) };
    },
  );

  app.post(
    '/alarms/:alarmId/acknowledge',
    { onRequest: [requireScopes('alarms:write')] },
    async (request: FastifyRequest) => {
      const { alarmId } = parseInput(alarmParamsSchema, request.params);
      const body = parseInput(acknowledgeAlarmSchema, request.body ?? {});
      const alarm = await dependencies.fleet.acknowledgeAlarm(
        currentTenantId(request),
        alarmId,
        body.note,
      );
      return { alarm };
    },
  );
}
