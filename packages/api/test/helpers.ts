import {
  API_KEY_SCOPES,
  createSilentLogger,
  manualClock,
  toTenantId,
  type ApiKeyScope,
  type RateLimiter,
} from '@fueltrack/core';
import { buildServer } from '../src/server.js';
import {
  createPlatformDependencies,
  type PlatformDependencies,
} from '../src/dependency-factory.js';

export const TENANT_A = toTenantId('tenant-a');
export const TENANT_B = toTenantId('tenant-b');

export const ALL_SCOPES: ReadonlyArray<ApiKeyScope> = [...API_KEY_SCOPES];

/**
 * Scopes a field device credential would hold: it may submit readings and read
 * the tank it is attached to, and nothing else.
 */
export const DEVICE_SCOPES: ReadonlyArray<ApiKeyScope> = [
  'readings:read',
  'readings:write',
  'tanks:read',
];

/** Scopes of a read-only operator: dashboards and reports, no writes. */
export const READONLY_SCOPES: ReadonlyArray<ApiKeyScope> = [
  'stations:read',
  'tanks:read',
  'readings:read',
  'alerts:read',
  'events:read',
  'devices:read',
  'deliveries:read',
  'dashboard:read',
  'reports:read',
];

export interface HarnessOptions {
  readonly requestLogging?: boolean;
  /** Overrides the ingestion throttle. `null` disables it. */
  readonly ingestionLimiter?: RateLimiter | null;
  /** Overrides the per-credential throttle. `null` disables it. */
  readonly apiLimiter?: RateLimiter | null;
  /** Throttles authentication *failures* per client address. */
  readonly authLimiter?: RateLimiter | null;
}

export interface TestHarness {
  readonly deps: PlatformDependencies;
  readonly app: Awaited<ReturnType<typeof buildServer>>;
  readonly keyForTenantA: string;
  readonly keyForTenantB: string;
  readonly keyForTenantAReadonly: string;
  close(): Promise<void>;
}

export async function createHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  const deps = createPlatformDependencies({
    logger: createSilentLogger(),
    clock: manualClock('2026-01-01T00:00:00.000Z'),
  });
  const app = await buildServer(deps, {
    // The background sweep is disabled in tests: a timer would fire between
    // assertions and change alert state underneath them.
    alertSweepIntervalMs: 0,
    ...(options.requestLogging === undefined ? {} : { requestLogging: options.requestLogging }),
    ...(options.ingestionLimiter === undefined
      ? {}
      : { ingestionLimiter: options.ingestionLimiter }),
    ...(options.apiLimiter === undefined ? {} : { apiLimiter: options.apiLimiter }),
    ...(options.authLimiter === undefined ? {} : { authLimiter: options.authLimiter }),
  });

  const a = await deps.issueApiKey({
    tenantId: TENANT_A,
    name: 'tenant-a-full',
    scopes: ALL_SCOPES,
  });
  const b = await deps.issueApiKey({
    tenantId: TENANT_B,
    name: 'tenant-b-full',
    scopes: ALL_SCOPES,
  });
  const aReadonly = await deps.issueApiKey({
    tenantId: TENANT_A,
    name: 'tenant-a-readonly',
    scopes: READONLY_SCOPES,
  });

  return {
    deps,
    app,
    keyForTenantA: a.secret,
    keyForTenantB: b.secret,
    keyForTenantAReadonly: aReadonly.secret,
    close: async () => {
      await app.close();
    },
  };
}

export function bearer(secret: string): { authorization: string } {
  return { authorization: `Bearer ${secret}` };
}

export const STATION_PAYLOAD = {
  id: 'station-1',
  name: 'Nairobi Depot',
  code: 'NBO-01',
  timezone: 'Africa/Nairobi',
};

export const TANK_PAYLOAD = {
  id: 'tank-1',
  stationId: 'station-1',
  name: 'Diesel Tank 1',
  product: 'diesel',
  geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
  capacityLitres: 19_000,
};

/** A probe at 2000 mm of a 2500 x 4000 mm vertical cylinder. */
export function readingPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observedAt: '2026-01-01T00:00:00.000Z',
    levelMm: 2000,
    waterLevelMm: 5,
    temperatureC: 22,
    source: 'manual',
    ...overrides,
  };
}

export interface SeededTenant {
  readonly stationId: string;
  readonly tankId: string;
}

/**
 * Creates the station and tank every route test needs, through the public API
 * so the tests exercise the same path an operator would.
 */
export async function seedTenant(
  harness: TestHarness,
  key = harness.keyForTenantA,
  tankPayload: Record<string, unknown> = TANK_PAYLOAD,
): Promise<SeededTenant> {
  const stationResponse = await harness.app.inject({
    method: 'POST',
    url: '/v1/stations',
    headers: bearer(key),
    payload: STATION_PAYLOAD,
  });
  const tankResponse = await harness.app.inject({
    method: 'POST',
    url: '/v1/tanks',
    headers: bearer(key),
    payload: tankPayload,
  });
  return {
    stationId: (stationResponse.json() as { station: { id: string } }).station.id,
    tankId: (tankResponse.json() as { tank: { id: string } }).tank.id,
  };
}
