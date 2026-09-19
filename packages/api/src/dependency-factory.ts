import {
  createLogger,
  createMemoryApiKeyRegistry,
  createMemoryRepositories,
  createPrismaApiKeyRegistry,
  createPrismaRepositories,
  createStdioSink,
  FleetService,
  generateApiKey,
  hashApiKey,
  IngestService,
  systemClock,
  type ApiKeyRecord,
  type ApiKeyRegistry,
  type Clock,
  type FleetService as FleetServiceType,
  type IngestService as IngestServiceType,
  type Logger,
  type LogLevel,
  type Repositories,
} from '@fueltrack/core';
import type { ServerDependencies } from './server.js';

export interface PlatformDependencies extends ServerDependencies {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly repositories: Repositories;
  readonly fleetService: FleetServiceType;
  readonly ingestService: IngestServiceType;
  /**
   * Issues a credential and returns its secret exactly once. Intended for
   * bootstrap and tests; production provisioning must go through a control
   * plane that stores the secret in the operator's secret manager.
   */
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

function shouldUsePrisma(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  if (process.env['USE_PRISMA'] === 'true') return true;
  if (process.env['DATABASE_URL']?.includes('supabase')) return true;
  if (process.env['DATABASE_URL']?.startsWith('postgresql://')) {
    // If DATABASE_URL is set and not the local docker default, prefer Prisma in production
    const isLocalDocker = process.env['DATABASE_URL']?.includes('localhost:5432') && process.env['DATABASE_URL']?.includes('fueltrack_dev');
    if (!isLocalDocker && process.env['NODE_ENV'] === 'production') return true;
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

  return {
    clock,
    logger,
    repositories,
    apiKeys,
    fleetService: new FleetService({ repositories, clock, logger }),
    ingestService: new IngestService({ repositories, clock, logger }),
    issueApiKey: async (input) => {
      const generated = generateApiKey({
        tenantId: input.tenantId,
        name: input.name,
        scopes: input.scopes,
        createdAt: clock.now().toISOString(),
      });
      const secret = input.secret ?? generated.secret;
      const record =
        input.secret === undefined
          ? generated.record
          : { ...generated.record, keyHash: hashApiKey(input.secret) };
      await apiKeys.save(record);
      return { record, secret };
    },
  };
}
