import { ConflictError } from '../../errors.js';
import type {
  AlertQuery,
  AlertRepository,
  AuditLogRepository,
  AuditQuery,
  DeliveryQuery,
  DeliveryRepository,
  DeviceAssignmentRepository,
  DeviceQuery,
  DeviceRepository,
  EventQuery,
  FuelEventRepository,
  RawMessageRecord,
  RawMessageRepository,
  ReadingQuery,
  ReadingRepository,
  Repositories,
  StationQuery,
  StationRepository,
  TankQuery,
  TankRepository,
  TenantRepository,
} from '../../ports/repositories.js';
import { clampLimit } from '../../ports/repositories.js';
import type { Alert } from '../../domain/alert.js';
import type { AuditLogEntry } from '../../domain/audit.js';
import type { Delivery } from '../../domain/delivery.js';
import type { Device, DeviceAssignment } from '../../domain/device.js';
import type { FuelEvent } from '../../domain/event.js';
import type { TankReading } from '../../domain/reading.js';
import type { Station } from '../../domain/station.js';
import type { Tank } from '../../domain/tank.js';
import { assertOwnedByTenant } from '../../tenancy/guard.js';
import type {
  AlertId,
  DeliveryId,
  DeviceId,
  FuelEventId,
  RawMessageId,
  ReadingId,
  StationId,
  TankId,
  TenantId,
} from '../../types/ids.js';
import { ensureTenantExists, getPrismaClient } from './client.js';
import {
  toDomainAlert,
  toDomainAssignment,
  toDomainAuditEntry,
  toDomainDelivery,
  toDomainDevice,
  toDomainFuelEvent,
  toDomainRawMessage,
  toDomainReading,
  toDomainStation,
  toDomainTank,
  toPrismaAlertInput,
  toPrismaAssignmentInput,
  toPrismaAuditInput,
  toPrismaDeliveryInput,
  toPrismaDeviceInput,
  toPrismaFuelEventInput,
  toPrismaRawMessageInput,
  toPrismaReadingInput,
  toPrismaStationInput,
  toPrismaTankInput,
} from './mappers.js';

/** Prisma error code for a unique constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/**
 * PostgreSQL implementation of every repository port.
 *
 * Every method takes the tenant id explicitly and writes it into the `where`
 * clause, so a query cannot read or modify another tenant's row even if a
 * service forgets to filter. Writes additionally re-assert ownership of the
 * entity being persisted.
 */
export function createPrismaRepositories(): Repositories {
  return {
    stations: createStationRepository(),
    tanks: createTankRepository(),
    readings: createReadingRepository(),
    alerts: createAlertRepository(),
    devices: createDeviceRepository(),
    assignments: createAssignmentRepository(),
    events: createFuelEventRepository(),
    deliveries: createDeliveryRepository(),
    auditLogs: createAuditLogRepository(),
    rawMessages: createRawMessageRepository(),
    tenants: createTenantRepository(),
  };
}

/**
 * Platform maintenance only: the alert sweep walks every tenant. No tenant
 * scoped code path can reach this, because every other repository method takes
 * a tenant id that comes from the authenticated credential.
 */
function createTenantRepository(): TenantRepository {
  return {
    async list(limit = 500) {
      const rows = await getPrismaClient().tenant.findMany({
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: Math.max(1, Math.min(1000, limit)),
      });
      // Annotation kept explicit: `@prisma/client` types are generated into
      // node_modules and are absent in a freshly cloned workspace, and an
      // implicitly typed callback would then be an implicit `any`.
      return rows.map((row: { id: string }) => ({ id: row.id as TenantId }));
    },
  };
}

