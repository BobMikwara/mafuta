import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildServer,
  checkCredentialReadiness,
  createCredentialStatusReader,
  createPlatformDependencies,
  type PlatformDependencies,
} from '@fueltrack/api';
import {
  API_KEY_SCOPES,
  autoMigrateOnBoot,
  createSiteSchema,
  createTankSchema,
  parseInput,
  systemClock,
} from '@fueltrack/core';
import { DEMO_SITE_ID, readConfig, type ApiServerConfig } from './config.js';
import { enforceCredentialRequirement } from './credential-gate.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DASHBOARD_DIR = join(here, '..', 'public');

async function seedDemoData(
  dependencies: PlatformDependencies,
  config: ApiServerConfig,
): Promise<void> {
  const tenantId = config.demoTenantId;

  // The seed runs before the server starts listening, so a failing step must
  // abort startup (fail fast) - but with the step named, otherwise an
  // unreachable or unmigrated database surfaces as an anonymous stack trace.
  const steps: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    [
      'site',
      () =>
        dependencies.fleetService.createSite(
          tenantId,
          parseInput(createSiteSchema, {
            id: DEMO_SITE_ID,
            name: 'Demo Depot',
            timezone: 'Africa/Nairobi',
          }),
        ),
    ],
    [
      'tank-diesel-1',
      () =>
        dependencies.fleetService.createTank(
          tenantId,
          parseInput(createTankSchema, {
            siteId: DEMO_SITE_ID,
            name: 'Diesel Tank 1',
            product: 'diesel',
            geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
            capacityLitres: 19_000,
          }),
        ),
    ],
    [
      'tank-petrol95-2',
      () =>
        dependencies.fleetService.createTank(
          tenantId,
          parseInput(createTankSchema, {
            siteId: DEMO_SITE_ID,
            name: 'Petrol 95 Tank 2',
            product: 'petrol-95',
            geometry: { kind: 'vertical-cylinder', diameterMm: 2200, heightMm: 3600 },
            capacityLitres: 13_000,
          }),
        ),
    ],
  ];

  for (const [step, run] of steps) {
    try {
      await run();
    } catch (error) {
      throw new Error(
        `demo seed failed at step "${step}": ${error instanceof Error ? error.message : 'unknown error'}`,
        { cause: error },
      );
    }
  }

  // The secret comes from the operator through FUELTRACK_DEV_API_KEY, so the
  // developer who started the server is the only one who knows it.
  let issued: Awaited<ReturnType<PlatformDependencies['issueApiKey']>>;
  try {
    issued = await dependencies.issueApiKey({
      tenantId,
      name: 'local-development-key',
      scopes: [...API_KEY_SCOPES],
      ...(config.devApiKey === null ? {} : { secret: config.devApiKey }),
    });
  } catch (error) {
    throw new Error(
      `demo seed failed at step "api-key": ${error instanceof Error ? error.message : 'unknown error'}`,
      { cause: error },
    );
  }

  dependencies.logger.info('demo.seeded', {
    tenantId,
    siteId: DEMO_SITE_ID,
    keyId: issued.record.id,
    note: 'The seeded key secret was supplied by the operator and is never logged',
  });
}

export async function main(): Promise<void> {
  const config = readConfig();
  const dependencies = createPlatformDependencies({
    minLogLevel: config.minLogLevel,
    clock: systemClock,
  });

  if (config.autoMigrate) {
    // Long running server: same opt-in cold start migration path as the
    // serverless entry point, so `npm start` against an empty database works.
    await autoMigrateOnBoot({
      logger: dependencies.logger,
      here,
    });
  }

  if (config.seedDemo) {
    await seedDemoData(dependencies, config);
  }

  // A server with no usable credential rejects every request with the same
  // message as a wrong key. Verify the store before listening so the failure is
  // reported once, with the remediation, instead of as a 401 storm.
  const readiness = await checkCredentialReadiness(
    {
      apiKeys: dependencies.apiKeys,
      logger: dependencies.logger,
      context: {
        deployment: 'server',
        persistence: dependencies.persistence ?? 'memory',
        demoSeedEnabled: config.seedDemo,
        devApiKeyConfigured: config.devApiKey !== null,
      },
    },
    { requireCredentials: config.requireCredentials },
  );
  enforceCredentialRequirement(config, readiness);

  const dashboardDir = config.dashboardDir ?? DEFAULT_DASHBOARD_DIR;
  const app = await buildServer(
    { ...dependencies, credentialStatus: createCredentialStatusReader(dependencies.apiKeys) },
    {
      requestLogging: config.requestLogging,
      minLogLevel: config.minLogLevel,
      dashboardDir,
    },
  );

  const shutdown = async (signal: string): Promise<void> => {
    dependencies.logger.info('server.shutdown.requested', { signal });
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  dependencies.logger.info('server.listening', {
    host: config.host,
    port: config.port,
    demoDataSeeded: config.seedDemo,
    persistence: 'in-memory',
  });
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`fueltrack-api-server failed to start: ${message}\n`);
    process.exit(1);
  });
}
