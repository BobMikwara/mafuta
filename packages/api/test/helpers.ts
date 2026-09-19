import {
  API_KEY_SCOPES,
  createSilentLogger,
  manualClock,
  toTenantId,
  type ApiKeyScope,
} from '@fueltrack/core';
import { buildServer } from '../src/server.js';
import {
  createPlatformDependencies,
  type PlatformDependencies,
} from '../src/dependency-factory.js';

export const TENANT_A = toTenantId('tenant-a');
export const TENANT_B = toTenantId('tenant-b');

export const ALL_SCOPES: ReadonlyArray<ApiKeyScope> = [...API_KEY_SCOPES];

export const DEVICE_SCOPES: ReadonlyArray<ApiKeyScope> = [
  'readings:read',
  'readings:write',
  'tanks:read',
  'alarms:read',
];

export interface TestHarness {
  readonly deps: PlatformDependencies;
  readonly app: Awaited<ReturnType<typeof buildServer>>;
  readonly keyForTenantA: string;
  readonly keyForTenantB: string;
  readonly keyForTenantAReadonly: string;
  close(): Promise<void>;
}

export async function createHarness(): Promise<TestHarness> {
  const deps = createPlatformDependencies({
    logger: createSilentLogger(),
    clock: manualClock('2026-01-01T00:00:00.000Z'),
  });
  const app = await buildServer(deps);

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
    scopes: ['sites:read', 'tanks:read', 'readings:read', 'alarms:read'],
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

export const SITE_PAYLOAD = { id: 'site-1', name: 'Nairobi Depot', timezone: 'Africa/Nairobi' };

export const TANK_PAYLOAD = {
  siteId: 'site-1',
  name: 'Diesel Tank 1',
  product: 'diesel',
  geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
  capacityLitres: 19_000,
};

export function readingPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observedAt: '2026-01-01T00:00:00.000Z',
    levelMm: 2000,
    waterLevelMm: 5,
    temperatureC: 22,
    ...overrides,
  };
}
