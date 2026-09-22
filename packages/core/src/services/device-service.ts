import {
  DEFAULT_DEVICE_OFFLINE_MINUTES,
  isDeviceAssignable,
  isDeviceOffline,
  minutesSinceLastSeen,
  type Device,
  type DeviceAssignment,
} from '../domain/device.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { Logger } from '../logging/logger.js';
import type { Clock } from '../ports/clock.js';
import type { RawMessageRecord, Repositories } from '../ports/repositories.js';
import { newId, type DeviceId, type StationId, type TankId, type TenantId } from '../types/ids.js';
import type { RegisterDeviceInput, UpdateDeviceInput } from '../validation/schemas.js';

/**
 * A device as the API returns it. Registration data plus the connection facts an
 * operator needs first: is it reachable, when was it last heard from, and which
 * tank it is attached to right now.
 */
export interface DeviceView {
  readonly device: Device;
  readonly online: boolean;
  /** Null when the device has never been heard from. */
  readonly minutesSinceLastSeen: number | null;
  readonly offlineAfterMinutes: number;
  readonly tankId: TankId | null;
  readonly tankName: string | null;
  readonly stationId: StationId | null;
  readonly stationName: string | null;
  readonly assignmentId: string | null;
  readonly assignedAt: string | null;
  /** Latest reading attributed to this device, UTC. */
  readonly lastReadingAt: string | null;
}

export interface DeviceDetail {
  readonly device: DeviceView;
  /** Full assignment history, newest first. Never deleted. */
  readonly assignmentHistory: ReadonlyArray<DeviceAssignment>;
  readonly rawMessageCount: number;
}

export interface DeviceServiceDependencies {
  readonly repositories: Repositories;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly offlineAfterMinutes?: number;
}

/**
 * Device and sensor management (PRD section 4).
 *
 * The platform never invents a vendor protocol: `protocol` is metadata that
 * describes how the device is reached, and payload interpretation lives behind
 * the adapter contract in `docs/hardware-adapter-contract.md`.
 */
export class DeviceService {
  private readonly repositories: Repositories;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly offlineAfterMinutes: number;

  constructor(dependencies: DeviceServiceDependencies) {
    this.repositories = dependencies.repositories;
    this.clock = dependencies.clock;
    this.logger = dependencies.logger;
    this.offlineAfterMinutes = dependencies.offlineAfterMinutes ?? DEFAULT_DEVICE_OFFLINE_MINUTES;
  }

