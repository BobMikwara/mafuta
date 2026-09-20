import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { buildServer, createPlatformDependencies, type PlatformDependencies } from '@fueltrack/api';
import {
  API_KEY_SCOPES,
  ConflictError,
  createSiteSchema,
  createTankSchema,
  parseInput,
  systemClock,
  toSiteId,
  toTenantId,
  type Logger,
  type TenantId,
} from '@fueltrack/core';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Config reading (mirrors apps/api-server/src/config.ts but self-contained)
// ---------------------------------------------------------------------------

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

interface ApiServerConfig {
  readonly minLogLevel: LogLevel;
  readonly requestLogging: boolean;
  readonly seedDemo: boolean;
  readonly devApiKey: string | null;
  readonly demoTenantId: TenantId;
  readonly dashboardDir: string | null;
}

class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'critical'] as const;

function readLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === '') return 'info';
  if (!(LOG_LEVELS as ReadonlyArray<string>).includes(raw)) {
    throw new ConfigurationError(`FUELTRACK_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  }
  return raw as LogLevel;
}

function readConfig(env: NodeJS.ProcessEnv = process.env): ApiServerConfig {
  const seedDemo = env['FUELTRACK_SEED_DEMO'] === 'true';
  const devApiKey = env['FUELTRACK_DEV_API_KEY']?.trim() ?? '';
  const tenantRaw = env['FUELTRACK_DEMO_TENANT_ID']?.trim() ?? 'demo-tenant';

  if (seedDemo && devApiKey.length < 16) {
    throw new ConfigurationError(
      'FUELTRACK_SEED_DEMO=true requires FUELTRACK_DEV_API_KEY with at least 16 characters. The key is supplied by the operator and is never logged.',
    );
  }

  let demoTenantId: TenantId;
  try {
    demoTenantId = toTenantId(tenantRaw);
  } catch {
    throw new ConfigurationError(
      'FUELTRACK_DEMO_TENANT_ID must be a lowercase alphanumeric identifier',
    );
  }

  return {
    minLogLevel: readLogLevel(env['FUELTRACK_LOG_LEVEL']),
    requestLogging: env['FUELTRACK_REQUEST_LOGGING'] !== 'false',
    seedDemo,
    devApiKey: devApiKey.length === 0 ? null : devApiKey,
    demoTenantId,
    dashboardDir: env['FUELTRACK_DASHBOARD_DIR']?.trim() || null,
  };
}

const DEMO_SITE_ID = toSiteId('demo-site');

// ---------------------------------------------------------------------------
// Dashboard directory resolution for Vercel environment
// ---------------------------------------------------------------------------

function findDashboardDir(configured: string | null): string | null {
  if (configured !== null) {
    if (existsSync(configured) && existsSync(join(configured, 'index.html'))) {
      return configured;
    }
    // If explicitly configured but not found, return null to disable dashboard
    return null;
  }

  const here = dirname(fileURLToPath(import.meta.url));

  const candidates = [
    // Vercel: project root is cwd, includeFiles preserves relative path
    join(process.cwd(), 'apps/api-server/public'),
    resolve('apps/api-server/public'),
    // When function bundle includes files, cwd may be different
    join(process.cwd(), 'public'),
    // Relative to this file: api/index.ts -> ../apps/api-server/public
    join(here, '..', 'apps', 'api-server', 'public'),
    join(here, '..', '..', 'apps', 'api-server', 'public'),
    join(here, '..', 'public'),
    // Fallback for local testing where api folder is at root and public is at apps/api-server/public
    resolve(join(here, '..', 'apps', 'api-server', 'public')),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && existsSync(join(candidate, 'index.html'))) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Seed logic (same as apps/api-server)
// ---------------------------------------------------------------------------

type SeedOutcome = 'ok' | 'exists' | 'failed';

function isAlreadyExists(error: unknown): boolean {
  // In-memory adapters signal duplicates with a domain error; Prisma uses the
  // P2002 unique-constraint code. Warm instances re-running the seed hit both.
  if (error instanceof ConflictError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Runs one seed step. Duplicates are expected on warm/reused instances and are
 * logged at debug; any other failure is logged at warn with the error name and
 * driver code so an unreachable or unmigrated database is visible in the
 * platform logs instead of being silently ignored.
 */
async function seedStep(
  logger: Logger,
  step: string,
  run: () => Promise<unknown>,
): Promise<SeedOutcome> {
  try {
    await run();
    return 'ok';
  } catch (error) {
    if (isAlreadyExists(error)) {
      logger.debug('seed.skip', { step, reason: 'already_exists' });
      return 'exists';
    }
    logger.warn('seed.step_failed', {
      step,
      reason: error instanceof Error ? error.name : 'unknown',
      ...(typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? { code: (error as { code: string }).code }
        : {}),
    });
    return 'failed';
  }
}

async function seedDemoData(
  dependencies: PlatformDependencies,
  config: ApiServerConfig,
): Promise<boolean> {
  const tenantId = config.demoTenantId;
  const logger = dependencies.logger;
  const outcomes: SeedOutcome[] = [];

  outcomes.push(
    await seedStep(logger, 'site', () =>
      dependencies.fleetService.createSite(
        tenantId,
        parseInput(createSiteSchema, {
          id: DEMO_SITE_ID,
          name: 'Demo Depot',
          timezone: 'Africa/Nairobi',
        }),
      ),
    ),
  );

  outcomes.push(
    await seedStep(logger, 'tank-diesel-1', () =>
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
    ),
  );

  outcomes.push(
    await seedStep(logger, 'tank-petrol95-2', () =>
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
    ),
  );

  if (config.devApiKey !== null) {
    outcomes.push(
      await seedStep(logger, 'api-key', async () => {
        const issued = await dependencies.issueApiKey({
          tenantId,
          name: 'local-development-key',
          scopes: [...API_KEY_SCOPES],
          secret: config.devApiKey as string,
        });
        logger.info('demo.seeded', {
          tenantId,
          siteId: DEMO_SITE_ID,
          keyId: issued.record.id,
        });
      }),
    );
  }

  return !outcomes.includes('failed');
}

// ---------------------------------------------------------------------------
// Global cached server for Vercel serverless reuse
// ---------------------------------------------------------------------------

type Cached = {
  app: Awaited<ReturnType<typeof buildServer>>;
  dependencies: PlatformDependencies;
};

declare global {
  var __fueltrack_cached__: Cached | undefined;
  var __fueltrack_seeded__: boolean | undefined;
}

async function getCachedApp(): Promise<Cached['app']> {
  if (globalThis.__fueltrack_cached__ !== undefined) {
    return globalThis.__fueltrack_cached__.app;
  }

  const config = readConfig();
  const dependencies = createPlatformDependencies({
    minLogLevel: config.minLogLevel,
    clock: systemClock,
  });

  if (config.seedDemo && globalThis.__fueltrack_seeded__ !== true) {
    // Only remember the seed when every step passed (or already existed). If
    // the database was briefly unreachable, the next cold start must retry,
    // otherwise the demo key would never be installed on this instance.
    const seeded = await seedDemoData(dependencies, config);
    globalThis.__fueltrack_seeded__ = seeded;
  }

  const dashboardDir = findDashboardDir(config.dashboardDir);

  if (dashboardDir === null) {
    dependencies.logger.warn('dashboard.disabled', {
      reason: 'public directory not found, dashboard will return 404',
    });
  } else {
    dependencies.logger.info('dashboard.enabled', { dashboardDir });
  }

  const app = await buildServer(dependencies, {
    requestLogging: config.requestLogging,
    minLogLevel: config.minLogLevel,
    ...(dashboardDir === null ? {} : { dashboardDir }),
  });

  await app.ready();

  globalThis.__fueltrack_cached__ = { app, dependencies };

  return app;
}

// ---------------------------------------------------------------------------
// Vercel handler
// ---------------------------------------------------------------------------

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await getCachedApp();
    // Fastify can handle Node's IncomingMessage/ServerResponse via emit
    app.server.emit('request', req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    // Fallback if Fastify failed to initialize
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'internal_error', message }));
    }
    // Log to stderr for Vercel logs
    process.stderr.write(`api handler failed: ${message}\n`);
  }
}
