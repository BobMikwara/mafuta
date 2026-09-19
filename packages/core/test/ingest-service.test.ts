import { beforeEach, describe, expect, it } from 'vitest';
import { IngestService } from '../src/services/ingest-service.js';
import { FleetService } from '../src/services/fleet-service.js';
import { createMemoryRepositories } from '../src/adapters/memory/memory-repositories.js';
import { createMemoryLogSink, createLogger } from '../src/logging/logger.js';
import { fixedClock, manualClock } from '../src/ports/clock.js';
import { ConflictError, NotFoundError, ValidationError } from '../src/errors.js';
import {
  createSiteSchema,
  createTankSchema,
  listTanksQuerySchema,
  parseInput,
} from '../src/validation/schemas.js';
import type { ProbeSample } from '../src/domain/normalize.js';
import { makeSite, makeTank, TENANT_A, TENANT_B } from './factories.js';

const NOW = fixedClock('2026-01-01T00:00:00.000Z');

function sample(overrides: Partial<ProbeSample> = {}): ProbeSample {
  return {
    tankId: makeTank().id,
    observedAt: '2026-01-01T00:00:00.000Z',
    levelMm: 2000,
    waterLevelMm: 5,
    temperatureC: 22,
    deviceId: 'probe-1',
    source: 'device',
    ...overrides,
  };
}

