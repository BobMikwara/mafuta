import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  assignDeviceSchema,
  deviceParamsSchema,
  listDevicesQuerySchema,
  parseInput,
  rawMessagesQuerySchema,
  registerDeviceSchema,
  updateDeviceSchema,
  type AuditService,
  type DeviceService,
} from '@fueltrack/core';
import { currentTenantId, requireScopes } from '../auth.js';
import { actorFrom } from './shared.js';

export interface DeviceRoutesDependencies {
  readonly devices: DeviceService;
  readonly audit: AuditService;
  readonly ipHashSecret?: string;
}

export function registerDeviceRoutes(
  app: FastifyInstance,
  dependencies: DeviceRoutesDependencies,
): void {
  app.post(
    '/devices',
    { onRequest: [requireScopes('devices:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = currentTenantId(request);
      const input = parseInput(registerDeviceSchema, request.body);
      const device = await dependencies.devices.register(tenantId, input);
      await dependencies.audit.record({
        tenantId,
        action: 'device.registered',
        resourceType: 'device',
        resourceId: device.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: {
          manufacturer: device.manufacturer,
          model: device.model,
          protocol: device.protocol,
        },
      });
      return reply.code(201).send({ device });
    },
  );

  app.get(
    '/devices',
    { onRequest: [requireScopes('devices:read')] },
    async (request: FastifyRequest) => {
      const query = parseInput(listDevicesQuerySchema, request.query);
      return { devices: await dependencies.devices.list(currentTenantId(request), query) };
    },
  );

  app.get(
    '/devices/:deviceId',
    { onRequest: [requireScopes('devices:read')] },
    async (request: FastifyRequest) => {
      const { deviceId } = parseInput(deviceParamsSchema, request.params);
      return dependencies.devices.detail(currentTenantId(request), deviceId);
    },
  );

  app.patch(
    '/devices/:deviceId',
    { onRequest: [requireScopes('devices:write')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { deviceId } = parseInput(deviceParamsSchema, request.params);
      const input = parseInput(updateDeviceSchema, request.body);
      const device = await dependencies.devices.update(tenantId, deviceId, input);
      await dependencies.audit.record({
        tenantId,
        action: 'device.updated',
        resourceType: 'device',
        resourceId: device.id,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { status: device.status, firmwareVersion: device.firmwareVersion },
      });
      return { device };
    },
  );

  app.post(
    '/devices/:deviceId/assign',
    { onRequest: [requireScopes('devices:write')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { deviceId } = parseInput(deviceParamsSchema, request.params);
      const body = parseInput(assignDeviceSchema, request.body);
      const assignment = await dependencies.devices.assignToTank(tenantId, deviceId, body.tankId);
      await dependencies.audit.record({
        tenantId,
        action: 'device.assigned',
        resourceType: 'device',
        resourceId: deviceId,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { tankId: assignment.tankId, assignmentId: assignment.id },
      });
      return { assignment };
    },
  );

  app.post(
    '/devices/:deviceId/unassign',
    { onRequest: [requireScopes('devices:write')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { deviceId } = parseInput(deviceParamsSchema, request.params);
      const assignment = await dependencies.devices.unassign(tenantId, deviceId);
      await dependencies.audit.record({
        tenantId,
        action: 'device.unassigned',
        resourceType: 'device',
        resourceId: deviceId,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { tankId: assignment.tankId, assignmentId: assignment.id },
      });
      return { assignment };
    },
  );

  /**
   * Retained raw payloads for one device.
   *
   * These are the least processed data the platform holds and can contain
   * vendor specific content, so the endpoint requires the `raw:read` scope and
   * every read is audited: who looked at raw device data, and for which device,
   * is exactly the kind of access an operator needs to be able to review.
   */
  app.get(
    '/devices/:deviceId/raw-messages',
    { onRequest: [requireScopes('raw:read')] },
    async (request: FastifyRequest) => {
      const tenantId = currentTenantId(request);
      const { deviceId } = parseInput(deviceParamsSchema, request.params);
      const query = parseInput(rawMessagesQuerySchema, request.query);
      const rawMessages = await dependencies.devices.rawMessages(tenantId, deviceId, query.limit);
      await dependencies.audit.record({
        tenantId,
        action: 'reading.raw_payload_read',
        resourceType: 'device',
        resourceId: deviceId,
        actor: actorFrom(request, dependencies.ipHashSecret),
        metadata: { returned: rawMessages.length },
      });
      return { rawMessages };
    },
  );
}
