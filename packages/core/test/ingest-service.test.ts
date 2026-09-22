import { beforeEach, describe, expect, it } from 'vitest';
import { IngestService } from '../src/services/ingest-service.js';
import { FleetService } from '../src/services/fleet-service.js';
import { DeviceService } from '../src/services/device-service.js';
import { createMemoryRepositories } from '../src/adapters/memory/memory-repositories.js';
import { createMemoryLogSink, createLogger } from '../src/logging/logger.js';
import { fixedClock, manualClock } from '../src/ports/clock.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/errors.js';
import {
  createStationSchema,
  createTankSchema,
  listTanksQuerySchema,
  parseInput,
} from '../src/validation/schemas.js';
import type { ProbeSample } from '../src/domain/normalize.js';
import { makeAlert, makeStation, makeTank, TENANT_A, TENANT_B } from './factories.js';

const NOW = fixedClock('2026-01-01T00:00:00.000Z');

function sample(overrides: Partial<ProbeSample> = {}): ProbeSample {
  return {
    tankId: makeTank().id,
    observedAt: '2026-01-01T00:00:00.000Z',
    levelMm: 2000,
    waterLevelMm: 5,
    temperatureC: 22,
    deviceId: null,
    source: 'manual',
    ...overrides,
  };
}

/** A registered device, assigned to the tank, so device readings are accepted. */
async function registerAssignedDevice(devices: DeviceService) {
  const device = await devices.register(TENANT_A, {
    manufacturer: 'Acme',
    model: 'Probe 3000',
    serialNumber: 'SN-0001',
    protocol: 'http',
  });
  await devices.assignToTank(TENANT_A, device.id, makeTank().id);
  return device;
}

