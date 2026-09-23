import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryDeviceAssignmentRepository,
  createMemoryDeviceRepository,
} from '../src/adapters/memory/memory-device-repositories.js';
import { createMemoryStore } from '../src/adapters/memory/memory-store.js';
import type { MemoryStore } from '../src/adapters/memory/memory-store.js';
import { TenantIsolationError } from '../src/errors.js';
import {
  makeAssignment,
  makeDevice,
  makeStation,
  makeTank,
  deviceId,
  stationId,
  tankId,
  TENANT_A,
  TENANT_B,
} from './factories.js';

/**
 * The in-memory device and assignment adapters back the simulator and every
 * environment without a database, so their filter logic is the real contract
 * for "which devices feed this tank": tenant scoping, active assignments only,
 * and station reachability through the tank table.
 */

const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-01T06:00:00.000Z';

let store: MemoryStore;
let devices: ReturnType<typeof createMemoryDeviceRepository>;
let assignments: ReturnType<typeof createMemoryDeviceAssignmentRepository>;

beforeEach(() => {
  store = createMemoryStore();
  devices = createMemoryDeviceRepository(store);
  assignments = createMemoryDeviceAssignmentRepository(store);
});

describe('device repository', () => {
  it('saves, finds and refuses cross-tenant access', async () => {
    const device = makeDevice();
    await devices.save(TENANT_A, device);
    await expect(devices.findById(TENANT_A, device.id)).resolves.toMatchObject({
      serialNumber: device.serialNumber,
    });
    await expect(devices.findById(TENANT_B, device.id)).resolves.toBeNull();
    await expect(devices.save(TENANT_B, device)).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it('finds by serial number within the tenant only', async () => {
    await devices.save(TENANT_A, makeDevice({ serialNumber: 'SN-SHARED' }));
    await devices.save(
      TENANT_B,
      makeDevice({ id: deviceId('dev-b'), tenantId: TENANT_B, serialNumber: 'SN-SHARED' }),
    );
    await expect(devices.findBySerialNumber(TENANT_A, 'SN-SHARED')).resolves.toMatchObject({
      id: makeDevice().id,
    });
    await expect(devices.findBySerialNumber(TENANT_A, 'SN-MISSING')).resolves.toBeNull();
  });

  it('filters by status, tank and station through active assignments', async () => {
    await devices.save(TENANT_A, makeDevice({ serialNumber: 'SN-ACTIVE' }));
    await devices.save(TENANT_A, makeDevice({ id: deviceId('dev-off'), serialNumber: 'SN-OFF' }));
    await assignments.save(
      TENANT_A,
      makeAssignment({
        deviceId: makeDevice().id,
        tankId: tankId('tank-live'),
        status: 'active',
      }),
    );
    await assignments.save(
      TENANT_A,
      makeAssignment({
        id: 'asg-ended' as never,
        deviceId: deviceId('dev-off'),
        tankId: tankId('tank-live'),
        status: 'ended',
        unassignedAt: NOW,
      }),
    );

    await expect(devices.list(TENANT_A, { status: 'active' })).resolves.toHaveLength(2);
    await expect(devices.list(TENANT_A, { tankId: tankId('tank-live') })).resolves.toMatchObject([
      { serialNumber: 'SN-ACTIVE' },
    ]);
    await expect(devices.list(TENANT_A, {})).resolves.toHaveLength(2);
  });

  it('ignores assignments from other tenants and from other devices', async () => {
    await devices.save(TENANT_A, makeDevice());
    await assignments.save(
      TENANT_B,
      makeAssignment({
        id: 'asg-b' as never,
        tenantId: TENANT_B,
        deviceId: makeDevice().id,
        tankId: tankId('tank-shared-name'),
        status: 'active',
      }),
    );
    await expect(devices.list(TENANT_A, { tankId: tankId('tank-shared-name') })).resolves.toEqual(
      [],
    );
    await expect(devices.list(TENANT_A, { tankId: tankId('tank-unknown') })).resolves.toEqual([]);
  });

  it('reaches station filters through the assigned tank', async () => {
    await makeStationAndTank('station-1', 'tank-1');
    await devices.save(TENANT_A, makeDevice());
    await assignments.save(
      TENANT_A,
      makeAssignment({
        deviceId: makeDevice().id,
        tankId: tankId('tank-1'),
        status: 'active',
      }),
    );
    await assignments.save(
      TENANT_A,
      makeAssignment({
        id: 'asg-ghost' as never,
        deviceId: deviceId('dev-ghost'),
        tankId: tankId('tank-ghost'),
        status: 'active',
      }),
    );

    await expect(
      devices.list(TENANT_A, { stationId: stationId('station-1') }),
    ).resolves.toHaveLength(1);
    await expect(devices.list(TENANT_A, { stationId: stationId('station-9') })).resolves.toEqual(
      [],
    );
  });

  it('touches liveness and promotes registered devices', async () => {
    const device = makeDevice();
    await devices.save(TENANT_A, device);
    await devices.touch(TENANT_A, device.id, NOW, 'offline');
    const touched = await devices.findById(TENANT_A, device.id);
    expect(touched?.connectionState).toBe('offline');
    expect(touched?.lastSeenAt).toBe(NOW);

    await devices.save(
      TENANT_A,
      makeDevice({ id: deviceId('dev-new'), status: 'registered', serialNumber: 'SN-NEW' }),
    );
    await devices.touch(TENANT_A, deviceId('dev-new'), LATER, 'online');
    expect((await devices.findById(TENANT_A, deviceId('dev-new')))?.status).toBe('active');

    await devices.touch(TENANT_A, deviceId('dev-absent'), LATER, 'online');
  });
});

describe('assignment repository', () => {
  it('tracks the lifecycle of an assignment', async () => {
    const assignment = makeAssignment();
    await assignments.save(TENANT_A, assignment);
    await expect(assignments.findById(TENANT_A, assignment.id)).resolves.toMatchObject({
      status: 'active',
    });
    await expect(assignments.findById(TENANT_B, assignment.id)).resolves.toBeNull();

    const ended = await assignments.end(TENANT_A, assignment.id, LATER);
    expect(ended.status).toBe('ended');
    expect(ended.unassignedAt).toBe(LATER);
    await expect(assignments.findActiveByDevice(TENANT_A, assignment.deviceId)).resolves.toBeNull();
    await expect(assignments.end(TENANT_A, 'asg-absent', LATER)).rejects.toThrow(/does not exist/);
    await expect(assignments.save(TENANT_B, assignment)).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
  });

  it('lists active and status-filtered assignments for tanks and devices', async () => {
    const active = makeAssignment({ tankId: tankId('tank-1'), deviceId: deviceId('dev-1') });
    const ended = makeAssignment({
      id: 'asg-2' as never,
      tankId: tankId('tank-1'),
      deviceId: deviceId('dev-2'),
      status: 'ended',
      unassignedAt: NOW,
    });
    await assignments.save(TENANT_A, active);
    await assignments.save(TENANT_A, ended);

    await expect(assignments.listActiveByTank(TENANT_A, tankId('tank-1'))).resolves.toHaveLength(1);
    await expect(assignments.listByTank(TENANT_A, tankId('tank-1'))).resolves.toHaveLength(2);
    await expect(
      assignments.listByTank(TENANT_A, tankId('tank-1'), 'ended'),
    ).resolves.toMatchObject([{ id: ended.id }]);
    await expect(assignments.listByDevice(TENANT_A, deviceId('dev-1'))).resolves.toHaveLength(1);
    await expect(assignments.listActive(TENANT_A)).resolves.toMatchObject([{ id: active.id }]);
    await expect(
      assignments.findActiveByDevice(TENANT_A, deviceId('dev-1')),
    ).resolves.toMatchObject({ id: active.id });
  });

  it('filters active assignments by station through the tank table', async () => {
    await makeStationAndTank('station-1', 'tank-1');
    await assignments.save(
      TENANT_A,
      makeAssignment({ tankId: tankId('tank-1'), deviceId: deviceId('dev-1') }),
    );
    await assignments.save(
      TENANT_A,
      makeAssignment({
        id: 'asg-ghost' as never,
        tankId: tankId('tank-ghost'),
        deviceId: deviceId('dev-ghost'),
      }),
    );

    await expect(
      assignments.listActive(TENANT_A, { stationId: stationId('station-1') }),
    ).resolves.toHaveLength(1);
    await expect(
      assignments.listActive(TENANT_A, { stationId: stationId('station-2') }),
    ).resolves.toEqual([]);
    await expect(assignments.listActive(TENANT_A, {})).resolves.toHaveLength(2);
  });
});

async function makeStationAndTank(station: string, tank: string): Promise<void> {
  const { createMemoryRepositories } =
    await import('../src/adapters/memory/memory-repositories.js');
  const repos = createMemoryRepositories(store);
  await repos.stations.save(TENANT_A, makeStation({ id: stationId(station) }));
  await repos.tanks.save(TENANT_A, makeTank({ id: tankId(tank), stationId: stationId(station) }));
}
