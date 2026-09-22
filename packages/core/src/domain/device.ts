import type { DeviceId, StationId, TankId, TenantId } from '../types/ids.js';

/**
 * Device lifecycle and connection state.
 *
 * A device is any telemetry source registered by a tenant: a probe, a gauge
 * head unit, a gateway, or a simulator. Nothing here encodes a vendor protocol;
 * protocol handling lives behind the adapter contract in
 * `ports/tank-gauge-adapter.ts` and `docs/hardware-adapter-contract.md`.
 */
export const DEVICE_PROTOCOLS = [
  'simulated',
  'http',
  'mqtt',
  'modbus_rtu',
  'modbus_tcp',
  'other',
] as const;
export type DeviceProtocol = (typeof DEVICE_PROTOCOLS)[number];

export type DeviceStatus = 'registered' | 'active' | 'maintenance' | 'retired';
export type DeviceConnectionState = 'online' | 'offline' | 'degraded';
export type AssignmentStatus = 'active' | 'ended';

export interface Device {
  readonly id: DeviceId;
  readonly tenantId: TenantId;
  readonly manufacturer: string;
  readonly model: string;
  readonly serialNumber: string;
  readonly protocol: DeviceProtocol;
  readonly firmwareVersion: string | null;
  readonly status: DeviceStatus;
  readonly connectionState: DeviceConnectionState;
  /** Last time the platform received anything from this device, UTC. */
  readonly lastSeenAt: string | null;
  /** Non-secret reference to the credential material held elsewhere. */
  readonly credentialRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Assignment history. A device is attached to at most one tank at a time;
 * ending an assignment writes `unassignedAt` instead of deleting the row, so
 * the history of which probe measured which tank is preserved (TRD section 4).
 */
export interface DeviceAssignment {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly tankId: TankId;
  readonly status: AssignmentStatus;
  readonly assignedAt: string;
  readonly unassignedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Default window after which a silent device is treated as offline. Invented
 * defaults are avoided: this is a platform constant, documented, and it is the
 * same value used by `/v1/devices` health and the device health report.
 */
export const DEFAULT_DEVICE_OFFLINE_MINUTES = 30;

export function isDeviceAssignable(device: Device): boolean {
  return device.status !== 'retired';
}

export function isAssignmentActive(assignment: DeviceAssignment): boolean {
  return assignment.status === 'active';
}

/** True when the device has not been heard from within `offlineAfterMinutes`. */
export function isDeviceOffline(
  device: Device,
  now: Date,
  offlineAfterMinutes: number = DEFAULT_DEVICE_OFFLINE_MINUTES,
): boolean {
  if (device.lastSeenAt === null) {
    return true;
  }
  const lastSeen = Date.parse(device.lastSeenAt);
  if (Number.isNaN(lastSeen)) {
    return true;
  }
  return now.getTime() - lastSeen > offlineAfterMinutes * 60_000;
}

/** Minutes since the device last reported, or null when it never has. */
export function minutesSinceLastSeen(device: Device, now: Date): number | null {
  if (device.lastSeenAt === null) {
    return null;
  }
  const lastSeen = Date.parse(device.lastSeenAt);
  if (Number.isNaN(lastSeen)) {
    return null;
  }
  return (now.getTime() - lastSeen) / 60_000;
}

/** A device with the tank it is currently assigned to, for list views. */
export interface DeviceWithAssignment {
  readonly device: Device;
  readonly stationId: StationId | null;
  readonly stationName: string | null;
  readonly tankId: TankId | null;
  readonly tankName: string | null;
  readonly assignmentId: string | null;
  readonly assignedAt: string | null;
}