describe('ingest service', () => {
  let repositories: ReturnType<typeof createMemoryRepositories>;
  let sink: ReturnType<typeof createMemoryLogSink>;
  let devices: DeviceService;
  let ingest: IngestService;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    sink = createMemoryLogSink();
    const logger = createLogger({ sink });
    devices = new DeviceService({ repositories, clock: NOW, logger });
    ingest = new IngestService({ repositories, clock: NOW, logger, deviceService: devices });
    await repositories.stations.save(TENANT_A, makeStation());
    await repositories.tanks.save(TENANT_A, makeTank());
  });

  it('stores a normalized reading with computed volumes and provenance', async () => {
    const result = await ingest.ingest(TENANT_A, sample());

    expect(result.reading.quality).toBe('ok');
    expect(result.reading.provenance).toBe('manual');
    expect(result.reading.sourceProtocol).toBe('manual');
    expect(result.reading.grossVolumeLitres).toBeCloseTo(9817.48, 1);
    expect(result.reading.netVolumeLitres).toBeLessThan(result.reading.grossVolumeLitres);
    expect(result.reading.tenantId).toBe(TENANT_A);
    expect(result.duplicate).toBe(false);
  });

  it('flags a reading that reports more water than product as invalid', async () => {
    const result = await ingest.ingest(TENANT_A, sample({ levelMm: 100, waterLevelMm: 900 }));
    expect(result.reading.quality).toBe('invalid');
    expect(result.reading.qualityReason).toContain('water');
  });

  it('flags a reading above the geometric maximum as invalid', async () => {
    const result = await ingest.ingest(TENANT_A, sample({ levelMm: 9000 }));
    expect(result.reading.quality).toBe('invalid');
  });

  it('refuses a hardware reading from a device that is not registered', async () => {
    await expect(
      ingest.ingest(TENANT_A, sample({ source: 'device', deviceId: 'probe-unknown' as never })),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses a device reading for a tank the device is not assigned to', async () => {
    const device = await devices.register(TENANT_A, {
      manufacturer: 'Acme',
      model: 'Probe 3000',
      serialNumber: 'SN-UNASSIGNED',
      protocol: 'http',
    });

    await expect(
      ingest.ingest(TENANT_A, sample({ source: 'device', deviceId: device.id })),
    ).rejects.toThrow(ForbiddenError);
  });

  it('registers and assigns a simulated device on first use', async () => {
    const result = await ingest.ingest(
      TENANT_A,
      sample({ source: 'simulated', deviceId: 'sim-tank-1' as never }),
    );

    expect(result.reading.source).toBe('simulated');
    expect(result.reading.deviceId).toBe('sim-tank-1');
    const devicesForTenant = await devices.list(TENANT_A);
    expect(devicesForTenant.map((view) => view.device.id)).toContain('sim-tank-1');
    expect(devicesForTenant[0]?.tankId).toBe(makeTank().id);
    // A simulated device is stored with the `simulated` protocol so synthetic
    // data can never be mistaken for hardware data later.
    expect(devicesForTenant[0]?.device.protocol).toBe('simulated');
  });

  it('accepts a device reading once the device is assigned to the tank', async () => {
    const device = await registerAssignedDevice(devices);
    const result = await ingest.ingest(
      TENANT_A,
      sample({ source: 'device', deviceId: device.id, signalQualityPercent: 90 }),
    );

    expect(result.reading.quality).toBe('ok');
    expect(result.reading.provenance).toBe('measured');
    const seen = await repositories.devices.findById(TENANT_A, device.id);
    expect(seen?.lastSeenAt).not.toBeNull();
    expect(seen?.status).toBe('active');
  });

  it('rejects a reading whose timestamp is far in the future', async () => {
    await expect(
      ingest.ingest(TENANT_A, sample({ observedAt: '2026-01-01T06:00:00.000Z' })),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses readings for a tank belonging to another tenant', async () => {
    await expect(ingest.ingest(TENANT_B, sample())).rejects.toThrow(NotFoundError);
  });

  it('refuses readings for a decommissioned tank', async () => {
    const decommissioned = makeTank({ id: 'tank-off' as never, status: 'decommissioned' });
    await repositories.tanks.save(TENANT_A, decommissioned);
    await expect(ingest.ingest(TENANT_A, sample({ tankId: decommissioned.id }))).rejects.toThrow(
      ConflictError,
    );
  });

  it('logs each ingestion with tenant and tank context', async () => {
    await ingest.ingest(TENANT_A, sample());
    const records = sink.records.filter((record) => record.message === 'reading.ingested');
    expect(records).toHaveLength(1);
    expect(records[0]?.context['tenantId']).toBe(TENANT_A);
    expect(records[0]?.context['quality']).toBe('ok');
  });

  it('does not emit sensitive data into logs', async () => {
    await ingest.ingest(TENANT_A, sample());
    const serialised = JSON.stringify(sink.records);
    expect(serialised).not.toContain('password');
    expect(serialised).not.toContain('apiKey');
  });

  it('retains the raw payload and links it to the reading', async () => {
    const result = await ingest.ingest(TENANT_A, sample(), {
      rawPayload: { vendorFrame: 'AA:BB:CC', levelMm: 2000 },
    });

    expect(result.reading.rawMessageId).not.toBeNull();
    const raw = await repositories.rawMessages.findById(
      TENANT_A,
      result.reading.rawMessageId as never,
    );
    expect(raw?.payload).toEqual({ vendorFrame: 'AA:BB:CC', levelMm: 2000 });
  });
});

describe('ingest alerting', () => {
  let repositories: ReturnType<typeof createMemoryRepositories>;
  let ingest: IngestService;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    ingest = new IngestService({
      repositories,
      clock: NOW,
      logger: createLogger({ sink: createMemoryLogSink() }),
    });
    await repositories.stations.save(TENANT_A, makeStation());
    await repositories.tanks.save(TENANT_A, makeTank());
  });

  // 600 mm of the default test tank is about 15 percent of usable capacity:
  // below the 20 percent low warning and above the 10 percent critical.
  it('raises a low stock alert and does not duplicate it on the next reading', async () => {
    const first = await ingest.ingest(TENANT_A, sample({ levelMm: 600 }));
    expect(first.raisedAlerts.map((alert) => alert.type)).toContain('low_stock');

    const second = await ingest.ingest(
      TENANT_A,
      sample({ observedAt: '2026-01-01T00:01:00.000Z', levelMm: 599 }),
    );
    expect(second.raisedAlerts).toHaveLength(0);

    const open = await repositories.alerts.listOpenByTank(TENANT_A, makeTank().id);
    expect(open.filter((alert) => alert.type === 'low_stock')).toHaveLength(1);
  });

  it('raises a critical stock alert at or below the critical threshold', async () => {
    const result = await ingest.ingest(TENANT_A, sample({ levelMm: 300 }));
    const types = result.raisedAlerts.map((alert) => alert.type);
    expect(types).toContain('critical_stock');
    expect(result.raisedAlerts.find((alert) => alert.type === 'critical_stock')?.severity).toBe(
      'critical',
    );
  });

  it('resolves a stock alert once the condition clears', async () => {
    await ingest.ingest(TENANT_A, sample({ levelMm: 600 }));
    const resolved = await ingest.ingest(
      TENANT_A,
      sample({ observedAt: '2026-01-01T00:01:00.000Z', levelMm: 2000 }),
    );
    expect(resolved.resolvedAlerts.map((alert) => alert.type)).toContain('low_stock');
  });

  it('raises a water alert when the water level crosses the configured threshold', async () => {
    const result = await ingest.ingest(TENANT_A, sample({ levelMm: 2000, waterLevelMm: 120 }));
    expect(result.raisedAlerts.map((alert) => alert.type)).toContain('water_level');
  });
});