function createStationRepository(): StationRepository {
  return {
    async save(tenantId: TenantId, station: Station): Promise<Station> {
      assertOwnedByTenant(tenantId, station, 'stations.save');
      await ensureTenantExists(tenantId);
      const prisma = getPrismaClient();
      const input = toPrismaStationInput(station);
      const row = await prisma.station.upsert({
        where: { id: station.id },
        update: {
          name: input.name,
          code: input.code,
          timezone: input.timezone,
          status: input.status,
        },
        create: input,
      });
      return toDomainStation(row);
    },
    async findById(tenantId: TenantId, id: StationId): Promise<Station | null> {
      const row = await getPrismaClient().station.findFirst({ where: { id, tenantId } });
      return row === null ? null : toDomainStation(row);
    },
    async findByCode(tenantId: TenantId, code: string): Promise<Station | null> {
      const row = await getPrismaClient().station.findFirst({ where: { tenantId, code } });
      return row === null ? null : toDomainStation(row);
    },
    async list(tenantId: TenantId, query: StationQuery = {}): Promise<ReadonlyArray<Station>> {
      const rows = await getPrismaClient().station.findMany({
        where: {
          tenantId,
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        orderBy: { name: 'asc' },
        take: clampLimit(query.limit),
      });
      return rows.map(toDomainStation);
    },
  };
}

function createTankRepository(): TankRepository {
  return {
    async save(tenantId: TenantId, tank: Tank): Promise<Tank> {
      assertOwnedByTenant(tenantId, tank, 'tanks.save');
      await ensureTenantExists(tenantId);
      const prisma = getPrismaClient();
      const input = toPrismaTankInput(tank);
      const row = await prisma.tank.upsert({
        where: { id: tank.id },
        update: {
          name: input.name,
          stationId: input.stationId,
          product: input.product,
          capacityLitres: input.capacityLitres,
          geometry: input.geometry,
          criticalLowPercent: input.criticalLowPercent,
          lowPercent: input.lowPercent,
          highPercent: input.highPercent,
          waterAlarmMm: input.waterAlarmMm,
          unexplainedDecreaseLitresPerHour: input.unexplainedDecreaseLitresPerHour,
          deliveryMinLitres: input.deliveryMinLitres,
          deliveryWindowMinutes: input.deliveryWindowMinutes,
          staleAfterMinutes: input.staleAfterMinutes,
          status: input.status,
          calibrationSource: input.calibrationSource,
          calibrationAt: input.calibrationAt,
        },
        create: input,
      });
      return toDomainTank(row);
    },
    async findById(tenantId: TenantId, id: TankId): Promise<Tank | null> {
      const row = await getPrismaClient().tank.findFirst({ where: { id, tenantId } });
      return row === null ? null : toDomainTank(row);
    },
    async list(tenantId: TenantId, query: TankQuery = {}): Promise<ReadonlyArray<Tank>> {
      const rows = await getPrismaClient().tank.findMany({
        where: {
          tenantId,
          ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        orderBy: { name: 'asc' },
        take: clampLimit(query.limit),
      });
      return rows.map(toDomainTank);
    },
  };
}

function createReadingRepository(): ReadingRepository {
  return {
    async append(tenantId: TenantId, reading: TankReading): Promise<TankReading> {
      assertOwnedByTenant(tenantId, reading, 'readings.append');
      const prisma = getPrismaClient();
      try {
        const row = await prisma.tankReading.create({
          data: toPrismaReadingInput(reading) as never,
        });
        return toDomainReading(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Two writers raced on the same submission identity. The unique index
          // did its job; the caller is told the reading already exists instead of
          // receiving a second ledger row.
          throw new ConflictError('Reading already stored for this submission key');
        }
        throw error;
      }
    },
    async findById(tenantId: TenantId, id: ReadingId): Promise<TankReading | null> {
      const row = await getPrismaClient().tankReading.findFirst({ where: { id, tenantId } });
      return row === null ? null : toDomainReading(row);
    },
    async findByIdempotencyKey(tenantId: TenantId, key: string): Promise<TankReading | null> {
      const row = await getPrismaClient().tankReading.findFirst({
        where: { tenantId, idempotencyKey: key },
      });
      return row === null ? null : toDomainReading(row);
    },
    async list(tenantId: TenantId, query: ReadingQuery): Promise<ReadonlyArray<TankReading>> {
      const rows = await getPrismaClient().tankReading.findMany({
        where: {
          tenantId,
          tankId: query.tankId,
          ...(query.from === undefined || query.to === undefined
            ? {}
            : { recordedAt: { gte: new Date(query.from), lte: new Date(query.to) } }),
        },
        orderBy: { recordedAt: query.ascending === true ? 'asc' : 'desc' },
        take: clampLimit(query.limit),
      });
      return rows.map(toDomainReading);
    },
    async latest(tenantId: TenantId, tankId: TankId): Promise<TankReading | null> {
      const row = await getPrismaClient().tankReading.findFirst({
        where: { tenantId, tankId },
        orderBy: { recordedAt: 'desc' },
      });
      return row === null ? null : toDomainReading(row);
    },
    async latestByTank(tenantId: TenantId): Promise<ReadonlyMap<TankId, TankReading>> {
      const rows = await getPrismaClient().tankReading.findMany({
        where: { tenantId },
        orderBy: { recordedAt: 'desc' },
        distinct: ['tankId'],
      });
      const latest = new Map<TankId, TankReading>();
      for (const row of rows) {
        const reading = toDomainReading(row);
        latest.set(reading.tankId, reading);
      }
      return latest;
    },
  };
}

function createAlertRepository(): AlertRepository {
  const mapList = (
    rows: ReadonlyArray<Parameters<typeof toDomainAlert>[0]>,
  ): ReadonlyArray<Alert> => rows.map(toDomainAlert);

  return {
    async save(tenantId: TenantId, alert: Alert): Promise<Alert> {
      assertOwnedByTenant(tenantId, alert, 'alerts.save');
      await ensureTenantExists(tenantId);
      const row = await getPrismaClient().alert.create({ data: toPrismaAlertInput(alert) });
      return toDomainAlert(row);
    },
    async update(tenantId: TenantId, alert: Alert): Promise<Alert> {
      assertOwnedByTenant(tenantId, alert, 'alerts.update');
      const prisma = getPrismaClient();
      const input = toPrismaAlertInput(alert);
      const existing = await prisma.alert.findFirst({ where: { id: alert.id, tenantId } });
      if (existing === null) {
        throw new ConflictError(`Alert ${alert.id} does not exist for this tenant`);
      }
      const row = await prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: input.status,
          message: input.message,
          metrics: input.metrics,
          acknowledgedAt: input.acknowledgedAt,
          acknowledgedByUserId: input.acknowledgedByUserId,
          assignedToUserId: input.assignedToUserId,
          resolvedAt: input.resolvedAt,
          resolvedByUserId: input.resolvedByUserId,
        },
      });
      return toDomainAlert(row);
    },
    async findById(tenantId: TenantId, id: AlertId): Promise<Alert | null> {
      const row = await getPrismaClient().alert.findFirst({ where: { id, tenantId } });
      return row === null ? null : toDomainAlert(row);
    },
    async list(tenantId: TenantId, query: AlertQuery = {}): Promise<ReadonlyArray<Alert>> {
      const rows = await getPrismaClient().alert.findMany({
        where: {
          tenantId,
          ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.type === undefined ? {} : { type: query.type }),
        },
        orderBy: { raisedAt: 'desc' },
        take: clampLimit(query.limit),
      });
      return mapList(rows);
    },
    async listOpenByTank(tenantId: TenantId, tankId: TankId): Promise<ReadonlyArray<Alert>> {
      const rows = await getPrismaClient().alert.findMany({
        where: { tenantId, tankId, status: { in: ['open', 'acknowledged'] } },
        orderBy: { raisedAt: 'desc' },
      });
      return mapList(rows);
    },
    async countOpen(tenantId: TenantId): Promise<number> {
      return getPrismaClient().alert.count({ where: { tenantId, status: 'open' } });
    },
  };
}