describe('ingest service', () => {
  let repositories: ReturnType<typeof createMemoryRepositories>;
  let sink: ReturnType<typeof createMemoryLogSink>;
  let ingest: IngestService;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    sink = createMemoryLogSink();
    ingest = new IngestService({ repositories, clock: NOW, logger: createLogger({ sink }) });
    await repositories.sites.save(TENANT_A, makeSite({ id: 'site-1' as never }));
    await repositories.tanks.save(TENANT_A, makeTank());
  });

  it('stores a normalized reading with computed volumes', async () => {
    const result = await ingest.ingest(TENANT_A, sample());
    expect(result.reading.quality).toBe('ok');
    expect(result.reading.grossVolumeLitres).toBeCloseTo(9817.48, 1);
    expect(result.reading.netVolumeLitres).toBeLessThan(result.reading.grossVolumeLitres);
    expect(result.reading.tenantId).toBe(TENANT_A);
  });

  it('flags a reading that reports more water than product as invalid', async () => {
    const result = await ingest.ingest(TENANT_A, sample({ levelMm: 100, waterLevelMm: 900 }));
    expect(result.reading.quality).toBe('invalid');
  });

  it('flags a reading above the geometric maximum as invalid', async () => {
    const result = await ingest.ingest(TENANT_A, sample({ levelMm: 9000 }));
    expect(result.reading.quality).toBe('invalid');
  });

  // 600 mm in the default test tank is about 15 percent of capacity, which is
  // below the 20 percent low level warning and above the 10 percent critical.
  it('raises a low level alarm and does not duplicate it on the next reading', async () => {
    const first = await ingest.ingest(TENANT_A, sample({ levelMm: 600 }));
    expect(first.raisedAlarms.map((alarm) => alarm.type)).toContain('low-level');

    const second = await ingest.ingest(
      TENANT_A,
      sample({ observedAt: '2026-01-01T00:01:00.000Z', levelMm: 599 }),
    );
    expect(second.raisedAlarms).toHaveLength(0);

    const open = await repositories.alarms.listOpenByTank(TENANT_A, makeTank().id);
    expect(open.filter((alarm) => alarm.type === 'low-level')).toHaveLength(1);
  });

  it('resolves an alarm once the condition clears', async () => {
    await ingest.ingest(TENANT_A, sample({ levelMm: 600 }));
    const resolved = await ingest.ingest(
      TENANT_A,
      sample({ observedAt: '2026-01-01T00:01:00.000Z', levelMm: 2000 }),
    );
    expect(resolved.resolvedAlarms.map((alarm) => alarm.type)).toContain('low-level');
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

  it('creates a site owned by the caller tenant', async () => {
    const site = await fleet.createSite(
      TENANT_A,
      parseInput(createSiteSchema, { name: 'Depot', timezone: 'Africa/Nairobi' }),
    );
    expect(site.tenantId).toBe(TENANT_A);
    expect(site.id).toContain('site-');
  });

  it('creates a tank only against a site owned by the same tenant', async () => {
    await expect(
      fleet.createTank(
        TENANT_A,
        parseInput(createTankSchema, {
          siteId: 'site-1',
          name: 'Diesel 1',
          product: 'diesel',
          geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
          capacityLitres: 19_000,
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await fleet.createSite(
      TENANT_A,
      parseInput(createSiteSchema, { id: 'site-1', name: 'Depot', timezone: 'Africa/Nairobi' }),
    );
    const tank = await fleet.createTank(
      TENANT_A,
      parseInput(createTankSchema, {
        siteId: 'site-1',
        name: 'Diesel 1',
        product: 'diesel',
        geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
        capacityLitres: 19_000,
      }),
    );
    expect(tank.tenantId).toBe(TENANT_A);
  });

  it('rejects a capacity larger than the declared geometry', async () => {
    await fleet.createSite(
      TENANT_A,
      parseInput(createSiteSchema, { id: 'site-1', name: 'Depot', timezone: 'Africa/Nairobi' }),
    );
    await expect(
      fleet.createTank(
        TENANT_A,
        parseInput(createTankSchema, {
          siteId: 'site-1',
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

  it('acknowledges an alarm and records an updated timestamp', async () => {
    await repositories.tanks.save(TENANT_A, makeTank());
    const ingest = new IngestService({ repositories, clock, logger: createLogger({ sink }) });
    const raised = await ingest.ingest(
      TENANT_A,
      sample({ levelMm: 300, observedAt: clock.now().toISOString() }),
    );
    const alarm = raised.raisedAlarms[0];
    if (alarm === undefined) {
      throw new Error('expected a low level alarm to be raised');
    }

    clock.advanceMilliseconds(60_000);
    const acknowledged = await fleet.acknowledgeAlarm(TENANT_A, alarm.id, 'operator reviewed');
    expect(acknowledged.status).toBe('acknowledged');
    expect(acknowledged.updatedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(acknowledged.message).toContain('operator reviewed');
  });

  it('refuses to acknowledge an alarm from another tenant', async () => {
    const other = await repositories.alarms.save(TENANT_B, {
      id: 'alm-b' as never,
      tenantId: TENANT_B,
      tankId: 'tank-b' as never,
      type: 'low-level',
      severity: 'warning',
      status: 'open',
      message: 'other tenant',
      raisedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      readingId: null,
      metrics: {},
    });
    await expect(fleet.acknowledgeAlarm(TENANT_A, other.id, undefined)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('ingest idempotency', () => {
  let repositories: ReturnType<typeof createMemoryRepositories>;
  let sink: ReturnType<typeof createMemoryLogSink>;
  let ingest: IngestService;

  beforeEach(async () => {
    repositories = createMemoryRepositories();
    sink = createMemoryLogSink();
    ingest = new IngestService({ repositories, clock: NOW, logger: createLogger({ sink }) });
    await repositories.sites.save(TENANT_A, makeSite({ id: 'site-1' as never }));
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

  it('does not re-raise alarms for a replayed submission', async () => {
    const first = await ingest.ingest(
      TENANT_A,
      sample({ levelMm: 500, waterLevelMm: 0, observedAt: '2026-01-01T00:00:00.000Z' }),
    );
    expect(first.raisedAlarms.length).toBeGreaterThan(0);

    const replay = await ingest.ingest(
      TENANT_A,
      sample({ levelMm: 500, waterLevelMm: 0, observedAt: '2026-01-01T00:00:00.000Z' }),
    );
    expect(replay.duplicate).toBe(true);
    expect(replay.raisedAlarms).toEqual([]);
    expect(await repositories.alarms.list(TENANT_A)).toHaveLength(first.raisedAlarms.length);
  });

  it('honours an explicit client supplied key', async () => {
    const first = await ingest.ingest(
      TENANT_A,
      sample({ idempotencyKey: 'client-key-0001', observedAt: '2026-01-01T00:00:00.000Z' }),
    );
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
    const first = await ingest.ingest(TENANT_A, sample({ deviceId: 'probe-1' }));
    const second = await ingest.ingest(TENANT_A, sample({ deviceId: 'probe-2' }));

    expect(second.duplicate).toBe(false);
    expect(second.reading.id).not.toBe(first.reading.id);
  });

  it('never lets one tenant reuse another tenant submission key', async () => {
    await repositories.sites.save(
      TENANT_B,
      makeSite({ id: 'site-1' as never, tenantId: TENANT_B }),
    );
    await repositories.tanks.save(TENANT_B, makeTank({ tenantId: TENANT_B }));

    const first = await ingest.ingest(TENANT_A, sample());
    const second = await ingest.ingest(TENANT_B, sample());

    expect(second.duplicate).toBe(false);
    expect(second.reading.id).not.toBe(first.reading.id);
    expect(second.reading.tenantId).toBe(TENANT_B);
  });

  it('rejects a direct append that collides with an existing key', async () => {
    const first = await ingest.ingest(TENANT_A, sample());
    await expect(
      repositories.readings.append(TENANT_A, {
        ...first.reading,
        id: 'rdg-different-id' as never,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('exposes the submission key on the stored reading', async () => {
    const result = await ingest.ingest(TENANT_A, sample());
    expect(result.reading.idempotencyKey).toMatch(/^idem_[0-9a-f]{48}$/);

    const stored = await repositories.readings.findByIdempotencyKey(
      TENANT_A,
      result.reading.idempotencyKey,
    );
    expect(stored?.id).toBe(result.reading.id);
  });

  it('logs a replay so the operator can see the device retried', async () => {
    await ingest.ingest(TENANT_A, sample());
    await ingest.ingest(TENANT_A, sample());
    expect(sink.records.map((entry) => entry.message)).toContain('reading.duplicate.ignored');
  });
});