describe('ingest event detection', () => {
  let repositories: ReturnType<typeof createMemoryRepositories>;
  let ingest: IngestService;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    ingest = new IngestService({
      repositories,
      clock: manualClock('2026-01-01T00:30:00.000Z'),
      logger: createLogger({ sink: createMemoryLogSink() }),
    });
    await repositories.stations.save(TENANT_A, makeStation());
    await repositories.tanks.save(TENANT_A, makeTank());
  });

  it('records a candidate delivery for a sustained rise, without labelling it a delivery', async () => {
    await ingest.ingest(TENANT_A, sample({ observedAt: '2026-01-01T00:00:00.000Z', levelMm: 500 }));
    const result = await ingest.ingest(
      TENANT_A,
      sample({ observedAt: '2026-01-01T00:20:00.000Z', levelMm: 1500 }),
    );

    expect(result.raisedEvents).toHaveLength(1);
    const event = result.raisedEvents[0];
    expect(event?.type).toBe('candidate_delivery');
    expect(event?.status).toBe('candidate');
    expect(event?.evidence.possibleExplanations.length).toBeGreaterThan(0);
    expect(event?.evidence.investigationRequired).toBe(true);
    // The wording must never assert what the movement was.
    expect(event?.evidence.rule.toLowerCase()).not.toContain('theft');
    // The candidate stays visible in the alert list until a person decides.
    expect(result.raisedAlerts.map((alert) => alert.type)).toContain('candidate_delivery');
  });

  it('records a candidate unexplained decrease for a fast loss', async () => {
    await ingest.ingest(
      TENANT_A,
      sample({ observedAt: '2026-01-01T00:00:00.000Z', levelMm: 3000 }),
    );
    const result = await ingest.ingest(
      TENANT_A,
      sample({ observedAt: '2026-01-01T00:10:00.000Z', levelMm: 2500 }),
    );

    const event = result.raisedEvents.find(
      (candidate) => candidate.type === 'candidate_unexplained_decrease',
    );
    expect(event).toBeDefined();
    expect(event?.evidence.possibleExplanations.join(' ').toLowerCase()).not.toContain('theft');
    expect(event?.volumeChangeMl).toBeLessThan(0);
  });
});