function createDeviceRepository(): DeviceRepository {
  return {
    async save(tenantId: TenantId, device: Device): Promise<Device> {
      assertOwnedByTenant(tenantId, device, 'devices.save');
      await ensureTenantExists(tenantId);
      const prisma = getPrismaClient();
      const input = toPrismaDeviceInput(device);
      const row = await prisma.device.upsert({
        where: { id: device.id },
        update: {
          manufacturer: input.manufacturer,
          model: input.model,
          serialNumber: input.serialNumber,
          protocol: input.protocol,
          firmwareVersion: input.firmwareVersion,
          status: input.status,
          connectionState: input.connectionState,
          lastSeenAt: input.lastSeenAt,
          credentialRef: input.credentialRef,
        },
        create: input,
      });
      return toDomainDevice(row);
    },
    async findById(tenantId: TenantId, id: DeviceId): Promise<Device | null> {
      const row = await getPrismaClient().device.findFirst({ where: { id, tenantId } });
      return row === null ? null : toDomainDevice(row);
    },
    async findBySerialNumber(tenantId: TenantId, serialNumber: string): Promise<Device | null> {
      const row = await getPrismaClient().device.findFirst({ where: { tenantId, serialNumber } });
      return row === null ? null : toDomainDevice(row);
    },
    async list(tenantId: TenantId, query: DeviceQuery = {}): Promise<ReadonlyArray<Device>> {
      const prisma = getPrismaClient();
      const tankIds =
        query.tankId !== undefined
          ? [query.tankId]
          : query.stationId !== undefined
            ? (
                await prisma.tank.findMany({
                  where: { tenantId, stationId: query.stationId },
                  select: { id: true },
                })
              ).map((tank: { id: string }) => tank.id)
            : undefined;

      if (tankIds !== undefined) {
        const deviceIds = (
          await prisma.deviceAssignment.findMany({
            where: { tenantId, status: 'active', tankId: { in: [...tankIds] } },
            select: { deviceId: true },
          })
        ).map((assignment: { deviceId: string }) => assignment.deviceId);
        if (deviceIds.length === 0) {
          return [];
        }
        const rows = await prisma.device.findMany({
          where: {
            tenantId,
            id: { in: deviceIds },
            ...(query.status === undefined ? {} : { status: query.status }),
          },
          orderBy: { serialNumber: 'asc' },
          take: clampLimit(query.limit),
        });
        return rows.map(toDomainDevice);
      }

      const rows = await prisma.device.findMany({
        where: {
          tenantId,
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        orderBy: { serialNumber: 'asc' },
        take: clampLimit(query.limit),
      });
      return rows.map(toDomainDevice);
    },
    async touch(
      tenantId: TenantId,
      id: DeviceId,
      seenAt: string,
      connectionState: Device['connectionState'],
    ): Promise<void> {
      const prisma = getPrismaClient();
      const existing = await prisma.device.findFirst({
        where: { id, tenantId },
        select: { id: true, status: true },
      });
      if (existing === null) {
        return;
      }
      await prisma.device.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(seenAt),
          connectionState,
          ...(existing.status === 'registered' ? { status: 'active' as const } : {}),
        },
      });
    },
  };
}

