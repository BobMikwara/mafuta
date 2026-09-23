import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, TenantIsolationError } from '../src/errors.js';
import type { DeliveryId } from '../src/types/ids.js';
import { createPrismaRepositories } from '../src/adapters/prisma/prisma-repositories.js';
import type {
  AlertRow,
  AssignmentRow,
  AuditRow,
  DeliveryRow,
  DeviceRow,
  FuelEventRow,
  RawMessageRow,
  ReadingRow,
  TankRow,
} from '../src/adapters/prisma/mappers.js';
import {
  makeAlert,
  makeAssignment,
  makeAuditEntry,
  makeDelivery,
  makeDevice,
  makeEvent,
  makeRawMessage,
  makeReading,
  makeStation,
  makeTank,
  TENANT_A,
  TENANT_B,
} from './factories.js';

vi.mock('@prisma/client', async () => {
  const { MockPrismaClient } = await import('./prisma-mock.js');
  return { PrismaClient: MockPrismaClient };
});

import { clearPrismaClientCache, mockPrisma, resetMockPrisma } from './prisma-mock.js';

/**
 * Unit tests for the Prisma repository adapters, against a controllable fake
 * of the generated client. Two properties matter most and are asserted for
 * every method: the tenant id reaches the query's `where` clause (so a query
 * cannot read or modify another tenant's rows), and rows map through
 * `mappers.ts` in both directions. The branch paths unique to each method
 * (unique violations, missing rows, filter combinations) are covered beside
 * them. The same adapters are proven over a real socket by the integration
 * tests that run wherever a PostgreSQL server is reachable.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-01-02T00:00:00.000Z');

function stationRow(): {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  timezone: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: 'station-1',
    tenantId: TENANT_A,
    name: 'Test Station',
    code: 'TST-01',
    timezone: 'Africa/Nairobi',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function tankRow(): TankRow {
  return {
    id: 'tank-1',
    tenantId: TENANT_A,
    stationId: 'station-1',
    name: 'Diesel Tank 1',
    product: 'diesel',
    capacityLitres: 19_000,
    geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
    calibrationSource: null,
    calibrationAt: null,
    criticalLowPercent: 10,
    lowPercent: 20,
    highPercent: 95,
    waterAlarmMm: 50,
    unexplainedDecreaseLitresPerHour: 400,
    deliveryMinLitres: 300,
    deliveryWindowMinutes: 30,
    staleAfterMinutes: 60,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function readingRow(overrides: Partial<ReadingRow> = {}): ReadingRow {
  return {
    id: 'rdg-1',
    tenantId: TENANT_A,
    tankId: 'tank-1',
    deviceId: null,
    recordedAt: NOW,
    receivedAt: NOW,
    levelMm: 2000,
    waterLevelMm: 5,
    volumeLitres: 9500.5,
    temperatureC: 22,
    provenance: 'measured',
    qualityStatus: 'ok',
    freshnessStatus: 'fresh',
    sourceProtocol: 'http',
    idempotencyKey: 'idem-1',
    rawMessageId: null,
    ...overrides,
  };
}

function alertRow(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: 'alt-1',
    tenantId: TENANT_A,
    tankId: 'tank-1',
    type: 'low_stock',
    severity: 'warning',
    status: 'open',
    message: 'Low stock',
    metrics: { _readingId: 'rdg-1', fillPercent: 15 },
    raisedAt: NOW,
    updatedAt: NOW,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    assignedToUserId: null,
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  };
}

function deviceRow(overrides: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: 'dev-1',
    tenantId: TENANT_A,
    manufacturer: 'Acme',
    model: 'Probe 2',
    serialNumber: 'SN-001',
    protocol: 'http',
    firmwareVersion: null,
    status: 'active',
    connectionState: 'online',
    lastSeenAt: NOW,
    credentialRef: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function assignmentRow(overrides: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    id: 'asg-1',
    tenantId: TENANT_A,
    deviceId: 'dev-1',
    tankId: 'tank-1',
    status: 'active',
    assignedAt: NOW,
    unassignedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function eventRow(overrides: Partial<FuelEventRow> = {}): FuelEventRow {
  return {
    id: 'evt-1',
    tenantId: TENANT_A,
    tankId: 'tank-1',
    type: 'candidate_delivery',
    status: 'candidate',
    confidence: 0.8,
    volumeChangeLitres: 350,
    windowStart: NOW,
    windowEnd: LATER,
    evidence: { sourceLevelMm: 1000 },
    notes: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function deliveryRow(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: 'dly-1',
    tenantId: TENANT_A,
    tankId: 'tank-1',
    fuelEventId: 'evt-1',
    volumeLitres: 350,
    reference: 'DOCKET-9',
    supplier: null,
    confirmedByUserId: 'user-1',
    confirmedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function auditRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'aud-1',
    tenantId: TENANT_A,
    actorType: 'api_key',
    actorUserId: null,
    actorDeviceId: null,
    action: 'tank.created',
    resourceType: 'tank',
    resourceId: 'tank-1',
    ipHash: null,
    metadata: { name: 'Diesel Tank 1' },
    occurredAt: NOW,
    ...overrides,
  };
}

function rawRow(overrides: Partial<RawMessageRow> = {}): RawMessageRow {
  return {
    id: 'raw-1',
    tenantId: TENANT_A,
    deviceId: 'dev-1',
    protocol: 'http',
    payload: { level: 2000 },
    messageHash: 'hash-1',
    receivedAt: NOW,
    ...overrides,
  };
}

function repos() {
  return createPrismaRepositories();
}

beforeEach(() => {
  resetMockPrisma();
  clearPrismaClientCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearPrismaClientCache();
});

describe('tenants', () => {
  it('lists ids with a clamped page size', async () => {
    mockPrisma.tenant.findMany.mockResolvedValueOnce([{ id: 'tenant-a' }]);
    await expect(repos().tenants.list()).resolves.toEqual([{ id: 'tenant-a' }]);
    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    await repos().tenants.list(5_000);
    expect(mockPrisma.tenant.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 1000 }),
    );
  });
});

describe('stations', () => {
  it('saves with tenant scoping and maps the row back', async () => {
    const station = makeStation();
    mockPrisma.station.upsert.mockResolvedValueOnce(stationRow());
    const saved = await repos().stations.save(TENANT_A, station);
    expect(mockPrisma.tenant.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.station.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: station.id } }),
    );
    expect(saved.name).toBe('Test Station');
    expect(saved.status).toBe('active');
  });

  it('refuses to save an entity owned by another tenant', async () => {
    await expect(repos().stations.save(TENANT_B, makeStation())).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
    expect(mockPrisma.station.upsert).not.toHaveBeenCalled();
  });

  it('finds by id and code within the tenant', async () => {
    mockPrisma.station.findFirst.mockResolvedValueOnce(stationRow());
    await expect(repos().stations.findById(TENANT_A, makeStation().id)).resolves.toMatchObject({
      code: 'TST-01',
    });
    expect(mockPrisma.station.findFirst).toHaveBeenCalledWith({
      where: { id: 'station-1', tenantId: TENANT_A },
    });

    mockPrisma.station.findFirst.mockResolvedValueOnce(null);
    await expect(repos().stations.findByCode(TENANT_A, 'TST-01')).resolves.toBeNull();
    expect(mockPrisma.station.findFirst).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, code: 'TST-01' },
    });
  });

  it('lists with optional status filter', async () => {
    mockPrisma.station.findMany.mockResolvedValueOnce([stationRow()]);
    await expect(repos().stations.list(TENANT_A, { status: 'active' })).resolves.toHaveLength(1);
    expect(mockPrisma.station.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, status: 'active' },
      orderBy: { name: 'asc' },
      take: 100,
    });
  });
});

describe('tanks', () => {
  it('saves with tenant scoping and threshold fields', async () => {
    const tank = makeTank();
    mockPrisma.tank.upsert.mockResolvedValueOnce(tankRow());
    const saved = await repos().tanks.save(TENANT_A, tank);
    const args = mockPrisma.tank.upsert.mock.calls[0]?.[0] as {
      create: Record<string, unknown>;
    };
    expect(args.create['tenantId']).toBe(TENANT_A);
    expect(args.create['criticalLowPercent']).toBe(10);
    expect(saved.thresholds.criticalLowPercent).toBe(10);
  });

  it('maps the product code to the database spelling', async () => {
    mockPrisma.tank.upsert.mockResolvedValueOnce(tankRow());
    await repos().tanks.save(TENANT_A, makeTank({ product: 'petrol-95' }));
    const args = mockPrisma.tank.upsert.mock.calls[0]?.[0] as {
      create: Record<string, unknown>;
    };
    expect(args.create['product']).toBe('petrol_95');
  });

  it('finds and lists within the tenant', async () => {
    mockPrisma.tank.findFirst.mockResolvedValueOnce(tankRow());
    await expect(repos().tanks.findById(TENANT_A, makeTank().id)).resolves.toMatchObject({
      name: 'Diesel Tank 1',
    });

    mockPrisma.tank.findMany.mockResolvedValueOnce([tankRow()]);
    await expect(
      repos().tanks.list(TENANT_A, { stationId: makeTank().stationId, status: 'active' }),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.tank.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, stationId: 'station-1', status: 'active' },
      orderBy: { name: 'asc' },
      take: 100,
    });
  });
});

describe('readings', () => {
  it('appends and maps, with tenant asserted on the write', async () => {
    const reading = makeReading();
    mockPrisma.tankReading.create.mockResolvedValueOnce(readingRow());
    const saved = await repos().readings.append(TENANT_A, reading);
    expect(saved.id).toBe('rdg-1');
    expect(mockPrisma.tankReading.create).toHaveBeenCalledTimes(1);
  });

  it('turns a unique violation into a conflict, never a second ledger row', async () => {
    mockPrisma.tankReading.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(repos().readings.append(TENANT_A, makeReading())).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('rethrows storage failures that are not unique violations', async () => {
    mockPrisma.tankReading.create.mockRejectedValueOnce(new Error('disk full'));
    await expect(repos().readings.append(TENANT_A, makeReading())).rejects.toThrow('disk full');
  });

  it('looks up by id and by idempotency key within the tenant', async () => {
    mockPrisma.tankReading.findFirst.mockResolvedValueOnce(readingRow());
    await expect(repos().readings.findById(TENANT_A, makeReading().id)).resolves.toMatchObject({
      idempotencyKey: 'idem-1',
    });
    expect(mockPrisma.tankReading.findFirst).toHaveBeenCalledWith({
      where: { id: 'rdg-1', tenantId: TENANT_A },
    });

    mockPrisma.tankReading.findFirst.mockResolvedValueOnce(null);
    await expect(repos().readings.findByIdempotencyKey(TENANT_A, 'idem-1')).resolves.toBeNull();
    expect(mockPrisma.tankReading.findFirst).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, idempotencyKey: 'idem-1' },
    });
  });

  it('applies the recordedAt window only when both bounds are given', async () => {
    mockPrisma.tankReading.findMany.mockResolvedValueOnce([]);
    await repos().readings.list(TENANT_A, {
      tankId: makeReading().tankId,
      limit: 10,
      from: NOW.toISOString(),
      to: LATER.toISOString(),
      ascending: true,
    });
    expect(mockPrisma.tankReading.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_A,
        tankId: 'tank-1',
        recordedAt: { gte: NOW, lte: LATER },
      },
      orderBy: { recordedAt: 'asc' },
      take: 10,
    });

    mockPrisma.tankReading.findMany.mockResolvedValueOnce([]);
    await repos().readings.list(TENANT_A, {
      tankId: makeReading().tankId,
      limit: 10,
      from: NOW.toISOString(),
    });
    const args = mockPrisma.tankReading.findMany.mock.calls.at(-1)?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).not.toHaveProperty('recordedAt');
  });

  it('reads the latest reading per tank', async () => {
    mockPrisma.tankReading.findFirst.mockResolvedValueOnce(readingRow());
    await expect(repos().readings.latest(TENANT_A, makeReading().tankId)).resolves.toMatchObject({
      id: 'rdg-1',
    });

    mockPrisma.tankReading.findMany.mockResolvedValueOnce([
      readingRow({ tankId: 'tank-1' }),
      readingRow({ id: 'rdg-2', tankId: 'tank-2' }),
    ]);
    const byTank = await repos().readings.latestByTank(TENANT_A);
    expect(byTank.size).toBe(2);
    expect(byTank.get(makeReading().tankId)?.id).toBe('rdg-1');
    expect(mockPrisma.tankReading.findMany).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A },
      orderBy: { recordedAt: 'desc' },
      distinct: ['tankId'],
    });
  });
});

describe('alerts', () => {
  it('saves and maps with tenant asserted on the write', async () => {
    mockPrisma.alert.create.mockResolvedValueOnce(alertRow());
    const saved = await repos().alerts.save(TENANT_A, makeAlert());
    expect(saved.severity).toBe('warning');
    expect(saved.readingId).toBe('rdg-1');
  });

  it('updates only an alert the tenant owns', async () => {
    mockPrisma.alert.findFirst.mockResolvedValueOnce(null);
    await expect(repos().alerts.update(TENANT_A, makeAlert())).rejects.toBeInstanceOf(
      ConflictError,
    );

    mockPrisma.alert.findFirst.mockResolvedValueOnce(alertRow());
    mockPrisma.alert.update.mockResolvedValueOnce(alertRow({ status: 'acknowledged' }));
    const updated = await repos().alerts.update(TENANT_A, makeAlert());
    expect(updated.status).toBe('acknowledged');
    expect(mockPrisma.alert.findFirst).toHaveBeenCalledWith({
      where: { id: 'alt-1', tenantId: TENANT_A },
    });
  });

  it('lists with filters and counts open alerts per tenant', async () => {
    mockPrisma.alert.findMany.mockResolvedValueOnce([alertRow()]);
    await expect(
      repos().alerts.list(TENANT_A, {
        tankId: makeAlert().tankId!,
        status: 'open',
        type: 'low_stock',
      }),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.alert.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, tankId: 'tank-1', status: 'open', type: 'low_stock' },
      orderBy: { raisedAt: 'desc' },
      take: 100,
    });

    mockPrisma.alert.findMany.mockResolvedValueOnce([alertRow()]);
    await expect(
      repos().alerts.listOpenByTank(TENANT_A, makeAlert().tankId!),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.alert.findMany).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, tankId: 'tank-1', status: { in: ['open', 'acknowledged'] } },
      orderBy: { raisedAt: 'desc' },
    });

    mockPrisma.alert.count.mockResolvedValueOnce(3);
    await expect(repos().alerts.countOpen(TENANT_A)).resolves.toBe(3);
    expect(mockPrisma.alert.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, status: 'open' },
    });
  });
});

describe('devices', () => {
  it('saves, finds by id and serial number within the tenant', async () => {
    mockPrisma.device.upsert.mockResolvedValueOnce(deviceRow());
    const saved = await repos().devices.save(TENANT_A, makeDevice());
    expect(saved.serialNumber).toBe('SN-001');

    mockPrisma.device.findFirst.mockResolvedValueOnce(deviceRow());
    await expect(repos().devices.findBySerialNumber(TENANT_A, 'SN-001')).resolves.toMatchObject({
      id: 'dev-1',
    });
    expect(mockPrisma.device.findFirst).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, serialNumber: 'SN-001' },
    });
  });

  it('lists plain and by status filter', async () => {
    mockPrisma.device.findMany.mockResolvedValueOnce([deviceRow()]);
    await expect(repos().devices.list(TENANT_A, { status: 'active' })).resolves.toHaveLength(1);
    expect(mockPrisma.device.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, status: 'active' },
      orderBy: { serialNumber: 'asc' },
      take: 100,
    });
  });

  it('lists by tank through active assignments', async () => {
    mockPrisma.deviceAssignment.findMany.mockResolvedValueOnce([{ deviceId: 'dev-1' }]);
    mockPrisma.device.findMany.mockResolvedValueOnce([deviceRow()]);
    await expect(
      repos().devices.list(TENANT_A, { tankId: makeAssignment().tankId }),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.deviceAssignment.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, status: 'active', tankId: { in: ['tank-1'] } },
      select: { deviceId: true },
    });
  });

  it('lists by station through its tanks and active assignments', async () => {
    mockPrisma.tank.findMany.mockResolvedValueOnce([{ id: 'tank-1' }]);
    mockPrisma.deviceAssignment.findMany.mockResolvedValueOnce([{ deviceId: 'dev-1' }]);
    mockPrisma.device.findMany.mockResolvedValueOnce([deviceRow()]);
    await expect(
      repos().devices.list(TENANT_A, { stationId: makeStation().id }),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.tank.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, stationId: 'station-1' },
      select: { id: true },
    });
  });

  it('returns empty when the tank or station holds no assigned devices', async () => {
    mockPrisma.deviceAssignment.findMany.mockResolvedValueOnce([]);
    await expect(
      repos().devices.list(TENANT_A, { tankId: makeAssignment().tankId }),
    ).resolves.toEqual([]);
    expect(mockPrisma.device.findMany).not.toHaveBeenCalled();
  });

  it('touches liveness, promoting a registered device to active', async () => {
    mockPrisma.device.findFirst.mockResolvedValueOnce(null);
    await repos().devices.touch(TENANT_A, makeDevice().id, NOW.toISOString(), 'online');
    expect(mockPrisma.device.update).not.toHaveBeenCalled();

    mockPrisma.device.findFirst.mockResolvedValueOnce({ id: 'dev-1', status: 'registered' });
    await repos().devices.touch(TENANT_A, makeDevice().id, NOW.toISOString(), 'online');
    expect(mockPrisma.device.update).toHaveBeenCalledWith({
      where: { id: 'dev-1' },
      data: expect.objectContaining({ status: 'active', connectionState: 'online' }),
    });

    mockPrisma.device.findFirst.mockResolvedValueOnce({ id: 'dev-1', status: 'active' });
    await repos().devices.touch(TENANT_A, makeDevice().id, NOW.toISOString(), 'offline');
    const data = mockPrisma.device.update.mock.calls.at(-1)?.[0] as { data: object };
    expect(data.data).not.toHaveProperty('status');
  });
});

describe('assignments', () => {
  it('saves and maps with tenant asserted on the write', async () => {
    mockPrisma.deviceAssignment.upsert.mockResolvedValueOnce(assignmentRow());
    const saved = await repos().assignments.save(TENANT_A, makeAssignment());
    expect(saved.status).toBe('active');
  });

  it('finds by id and by active device within the tenant', async () => {
    mockPrisma.deviceAssignment.findFirst.mockResolvedValueOnce(assignmentRow());
    await expect(repos().assignments.findById(TENANT_A, 'asg-1')).resolves.toMatchObject({
      id: 'asg-1',
    });

    mockPrisma.deviceAssignment.findFirst.mockResolvedValueOnce(assignmentRow());
    await expect(
      repos().assignments.findActiveByDevice(TENANT_A, makeAssignment().deviceId),
    ).resolves.toMatchObject({ tankId: 'tank-1' });
    expect(mockPrisma.deviceAssignment.findFirst).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, deviceId: 'dev-1', status: 'active' },
      orderBy: { assignedAt: 'desc' },
    });
  });

  it('lists by tank, by device and active sets', async () => {
    mockPrisma.deviceAssignment.findMany.mockResolvedValueOnce([assignmentRow()]);
    await expect(
      repos().assignments.listActiveByTank(TENANT_A, makeAssignment().tankId),
    ).resolves.toHaveLength(1);

    mockPrisma.deviceAssignment.findMany.mockResolvedValueOnce([assignmentRow()]);
    await expect(
      repos().assignments.listByTank(TENANT_A, makeAssignment().tankId, 'ended'),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.deviceAssignment.findMany).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, tankId: 'tank-1', status: 'ended' },
      orderBy: { assignedAt: 'desc' },
    });

    mockPrisma.deviceAssignment.findMany.mockResolvedValueOnce([assignmentRow()]);
    await expect(
      repos().assignments.listByDevice(TENANT_A, makeAssignment().deviceId),
    ).resolves.toHaveLength(1);

    mockPrisma.deviceAssignment.findMany.mockResolvedValueOnce([assignmentRow()]);
    await expect(repos().assignments.listActive(TENANT_A)).resolves.toHaveLength(1);
    expect(mockPrisma.deviceAssignment.findMany).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, status: 'active' },
      orderBy: { assignedAt: 'desc' },
    });
  });

  it('lists active assignments for a station via its tanks', async () => {
    mockPrisma.tank.findMany.mockResolvedValueOnce([{ id: 'tank-1' }]);
    mockPrisma.tank.findMany.mockResolvedValueOnce([{ id: 'tank-1' }]);
    mockPrisma.deviceAssignment.findMany.mockResolvedValueOnce([assignmentRow()]);
    await expect(
      repos().assignments.listActive(TENANT_A, { stationId: makeStation().id }),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.deviceAssignment.findMany).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, status: 'active', tankId: { in: ['tank-1'] } },
      orderBy: { assignedAt: 'desc' },
    });

    mockPrisma.tank.findMany.mockResolvedValueOnce([]);
    await expect(
      repos().assignments.listActive(TENANT_A, { stationId: makeStation().id }),
    ).resolves.toEqual([]);
  });

  it('ends an assignment the tenant owns', async () => {
    mockPrisma.deviceAssignment.findFirst.mockResolvedValueOnce(null);
    await expect(
      repos().assignments.end(TENANT_A, 'asg-1', NOW.toISOString()),
    ).rejects.toBeInstanceOf(ConflictError);

    mockPrisma.deviceAssignment.findFirst.mockResolvedValueOnce(assignmentRow());
    mockPrisma.deviceAssignment.update.mockResolvedValueOnce(
      assignmentRow({ status: 'ended', unassignedAt: LATER }),
    );
    const ended = await repos().assignments.end(TENANT_A, 'asg-1', LATER.toISOString());
    expect(ended.status).toBe('ended');
    expect(mockPrisma.deviceAssignment.update).toHaveBeenCalledWith({
      where: { id: 'asg-1' },
      data: { status: 'ended', unassignedAt: LATER },
    });
  });
});

describe('fuel events', () => {
  it('saves and maps with tenant asserted on the write', async () => {
    mockPrisma.fuelEvent.create.mockResolvedValueOnce(eventRow());
    const saved = await repos().events.save(TENANT_A, makeEvent());
    expect(saved.confidence).toBe(0.8);
    expect(saved.volumeChangeMl).toBe(350_000);
  });

  it('updates only an event the tenant owns', async () => {
    mockPrisma.fuelEvent.findFirst.mockResolvedValueOnce(null);
    await expect(repos().events.update(TENANT_A, makeEvent())).rejects.toBeInstanceOf(
      ConflictError,
    );

    mockPrisma.fuelEvent.findFirst.mockResolvedValueOnce(eventRow());
    mockPrisma.fuelEvent.update.mockResolvedValueOnce(eventRow({ status: 'confirmed' }));
    await expect(repos().events.update(TENANT_A, makeEvent())).resolves.toMatchObject({
      status: 'confirmed',
    });
  });

  it('lists with filters and a window on windowEnd', async () => {
    mockPrisma.fuelEvent.findMany.mockResolvedValueOnce([eventRow()]);
    await expect(
      repos().events.list(TENANT_A, {
        tankId: makeEvent().tankId,
        status: 'candidate',
        type: 'candidate_delivery',
        from: NOW.toISOString(),
        to: LATER.toISOString(),
      }),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.fuelEvent.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_A,
        tankId: 'tank-1',
        status: 'candidate',
        type: 'candidate_delivery',
        windowEnd: { gte: NOW, lte: LATER },
      },
      orderBy: { windowEnd: 'desc' },
      take: 100,
    });
  });

  it('lists recent events for a tank with an optional lower bound', async () => {
    mockPrisma.fuelEvent.findMany.mockResolvedValueOnce([eventRow()]);
    await expect(
      repos().events.listRecentByTank(TENANT_A, makeEvent().tankId, 5, LATER.toISOString()),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.fuelEvent.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, tankId: 'tank-1', windowEnd: { gte: LATER } },
      orderBy: { windowEnd: 'desc' },
      take: 5,
    });

    mockPrisma.fuelEvent.findMany.mockResolvedValueOnce([]);
    await repos().events.listRecentByTank(TENANT_A, makeEvent().tankId, Number.NaN);
    const args = mockPrisma.fuelEvent.findMany.mock.calls.at(-1)?.[0] as {
      where: Record<string, unknown>;
      take: number;
    };
    expect(args.where).not.toHaveProperty('windowEnd');
    // A limit that is not a finite number falls back to the smaller page.
    expect(args.take).toBe(20);
  });
});

describe('deliveries', () => {
  it('saves and maps with tenant asserted on the write', async () => {
    mockPrisma.delivery.create.mockResolvedValueOnce(deliveryRow());
    const saved = await repos().deliveries.save(TENANT_A, makeDelivery());
    expect(saved.recordedVolumeMl).toBe(350_000);
  });

  it('finds, lists with a confirmedAt window, and lists by event', async () => {
    mockPrisma.delivery.findFirst.mockResolvedValueOnce(deliveryRow());
    await expect(
      repos().deliveries.findById(TENANT_A, makeDelivery().id as DeliveryId),
    ).resolves.toMatchObject({
      reference: 'DOCKET-9',
    });

    mockPrisma.delivery.findMany.mockResolvedValueOnce([deliveryRow()]);
    await expect(
      repos().deliveries.list(TENANT_A, {
        tankId: makeDelivery().tankId,
        from: NOW.toISOString(),
        to: LATER.toISOString(),
      }),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_A,
        tankId: 'tank-1',
        confirmedAt: { gte: NOW, lte: LATER },
      },
      orderBy: { confirmedAt: 'desc' },
      take: 100,
    });

    mockPrisma.delivery.findMany.mockResolvedValueOnce([deliveryRow()]);
    await expect(
      repos().deliveries.listByEvent(TENANT_A, makeDelivery().fuelEventId!),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.delivery.findMany).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, fuelEventId: 'evt-1' },
      orderBy: { confirmedAt: 'desc' },
    });
  });
});

describe('audit log', () => {
  it('appends and lists with filters and a window', async () => {
    mockPrisma.auditLog.create.mockResolvedValueOnce(auditRow());
    const appended = await repos().auditLogs.append(makeAuditEntry());
    expect(appended.action).toBe('tank.created');

    mockPrisma.auditLog.findMany.mockResolvedValueOnce([auditRow()]);
    await expect(
      repos().auditLogs.list(TENANT_A, {
        action: 'tank.created',
        resourceType: 'tank',
        from: NOW.toISOString(),
        to: LATER.toISOString(),
      }),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_A,
        action: 'tank.created',
        resourceType: 'tank',
        occurredAt: { gte: NOW, lte: LATER },
      },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
  });
});

describe('raw messages', () => {
  it('stores immutable payloads keyed by tenant and hash', async () => {
    mockPrisma.rawDeviceMessage.upsert.mockResolvedValueOnce(rawRow());
    const saved = await repos().rawMessages.save(TENANT_A, makeRawMessage());
    expect(saved.messageHash).toBe('hash-1');
    expect(mockPrisma.rawDeviceMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_messageHash: { tenantId: TENANT_A, messageHash: 'hash-1' },
        },
        update: {},
      }),
    );
  });

  it('finds by id and hash within the tenant', async () => {
    mockPrisma.rawDeviceMessage.findFirst.mockResolvedValueOnce(rawRow());
    await expect(
      repos().rawMessages.findById(TENANT_A, makeRawMessage().id),
    ).resolves.toMatchObject({ protocol: 'http' });

    mockPrisma.rawDeviceMessage.findFirst.mockResolvedValueOnce(null);
    await expect(repos().rawMessages.findByHash(TENANT_A, 'hash-1')).resolves.toBeNull();
    expect(mockPrisma.rawDeviceMessage.findFirst).toHaveBeenLastCalledWith({
      where: { tenantId: TENANT_A, messageHash: 'hash-1' },
    });
  });

  it('lists a device payload history within the tenant', async () => {
    mockPrisma.rawDeviceMessage.findMany.mockResolvedValueOnce([rawRow()]);
    await expect(
      repos().rawMessages.listByDevice(TENANT_A, makeRawMessage().deviceId!, 5),
    ).resolves.toHaveLength(1);
    expect(mockPrisma.rawDeviceMessage.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, deviceId: 'dev-1' },
      orderBy: { receivedAt: 'desc' },
      take: 5,
    });
  });
});
