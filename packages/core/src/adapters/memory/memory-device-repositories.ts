import {
  clampLimit,
  type DeviceAssignmentRepository,
  type DeviceQuery,
  type DeviceRepository,
} from '../../ports/repositories.js';
import {
  isAssignmentActive,
  type AssignmentStatus,
  type Device,
  type DeviceAssignment,
} from '../../domain/device.js';
import { assertOwnedByTenant } from '../../tenancy/guard.js';
import type { DeviceId, StationId, TankId, TenantId } from '../../types/ids.js';
import { cloneEntity, scopedKey, type MemoryStore } from './memory-store.js';

export function createMemoryDeviceRepository(store: MemoryStore): DeviceRepository {
  return {
    async save(tenantId: TenantId, device: Device): Promise<Device> {
      assertOwnedByTenant(tenantId, device, 'devices.save');
      const stored = cloneEntity(device);
      store.devices.set(scopedKey(tenantId, device.id), stored);
      return cloneEntity(stored);
    },
    async findById(tenantId: TenantId, id: DeviceId): Promise<Device | null> {
      const device = store.devices.get(scopedKey(tenantId, id));
      return device === undefined ? null : cloneEntity(device);
    },
    async findBySerialNumber(tenantId: TenantId, serialNumber: string): Promise<Device | null> {
      for (const device of store.devices.values()) {
        if (device.tenantId === tenantId && device.serialNumber === serialNumber) {
          return cloneEntity(device);
        }
      }
      return null;
    },
    async list(tenantId: TenantId, query: DeviceQuery = {}): Promise<ReadonlyArray<Device>> {
      const tankId = query.tankId;
      const stationId = query.stationId;
      const devices = [...store.devices.values()]
        .filter((device) => device.tenantId === tenantId)
        .filter((device) => query.status === undefined || device.status === query.status)
        .filter((device) => {
          if (tankId === undefined && stationId === undefined) {
            return true;
          }
          return [...store.assignments.values()].some((assignment) => {
            if (assignment.tenantId !== tenantId) return false;
            if (assignment.deviceId !== device.id) return false;
            if (!isAssignmentActive(assignment)) return false;
            if (tankId !== undefined) {
              return assignment.tankId === tankId;
            }
            const tank = store.tanks.get(scopedKey(tenantId, assignment.tankId));
            return tank !== undefined && tank.stationId === stationId;
          });
        })
        .sort((left, right) => left.serialNumber.localeCompare(right.serialNumber));
      return devices.slice(0, clampLimit(query.limit)).map(cloneEntity);
    },
    async touch(
      tenantId: TenantId,
      id: DeviceId,
      seenAt: string,
      connectionState: Device['connectionState'],
    ): Promise<void> {
      const key = scopedKey(tenantId, id);
      const existing = store.devices.get(key);
      if (existing === undefined) {
        return;
      }
      store.devices.set(key, {
        ...existing,
        lastSeenAt: seenAt,
        connectionState,
        status: existing.status === 'registered' ? 'active' : existing.status,
        updatedAt: seenAt,
      });
    },
  };
}

export function createMemoryDeviceAssignmentRepository(
  store: MemoryStore,
): DeviceAssignmentRepository {
  function tenantAssignments(tenantId: TenantId): Array<DeviceAssignment> {
    return [...store.assignments.values()]
      .filter((assignment) => assignment.tenantId === tenantId)
      .sort((left, right) => Date.parse(right.assignedAt) - Date.parse(left.assignedAt));
  }

  return {
    async save(tenantId: TenantId, assignment: DeviceAssignment): Promise<DeviceAssignment> {
      assertOwnedByTenant(tenantId, assignment, 'assignments.save');
      const stored = cloneEntity(assignment);
      store.assignments.set(scopedKey(tenantId, assignment.id), stored);
      return cloneEntity(stored);
    },
    async findById(tenantId: TenantId, assignmentId: string): Promise<DeviceAssignment | null> {
      const assignment = store.assignments.get(scopedKey(tenantId, assignmentId));
      return assignment === undefined ? null : cloneEntity(assignment);
    },
    async findActiveByDevice(
      tenantId: TenantId,
      deviceId: DeviceId,
    ): Promise<DeviceAssignment | null> {
      const active = tenantAssignments(tenantId).find(
        (assignment) => assignment.deviceId === deviceId && isAssignmentActive(assignment),
      );
      return active === undefined ? null : cloneEntity(active);
    },
    async listActiveByTank(
      tenantId: TenantId,
      tankId: TankId,
    ): Promise<ReadonlyArray<DeviceAssignment>> {
      return tenantAssignments(tenantId)
        .filter((assignment) => assignment.tankId === tankId && isAssignmentActive(assignment))
        .map(cloneEntity);
    },
    async listByTank(
      tenantId: TenantId,
      tankId: TankId,
      status?: AssignmentStatus,
    ): Promise<ReadonlyArray<DeviceAssignment>> {
      return tenantAssignments(tenantId)
        .filter((assignment) => assignment.tankId === tankId)
        .filter((assignment) => status === undefined || assignment.status === status)
        .map(cloneEntity);
    },
    async listByDevice(
      tenantId: TenantId,
      deviceId: DeviceId,
    ): Promise<ReadonlyArray<DeviceAssignment>> {
      return tenantAssignments(tenantId)
        .filter((assignment) => assignment.deviceId === deviceId)
        .map(cloneEntity);
    },
    async listActive(
      tenantId: TenantId,
      query: { stationId?: StationId } = {},
    ): Promise<ReadonlyArray<DeviceAssignment>> {
      return tenantAssignments(tenantId)
        .filter((assignment) => isAssignmentActive(assignment))
        .filter((assignment) => {
          if (query.stationId === undefined) return true;
          const tank = store.tanks.get(scopedKey(tenantId, assignment.tankId));
          return tank !== undefined && tank.stationId === query.stationId;
        })
        .map(cloneEntity);
    },
    async end(
      tenantId: TenantId,
      assignmentId: string,
      endedAt: string,
    ): Promise<DeviceAssignment> {
      const key = scopedKey(tenantId, assignmentId);
      const existing = store.assignments.get(key);
      if (existing === undefined) {
        throw new Error(`Assignment ${assignmentId} does not exist`);
      }
      const updated: DeviceAssignment = {
        ...existing,
        status: 'ended',
        unassignedAt: endedAt,
        updatedAt: endedAt,
      };
      store.assignments.set(key, updated);
      return cloneEntity(updated);
    },
  };
}