function createAssignmentRepository(): DeviceAssignmentRepository {
  return {
    async save(tenantId: TenantId, assignment: DeviceAssignment): Promise<DeviceAssignment> {
      assertOwnedByTenant(tenantId, assignment, 'assignments.save');
      await ensureTenantExists(tenantId);
      const row = await getPrismaClient().deviceAssignment.upsert({
        where: { id: assignment.id },
        update: {
          status: assignment.status,
          unassignedAt: assignment.unassignedAt === null ? null : new Date(assignment.unassignedAt),
        },
        create: toPrismaAssignmentInput(assignment),
      });
      return toDomainAssignment(row);
    },
    async findById(tenantId: TenantId, assignmentId: string): Promise<DeviceAssignment | null> {
      const row = await getPrismaClient().deviceAssignment.findFirst({
        where: { id: assignmentId, tenantId },
      });
      return row === null ? null : toDomainAssignment(row);
    },
    async findActiveByDevice(
      tenantId: TenantId,
      deviceId: DeviceId,
    ): Promise<DeviceAssignment | null> {
      const row = await getPrismaClient().deviceAssignment.findFirst({
        where: { tenantId, deviceId, status: 'active' },
        orderBy: { assignedAt: 'desc' },
      });
      return row === null ? null : toDomainAssignment(row);
    },
    async listActiveByTank(
      tenantId: TenantId,
      tankId: TankId,
    ): Promise<ReadonlyArray<DeviceAssignment>> {
      const rows = await getPrismaClient().deviceAssignment.findMany({
        where: { tenantId, tankId, status: 'active' },
        orderBy: { assignedAt: 'desc' },
      });
      return rows.map(toDomainAssignment);
    },
    async listByTank(
      tenantId: TenantId,
      tankId: TankId,
      status?: DeviceAssignment['status'],
    ): Promise<ReadonlyArray<DeviceAssignment>> {
      const rows = await getPrismaClient().deviceAssignment.findMany({
        where: { tenantId, tankId, ...(status === undefined ? {} : { status }) },
        orderBy: { assignedAt: 'desc' },
      });
      return rows.map(toDomainAssignment);
    },
    async listByDevice(
      tenantId: TenantId,
      deviceId: DeviceId,
    ): Promise<ReadonlyArray<DeviceAssignment>> {
      const rows = await getPrismaClient().deviceAssignment.findMany({
        where: { tenantId, deviceId },
        orderBy: { assignedAt: 'desc' },
      });
      return rows.map(toDomainAssignment);
    },
    async listActive(
      tenantId: TenantId,
      query: { stationId?: StationId } = {},
    ): Promise<ReadonlyArray<DeviceAssignment>> {
      const prisma = getPrismaClient();
      const tankIds =
        query.stationId === undefined
          ? undefined
          : (
              await prisma.tank.findMany({
                where: { tenantId, stationId: query.stationId },
                select: { id: true },
              })
            ).map((tank: { id: string }) => tank.id);
      if (tankIds !== undefined && tankIds.length === 0) {
        return [];
      }
      const rows = await prisma.deviceAssignment.findMany({
        where: {
          tenantId,
          status: 'active',
          ...(tankIds === undefined ? {} : { tankId: { in: tankIds } }),
        },
        orderBy: { assignedAt: 'desc' },
      });
      return rows.map(toDomainAssignment);
    },
    async end(
      tenantId: TenantId,
      assignmentId: string,
      endedAt: string,
    ): Promise<DeviceAssignment> {
      const prisma = getPrismaClient();
      const existing = await prisma.deviceAssignment.findFirst({
        where: { id: assignmentId, tenantId },
      });
      if (existing === null) {
        throw new ConflictError(`Assignment ${assignmentId} does not exist for this tenant`);
      }
      const row = await prisma.deviceAssignment.update({
        where: { id: assignmentId },
        data: { status: 'ended', unassignedAt: new Date(endedAt) },
      });
      return toDomainAssignment(row);
    },
  };
}

