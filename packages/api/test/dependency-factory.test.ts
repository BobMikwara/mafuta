import { describe, expect, it } from 'vitest';
import { createSilentLogger, toTenantId } from '@fueltrack/core';
import { createPlatformDependencies } from '../src/dependency-factory.js';

const TENANT = toTenantId('tenant-a');

describe('platform dependencies', () => {
  it('issues a credential that can authenticate immediately', async () => {
    const deps = createPlatformDependencies({ logger: createSilentLogger() });
    const issued = await deps.issueApiKey({
      tenantId: TENANT,
      name: 'device',
      scopes: ['tanks:read'],
    });

    const found = await deps.apiKeys.findBySecret(issued.secret);
    expect(found?.tenantId).toBe(TENANT);
    expect(found?.id).toBe(issued.record.id);
  });

  it('honours an operator supplied secret instead of generating one', async () => {
    const deps = createPlatformDependencies({ logger: createSilentLogger() });
    const secret = 'operator-supplied-development-key';
    const issued = await deps.issueApiKey({
      tenantId: TENANT,
      name: 'local-development-key',
      scopes: ['tanks:read'],
      secret,
    });

    // The exact secret supplied must authenticate, which is what the api
    // server relies on for FUELTRACK_DEV_API_KEY.
    expect(issued.secret).toBe(secret);
    const found = await deps.apiKeys.findBySecret(secret);
    expect(found?.id).toBe(issued.record.id);
  });

  it('never stores the secret in clear text', async () => {
    const deps = createPlatformDependencies({ logger: createSilentLogger() });
    const secret = 'operator-supplied-development-key';
    await deps.issueApiKey({ tenantId: TENANT, name: 'k', scopes: ['tanks:read'], secret });

    const listed = await deps.apiKeys.list(TENANT);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(secret);
  });

  it('wires the fleet and ingest services to the same repositories', async () => {
    const deps = createPlatformDependencies({ logger: createSilentLogger() });
    expect(deps.fleetService).toBeDefined();
    expect(deps.ingestService).toBeDefined();
    expect(deps.deviceService).toBeDefined();
    expect(deps.eventService).toBeDefined();
    expect(deps.dashboardService).toBeDefined();
    expect(deps.reportService).toBeDefined();
    expect(deps.auditService).toBeDefined();
    expect(deps.alertSweepService).toBeDefined();
    // Every service shares one store, so a tank created through the fleet
    // service is visible to ingestion and to the dashboard.
    expect(await deps.fleetService.listStations(TENANT, { limit: 100 })).toEqual([]);
  });

  it('does not resolve an unrelated tenant credential', async () => {
    const deps = createPlatformDependencies({ logger: createSilentLogger() });
    await deps.issueApiKey({
      tenantId: TENANT,
      name: 'device',
      scopes: ['tanks:read'],
      secret: 'known-secret-for-one-tenant',
    });
    expect(await deps.apiKeys.findBySecret('known-secret-for-another')).toBeNull();
  });
});