  async register(tenantId: TenantId, input: RegisterDeviceInput): Promise<Device> {
    const existing = await this.repositories.devices.findBySerialNumber(
      tenantId,
      input.serialNumber,
    );
    if (existing !== null) {
      throw new ConflictError(
        `A device with serial number ${input.serialNumber} is already registered`,
      );
    }

    const now = this.clock.now().toISOString();
    const device: Device = {
      id: (input.id ?? newId('dev')) as DeviceId,
      tenantId,
      manufacturer: input.manufacturer,
      model: input.model,
      serialNumber: input.serialNumber,
      protocol: input.protocol,
      firmwareVersion: input.firmwareVersion ?? null,
      status: 'registered',
      connectionState: 'offline',
      lastSeenAt: null,
      credentialRef: input.credentialRef ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.repositories.devices.save(tenantId, device);
    this.logger.info('device.registered', {
      tenantId,
      deviceId: saved.id,
      // Manufacturer, model and protocol only. The serial number identifies
      // hardware and is not needed to make a registration auditable.
      protocol: saved.protocol,
      manufacturer: saved.manufacturer,
    });
    return saved;
  }

  async update(tenantId: TenantId, deviceId: DeviceId, input: UpdateDeviceInput): Promise<Device> {
    const device = await this.requireDevice(tenantId, deviceId);
    const updated: Device = {
      ...device,
      ...(input.manufacturer === undefined ? {} : { manufacturer: input.manufacturer }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.protocol === undefined ? {} : { protocol: input.protocol }),
      ...(input.firmwareVersion === undefined ? {} : { firmwareVersion: input.firmwareVersion }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.credentialRef === undefined ? {} : { credentialRef: input.credentialRef }),
      updatedAt: this.clock.now().toISOString(),
    };
    const saved = await this.repositories.devices.save(tenantId, updated);
    this.logger.info('device.updated', { tenantId, deviceId, status: saved.status });
    return saved;
  }

  async requireDevice(tenantId: TenantId, deviceId: DeviceId): Promise<Device> {
    const device = await this.repositories.devices.findById(tenantId, deviceId);
    if (device === null) {
      throw new NotFoundError('Device', deviceId);
    }
    return device;
  }

  /**
   * Attaches a device to a tank.
   *
   * A device can only usefully measure one tank at a time, so an existing active
   * assignment is ended rather than overwritten: the history of which probe
   * measured which tank has to survive, otherwise a past reading becomes
   * unattributable (TRD section 4).
   */
  async assignToTank(
    tenantId: TenantId,
    deviceId: DeviceId,
    tankId: TankId,
  ): Promise<DeviceAssignment> {
    const device = await this.requireDevice(tenantId, deviceId);
    if (!isDeviceAssignable(device)) {
      throw new ConflictError(
        `Device ${device.serialNumber} is retired and cannot be assigned to a tank`,
      );
    }

    const tank = await this.repositories.tanks.findById(tenantId, tankId);
    if (tank === null) {
      throw new NotFoundError('Tank', tankId);
    }
    if (tank.status !== 'active') {
      throw new ValidationError('Cannot assign a device to a decommissioned tank', [
        { path: 'tankId', message: 'tank is not active' },
      ]);
    }

    const now = this.clock.now().toISOString();
    const current = await this.repositories.assignments.findActiveByDevice(tenantId, deviceId);
    if (current !== null && current.tankId === tankId) {
      // Re-assigning the same pair is a no-op, so a retried request cannot
      // create a second active assignment.
      return current;
    }
    if (current !== null) {
      await this.repositories.assignments.end(tenantId, current.id, now);
    }

    const assignment: DeviceAssignment = {
      id: newId('asg'),
      tenantId,
      deviceId,
      tankId,
      status: 'active',
      assignedAt: now,
      unassignedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.repositories.assignments.save(tenantId, assignment);
    this.logger.info('device.assigned', {
      tenantId,
      deviceId,
      tankId,
      assignmentId: saved.id,
      replaced: current === null ? null : current.id,
    });
    return saved;
  }

  /** Ends the active assignment of a device. Fails when there is nothing to end. */
  async unassign(tenantId: TenantId, deviceId: DeviceId): Promise<DeviceAssignment> {
    const device = await this.requireDevice(tenantId, deviceId);
    const current = await this.repositories.assignments.findActiveByDevice(tenantId, deviceId);
    if (current === null) {
      throw new NotFoundError('Active assignment for device', device.id);
    }
    const ended = await this.repositories.assignments.end(
      tenantId,
      current.id,
      this.clock.now().toISOString(),
    );
    this.logger.info('device.unassigned', {
      tenantId,
      deviceId,
      tankId: ended.tankId,
      assignmentId: ended.id,
    });
    return ended;
  }

  async list(
    tenantId: TenantId,
    query: {
      stationId?: StationId | undefined;
      tankId?: TankId | undefined;
      status?: Device['status'] | undefined;
      limit?: number | undefined;
    } = {},
  ): Promise<ReadonlyArray<DeviceView>> {
    const devices = await this.repositories.devices.list(tenantId, {
      ...(query.stationId === undefined ? {} : { stationId: query.stationId }),
      ...(query.tankId === undefined ? {} : { tankId: query.tankId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    const views: DeviceView[] = [];
    for (const device of devices) {
      views.push(await this.toView(tenantId, device));
    }
    return views;
  }

  async detail(tenantId: TenantId, deviceId: DeviceId): Promise<DeviceDetail> {
    const device = await this.requireDevice(tenantId, deviceId);
    const history = await this.repositories.assignments.listByDevice(tenantId, deviceId);
    const rawMessages = await this.repositories.rawMessages.listByDevice(tenantId, deviceId, 1);
    return {
      device: await this.toView(tenantId, device),
      assignmentHistory: history,
      // Best effort and capped: a device may have stored millions of payloads,
      // and this number is informational rather than authoritative.
      rawMessageCount:
        rawMessages.length === 0 ? 0 : await this.countRawMessages(tenantId, deviceId),
    };
  }

  /**
   * Offline devices first, then the longest silent, so the list is usable as a
   * maintenance work queue rather than only as an inventory.
   */
  async health(tenantId: TenantId, stationId?: StationId): Promise<ReadonlyArray<DeviceView>> {
    const views = await this.list(tenantId, {
      ...(stationId === undefined ? {} : { stationId }),
      limit: 500,
    });
    return [...views].sort((left, right) => {
      if (left.online !== right.online) {
        return left.online ? 1 : -1;
      }
      const leftSilent = left.minutesSinceLastSeen ?? Number.POSITIVE_INFINITY;
      const rightSilent = right.minutesSinceLastSeen ?? Number.POSITIVE_INFINITY;
      return rightSilent - leftSilent;
    });
  }

  /**
   * Retained raw payloads for a device. These are the least processed data the
   * platform holds, so callers must hold the `raw:read` scope and every read is
   * audited by the API layer.
   */
  async rawMessages(
    tenantId: TenantId,
    deviceId: DeviceId,
    limit = 20,
  ): Promise<ReadonlyArray<RawMessageRecord>> {
    await this.requireDevice(tenantId, deviceId);
    return this.repositories.rawMessages.listByDevice(tenantId, deviceId, limit);
  }

  /**
   * Records that a device was heard from. Called by ingestion with the moment
   * the platform received the sample, so the value is the same one stored on the
   * reading rather than a second clock read.
   */
  async markSeen(tenantId: TenantId, deviceId: DeviceId, seenAt?: string): Promise<void> {
    await this.repositories.devices.touch(
      tenantId,
      deviceId,
      seenAt ?? this.clock.now().toISOString(),
      'online',
    );
  }

  /**
   * Registers the device behind a simulated reading on first use.
   *
   * Only the ingestion path calls this, and only for readings the caller already
   * proved it may label as simulated. The device is registered with the
   * `simulated` protocol so a reviewer can always tell synthetic data from
   * hardware data.
   */
  async registerSimulated(tenantId: TenantId, deviceId: DeviceId): Promise<Device> {
    const now = this.clock.now().toISOString();
    const device: Device = {
      id: deviceId,
      tenantId,
      manufacturer: 'FuelTrack',
      model: 'development-simulator',
      serialNumber: String(deviceId),
      protocol: 'simulated',
      firmwareVersion: null,
      status: 'active',
      connectionState: 'online',
      lastSeenAt: null,
      credentialRef: null,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.repositories.devices.save(tenantId, device);
    this.logger.info('device.simulated_registered', { tenantId, deviceId: saved.id });
    return saved;
  }

  /** Writes the view for one device. Kept private so both list and detail agree. */
  private async toView(tenantId: TenantId, device: Device): Promise<DeviceView> {
    const now = this.clock.now();
    const assignment = await this.repositories.assignments.findActiveByDevice(tenantId, device.id);
    const tank =
      assignment === null
        ? null
        : await this.repositories.tanks.findById(tenantId, assignment.tankId);
    const station =
      tank === null ? null : await this.repositories.stations.findById(tenantId, tank.stationId);
    return {
      device,
      online: !isDeviceOffline(device, now, this.offlineAfterMinutes),
      minutesSinceLastSeen: minutesSinceLastSeen(device, now),
      offlineAfterMinutes: this.offlineAfterMinutes,
      tankId: tank?.id ?? null,
      tankName: tank?.name ?? null,
      stationId: station?.id ?? null,
      stationName: station?.name ?? null,
      assignmentId: assignment?.id ?? null,
      assignedAt: assignment?.assignedAt ?? null,
      lastReadingAt: device.lastSeenAt,
    };
  }

  private async countRawMessages(tenantId: TenantId, deviceId: DeviceId): Promise<number> {
    // The repository API lists rather than counts: a device with a very large
    // history is not worth an unbounded query on a detail page, so this reports
    // a bounded figure instead of an exact one.
    const page = await this.repositories.rawMessages.listByDevice(tenantId, deviceId, 500);
    return page.length === 500 ? 500 : page.length;
  }
}