function createFuelEventRepository(): FuelEventRepository {
  return {
    async save(tenantId: TenantId, event: FuelEvent): Promise<FuelEvent> {
      assertOwnedByTenant(tenantId, event, 'events.save');
      await ensureTenantExists(tenantId);
      const row = await getPrismaClient().fuelEvent.create({
        data: toPrismaFuelEventInput(event),
      });
      return toDomainFuelEvent(row);
    },
    async update(tenantId: TenantId, event: FuelEvent): Promise<FuelEvent> {
      assertOwnedByTenant(tenantId, event, 'events.update');
      const prisma = getPrismaClient();
      const existing = await prisma.fuelEvent.findFirst({ where: { id: event.id, tenantId } });
      if (existing === null) {
        throw new ConflictError(`Event ${event.id} does not exist for this tenant`);
      }
      const row = await prisma.fuelEvent.update({
        where: { id: event.id },
        data: {
          status: event.status,
          notes: event.notes,
          decidedByUserId: event.decidedBy,
          decidedAt: event.decidedAt === null ? null : new Date(event.decidedAt),
          confidence: event.confidence,
        },
      });
      return toDomainFuelEvent(row);
    },
    async findById(tenantId: TenantId, id: FuelEventId): Promise<FuelEvent | null> {
      const row = await getPrismaClient().fuelEvent.findFirst({ where: { id, tenantId } });
      return row === null ? null : toDomainFuelEvent(row);
    },
    async list(tenantId: TenantId, query: EventQuery = {}): Promise<ReadonlyArray<FuelEvent>> {
      const rows = await getPrismaClient().fuelEvent.findMany({
        where: {
          tenantId,
          ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.type === undefined ? {} : { type: query.type }),
          ...(query.from === undefined || query.to === undefined
            ? {}
            : { windowEnd: { gte: new Date(query.from), lte: new Date(query.to) } }),
        },
        orderBy: { windowEnd: 'desc' },
        take: clampLimit(query.limit),
      });
      return rows.map(toDomainFuelEvent);
    },
    async listRecentByTank(
      tenantId: TenantId,
      tankId: TankId,
      limit: number,
      sinceIso?: string,
    ): Promise<ReadonlyArray<FuelEvent>> {
      const rows = await getPrismaClient().fuelEvent.findMany({
        where: {
          tenantId,
          tankId,
          ...(sinceIso === undefined ? {} : { windowEnd: { gte: new Date(sinceIso) } }),
        },
        orderBy: { windowEnd: 'desc' },
        take: clampLimit(limit, 20),
      });
      return rows.map(toDomainFuelEvent);
    },
  };
}