describe('fleet service', () => {
  let repositories: ReturnType<typeof createMemoryRepositories>;
  let sink: ReturnType<typeof createMemoryLogSink>;
  let fleet: FleetService;
  let clock: ReturnType<typeof manualClock>;

  beforeEach(() => {
    repositories = createMemoryRepositories();
    sink = createMemoryLogSink();
    clock = manualClock('2026-01-01T00:00:00.000Z');
    fleet = new FleetService({ repositories, clock, logger: createLogger({ sink }) });
  });

  it('creates a station owned by the caller tenant', async () => {
    const station = await fleet.createStation(
      TENANT_A,
      parseInput(createStationSchema, { name: 'Depot', code: 'dep-1', timezone: 'Africa/Nairobi' }),
    );
    expect(station.tenantId).toBe(TENANT_A);
    expect(station.id).toContain('stn-');
    expect(station.code).toBe('DEP-1');
  });

  it('rejects a duplicate station code within a tenant', async () => {
    await fleet.createStation(
      TENANT_A,
      parseInput(createStationSchema, { name: 'Depot', code: 'dep-1' }),
    );
    await expect(
      fleet.createStation(
        TENANT_A,
        parseInput(createStationSchema, { name: 'Other', code: 'DEP-1' }),
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('creates a tank only against a station owned by the same tenant', async () => {
    await expect(
      fleet.createTank(
        TENANT_A,
        parseInput(createTankSchema, {
          stationId: 'station-1',
          name: 'Diesel 1',
          product: 'diesel',
          geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
          capacityLitres: 19_000,
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await fleet.createStation(
      TENANT_A,
      parseInput(createStationSchema, { id: 'station-1', name: 'Depot', code: 'dep-1' }),
    );
    const tank = await fleet.createTank(
      TENANT_A,
      parseInput(createTankSchema, {
        stationId: 'station-1',
        name: 'Diesel 1',
        product: 'diesel',
        geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
        capacityLitres: 19_000,
      }),
    );
    expect(tank.tenantId).toBe(TENANT_A);
  });

  it('rejects a capacity larger than the declared geometry', async () => {
    await fleet.createStation(
      TENANT_A,
      parseInput(createStationSchema, { id: 'station-1', name: 'Depot', code: 'dep-1' }),
    );
    await expect(
      fleet.createTank(
        TENANT_A,
        parseInput(createTankSchema, {
          stationId: 'station-1',
          name: 'Diesel 1',
          product: 'diesel',
          geometry: { kind: 'vertical-cylinder', diameterMm: 1000, heightMm: 1000 },
          capacityLitres: 100_000,
        }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('lists only the caller tenant tanks', async () => {
    await repositories.tanks.save(
      TENANT_A,
      makeTank({ id: 'tank-a' as never, tenantId: TENANT_A }),
    );
    await repositories.tanks.save(
      TENANT_B,
      makeTank({ id: 'tank-b' as never, tenantId: TENANT_B }),
    );

    const forA = await fleet.listTanks(TENANT_A, parseInput(listTanksQuerySchema, {}));
    expect(forA.map((tank) => tank.id)).toEqual(['tank-a']);
  });

  it('acknowledges an alert and records the note and timestamp', async () => {
    await repositories.tanks.save(TENANT_A, makeTank());
    const ingest = new IngestService({
      repositories,
      clock,
      logger: createLogger({ sink }),
    });
    const raised = await ingest.ingest(
      TENANT_A,
      sample({ levelMm: 300, observedAt: clock.now().toISOString() }),
    );
    const alert = raised.raisedAlerts[0];
    if (alert === undefined) {
      throw new Error('expected a low stock alert to be raised');
    }

    clock.advanceMilliseconds(60_000);
    const acknowledged = await fleet.acknowledgeAlert(TENANT_A, alert.id, {
      actor: 'key:test',
      note: 'operator reviewed',
    });
    expect(acknowledged.status).toBe('acknowledged');
    expect(acknowledged.updatedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(acknowledged.message).toContain('operator reviewed');
  });

  it('refuses to acknowledge an alert from another tenant', async () => {
    const other = await repositories.alerts.save(
      TENANT_B,
      makeAlert({ id: 'alt-b' as never, tenantId: TENANT_B }),
    );
    await expect(fleet.acknowledgeAlert(TENANT_A, other.id, { actor: 'key:test' })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('ingest idempotency', () => {
  let repositories: ReturnType<typeof createMemoryRepositories>;
  let devices: DeviceService;
  let ingest: IngestService;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    const logger = createLogger({ sink: createMemoryLogSink() });
    devices = new DeviceService({ repositories, clock: NOW, logger });
    ingest = new IngestService({ repositories, clock: NOW, logger, deviceService: devices });
    await repositories.stations.save(TENANT_A, makeStation());
    await repositories.tanks.save(TENANT_A, makeTank());
  });

  it('returns the original reading when the same observation is submitted twice', async () => {
    const first = await ingest.ingest(TENANT_A, sample());
    const second = await ingest.ingest(TENANT_A, sample());

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.reading.id).toBe(first.reading.id);
    expect(await repositories.readings.list(TENANT_A, { tankId: makeTank().id })).toHaveLength(1);
  });

  it('does not re-raise alerts for a replayed submission', async () => {
    const first = await ingest.ingest(TENANT_A, sample({ levelMm: 500, waterLevelMm: 0 }));
    expect(first.raisedAlerts.length).toBeGreaterThan(0);

    const replay = await ingest.ingest(TENANT_A, sample({ levelMm: 500, waterLevelMm: 0 }));
    expect(replay.duplicate).toBe(true);
    expect(replay.raisedAlerts).toEqual([]);
    expect(await repositories.alerts.list(TENANT_A)).toHaveLength(first.raisedAlerts.length);
  });

  it('honours an explicit client supplied key', async () => {
    const first = await ingest.ingest(TENANT_A, sample({ idempotencyKey: 'client-key-0001' }));
    // A different instant with the same client key is still the same submission.
    const second = await ingest.ingest(
      TENANT_A,
      sample({ idempotencyKey: 'client-key-0001', observedAt: '2026-01-01T00:09:00.000Z' }),
    );

    expect(first.reading.idempotencyKey).toBe('client-key-0001');
    expect(second.duplicate).toBe(true);
    expect(second.reading.id).toBe(first.reading.id);
  });

  it('stores a distinct reading when the observation genuinely differs', async () => {
    const first = await ingest.ingest(TENANT_A, sample({ observedAt: '2026-01-01T00:00:00.000Z' }));
    const second = await ingest.ingest(
      TENANT_A,
      sample({ observedAt: '2026-01-01T00:05:00.000Z' }),
    );

    expect(second.duplicate).toBe(false);
    expect(second.reading.id).not.toBe(first.reading.id);
    expect(second.reading.idempotencyKey).not.toBe(first.reading.idempotencyKey);
  });

  it('does not collapse the same observation across two devices', async () => {
    const first = await registerAssignedDevice(devices);
    const second = await devices.register(TENANT_A, {
      manufacturer: 'Acme',
      model: 'Probe 3000',
      serialNumber: 'SN-0002',
      protocol: 'http',
    });
    await devices.assignToTank(TENANT_A, second.id, makeTank().id);

    const readingA = await ingest.ingest(
      TENANT_A,
      sample({ source: 'device', deviceId: first.id }),
    );
    const readingB = await ingest.ingest(
      TENANT_A,
      sample({ source: 'device', deviceId: second.id }),
    );

    expect(readingB.duplicate).toBe(false);
    expect(readingB.reading.id).not.toBe(readingA.reading.id);
  });

  it('never lets one tenant reuse another tenant submission key', async () => {
    await repositories.stations.save(TENANT_B, makeStation({ tenantId: TENANT_B }));
    await repositories.tanks.save(TENANT_B, makeTank({ tenantId: TENANT_B }));

    const first = await ingest.ingest(TENANT_A, sample());
    const second = await ingest.ingest(TENANT_B, sample());

    expect(second.duplicate).toBe(false);
    expect(second.reading.id).not.toBe(first.reading.id);
    expect(second.reading.tenantId).toBe(TENANT_B);
  });

  it('exposes the stored device on the reading', async () => {
    const device = await registerAssignedDevice(devices);
    const result = await ingest.ingest(TENANT_A, sample({ source: 'device', deviceId: device.id }));
    expect(result.reading.deviceId).toBe(device.id);
    expect(result.reading.sourceProtocol).toBe('http');
  });

  it('keeps a decommissioned device out of the ledger', async () => {
    const device = await devices.register(TENANT_A, {
      manufacturer: 'Acme',
      model: 'Probe 3000',
      serialNumber: 'SN-RETIRED',
      protocol: 'http',
    });
    await devices.assignToTank(TENANT_A, device.id, makeTank().id);
    await devices.update(TENANT_A, device.id, { status: 'retired' });

    await expect(
      ingest.ingest(TENANT_A, sample({ source: 'device', deviceId: device.id })),
    ).rejects.toThrow(ConflictError);
    expect(await repositories.readings.latest(TENANT_A, makeTank().id)).toBeNull();
  });
});
