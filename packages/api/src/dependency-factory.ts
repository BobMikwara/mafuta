import {
  AlertSweepService,
  AuditService,
  checkPrismaConnection,
  describePrismaSchemaStatus,
  createLogger,
  createMemoryApiKeyRegistry,
  createMemoryRepositories,
  createPrismaApiKeyRegistry,
  createPrismaRepositories,
  createRateLimiter,
  createStdioSink,
  DEFAULT_RATE_LIMITS,
  DashboardService,
  DeviceService,
  EventService,
  FleetService,
  generateApiKey,
  hashApiKey,
  IngestService,
  rateLimitFromEnv,
  ReportService,
  systemClock,
  type ApiKeyRecord,
  type ApiKeyRegistry,
  type AuditService as AuditServiceType,
  type Clock,
  type DashboardService as DashboardServiceType,
  type DeviceService as DeviceServiceType,
  type EventService as EventServiceType,
  type FleetService as FleetServiceType,
  type IngestService as IngestServiceType,
  type Logger,
  type LogLevel,
  type RateLimiter,
  type ReportService as ReportServiceType,
  type Repositories,
} from '@fueltrack/core';
import type { ServerDependencies } from './server.js';

/**
 * Rate limits. Each one is a separate limiter because the identities and the
 * budgets differ: ingestion is per credential, authentication failures are per
 * client address, and the report limit protects an expensive query.
 */
export interface PlatformRateLimits {
  readonly ingestion: RateLimiter;
  readonly authentication: RateLimiter;
}

export function createPlatformRateLimits(env: NodeJS.ProcessEnv = process.env): PlatformRateLimits {
  return {
    ingestion: createRateLimiter(
      rateLimitFromEnv(env['FUELTRACK_INGEST_RATE_LIMIT'], DEFAULT_RATE_LIMITS.ingestion),
    ),
    authentication: createRateLimiter(
      rateLimitFromEnv(env['FUELTRACK_AUTH_RATE_LIMIT'], DEFAULT_RATE_LIMITS.perClientAddress),
    ),
  };
}

export interface PlatformDependencies extends ServerDependencies {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly repositories: Repositories;
  readonly fleetService: FleetServiceType;
  readonly ingestService: IngestServiceType;
  readonly deviceService: DeviceServiceType;
  readonly eventService: EventServiceType;
  readonly dashboardService: DashboardServiceType;
  readonly reportService: ReportServiceType;
  readonly auditService: AuditServiceType;
  readonly alertSweepService: AlertSweepService;
  /** Ingestion throttle derived from the environment. */
  readonly ingestionLimiter: RateLimiter;
  readonly authLimiter: RateLimiter;
  /**
   * Issues a credential and returns its secret exactly once. When `secret` is
   * supplied it is used instead of a generated one, which is how an operator
   * provided local development key is installed. Intended for bootstrap and
   * tests; production provisioning must go through a control plane that stores
   * the secret in the operator's secret manager.
   */
  issueApiKey(input: {
    tenantId: ApiKeyRecord['tenantId'];
    name: string;
    scopes: ReadonlyArray<string>;
    readonly secret?: string;
  }): Promise<{ readonly record: ApiKeyRecord; readonly secret: string }>;
}

export interface PlatformDependenciesOptions {
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly repositories?: Repositories;
  readonly apiKeys?: ApiKeyRegistry;
  readonly minLogLevel?: LogLevel;
  readonly usePrisma?: boolean;
}

/**
 * Persistence selection, exported so tools that run outside a request (the
 * credentials CLI) resolve the store from an explicit environment rather than
 * from the ambient process, which keeps them testable and predictable.
 */
export function shouldUsePrisma(explicit?: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (explicit !== undefined) return explicit;
  if (env['USE_PRISMA'] === 'true') return true;
  if (env['DATABASE_URL']?.includes('supabase')) return true;
  if (env['DATABASE_URL']?.startsWith('postgresql://')) {
    // If DATABASE_URL is set and not the local docker default, prefer Prisma in production
    const isLocalDocker =
      env['DATABASE_URL']?.includes('localhost:5432') &&
      env['DATABASE_URL']?.includes('fueltrack_dev');
    if (!isLocalDocker && env['NODE_ENV'] === 'production') return true;
  }
  return false;
}

/**
 * Composition root. Everything below this line is an in-memory reference
 * implementation; swapping in Postgres or another datastore means providing a
 * `Repositories` implementation and changing only this function.
 */
export function createPlatformDependencies(
  options: PlatformDependenciesOptions = {},
): PlatformDependencies {
  const clock = options.clock ?? systemClock;
  const logger =
    options.logger ??
    createLogger({
      sink: createStdioSink(),
      ...(options.minLogLevel === undefined ? {} : { minLevel: options.minLogLevel }),
    });
  const usePrisma = shouldUsePrisma(options.usePrisma);

  let repositories: Repositories;
  let apiKeys: ApiKeyRegistry;

  if (options.repositories) {
    repositories = options.repositories;
  } else {
    repositories = usePrisma ? createPrismaRepositories() : createMemoryRepositories();
  }

  if (options.apiKeys) {
    apiKeys = options.apiKeys;
  } else {
    apiKeys = usePrisma
      ? createPrismaApiKeyRegistry({ clock: () => clock.now() })
      : createMemoryApiKeyRegistry({ clock: () => clock.now() });
  }

  if (usePrisma) {
    logger.info('persistence.prisma.enabled', { reason: 'DATABASE_URL or USE_PRISMA' });
  } else {
    logger.info('persistence.memory.enabled', { reason: 'default for dev/test' });
  }

  const limits = createPlatformRateLimits();

  const fleetService = new FleetService({ repositories, clock, logger });
  const deviceService = new DeviceService({ repositories, clock, logger });
  const eventService = new EventService({ repositories, clock, logger });
  const ingestService = new IngestService({ repositories, clock, logger, eventService });
  const dashboardService = new DashboardService({
    repositories,
    clock,
    logger,
    fleetService,
  });
  const reportService = new ReportService({
    repositories,
    clock,
    logger,
    fleetService,
    deviceService,
    eventService,
  });
  const auditService = new AuditService({ auditLogs: repositories.auditLogs, clock, logger });
  const alertSweepService = new AlertSweepService({
    repositories,
    clock,
    logger,
    ingestService,
  });

  return {
    clock,
    logger,
    repositories,
    apiKeys,
    persistence: usePrisma ? 'prisma' : 'memory',
    ...(usePrisma
      ? { ready: checkPrismaConnection, schemaStatus: describePrismaSchemaStatus }
      : {}),
    fleetService,
    ingestService,
    deviceService,
    eventService,
    dashboardService,
    reportService,
    auditService,
    alertSweepService,
    ingestionLimiter: limits.ingestion,
    authLimiter: limits.authentication,
    issueApiKey: async (input) => {
      const generated = generateApiKey({
        tenantId: input.tenantId,
        name: input.name,
        scopes: input.scopes,
        createdAt: clock.now().toISOString(),
      });
      const rawSecret = input.secret ?? generated.secret;
      const secret = rawSecret.trim();
      const record =
        input.secret === undefined
          ? generated.record
          : { ...generated.record, keyHash: hashApiKey(secret) };
      await apiKeys.save(record);
      return { record, secret };
    },
  };
}