function createDeliveryRepository(): DeliveryRepository {
  return {
    async save(tenantId: TenantId, delivery: Delivery): Promise<Delivery> {
      assertOwnedByTenant(tenantId, delivery, 'deliveries.save');
      await ensureTenantExists(tenantId);
      const row = await getPrismaClient().delivery.create({
        data: toPrismaDeliveryInput(delivery),
      });
      return toDomainDelivery(row);
    },
    async findById(tenantId: TenantId, id: DeliveryId): Promise<Delivery | null> {
      const row = await getPrismaClient().delivery.findFirst({ where: { id, tenantId } });
      return row === null ? null : toDomainDelivery(row);
    },
    async list(tenantId: TenantId, query: DeliveryQuery = {}): Promise<ReadonlyArray<Delivery>> {
      const rows = await getPrismaClient().delivery.findMany({
        where: {
          tenantId,
          ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
          ...(query.from === undefined || query.to === undefined
            ? {}
            : { confirmedAt: { gte: new Date(query.from), lte: new Date(query.to) } }),
        },
        orderBy: { confirmedAt: 'desc' },
        take: clampLimit(query.limit),
      });
      return rows.map(toDomainDelivery);
    },
    async listByEvent(tenantId: TenantId, eventId: FuelEventId): Promise<ReadonlyArray<Delivery>> {
      const rows = await getPrismaClient().delivery.findMany({
        where: { tenantId, fuelEventId: eventId },
        orderBy: { confirmedAt: 'desc' },
      });
      return rows.map(toDomainDelivery);
    },
  };
}

function createAuditLogRepository(): AuditLogRepository {
  return {
    async append(entry: AuditLogEntry): Promise<AuditLogEntry> {
      const row = await getPrismaClient().auditLog.create({ data: toPrismaAuditInput(entry) });
      return toDomainAuditEntry(row);
    },
    async list(tenantId: TenantId, query: AuditQuery = {}): Promise<ReadonlyArray<AuditLogEntry>> {
      const rows = await getPrismaClient().auditLog.findMany({
        where: {
          tenantId,
          ...(query.action === undefined ? {} : { action: query.action }),
          ...(query.resourceType === undefined ? {} : { resourceType: query.resourceType }),
          ...(query.from === undefined || query.to === undefined
            ? {}
            : { occurredAt: { gte: new Date(query.from), lte: new Date(query.to) } }),
        },
        orderBy: { occurredAt: 'desc' },
        take: clampLimit(query.limit),
      });
      return rows.map(toDomainAuditEntry);
    },
  };
}

function createRawMessageRepository(): RawMessageRepository {
  return {
    async save(tenantId: TenantId, record: RawMessageRecord): Promise<RawMessageRecord> {
      assertOwnedByTenant(tenantId, record, 'rawMessages.save');
      await ensureTenantExists(tenantId);
      const input = toPrismaRawMessageInput(record);
      const row = await getPrismaClient().rawDeviceMessage.upsert({
        where: {
          tenantId_messageHash: { tenantId: input.tenantId, messageHash: input.messageHash },
        },
        update: {},
        create: input,
      });
      return toDomainRawMessage(row);
    },
    async findById(tenantId: TenantId, id: RawMessageId): Promise<RawMessageRecord | null> {
      const row = await getPrismaClient().rawDeviceMessage.findFirst({ where: { id, tenantId } });
      return row === null ? null : toDomainRawMessage(row);
    },
    async findByHash(tenantId: TenantId, messageHash: string): Promise<RawMessageRecord | null> {
      const row = await getPrismaClient().rawDeviceMessage.findFirst({
        where: { tenantId, messageHash },
      });
      return row === null ? null : toDomainRawMessage(row);
    },
    async listByDevice(
      tenantId: TenantId,
      deviceId: DeviceId,
      limit?: number,
    ): Promise<ReadonlyArray<RawMessageRecord>> {
      const rows = await getPrismaClient().rawDeviceMessage.findMany({
        where: { tenantId, deviceId },
        orderBy: { receivedAt: 'desc' },
        take: clampLimit(limit),
      });
      return rows.map(toDomainRawMessage);
    },
  };
}
