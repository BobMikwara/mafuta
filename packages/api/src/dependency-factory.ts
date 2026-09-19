import {
  createLogger,
  createMemoryApiKeyRegistry,
  createMemoryRepositories,
  createStdioSink,
  FleetService,
  generateApiKey,
  hashApiKey,
  IngestService,
  systemClock,
  type ApiKeyRecord,
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
  readonly minLogLevel?: LogLevel;
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
  const repositories = options.repositories ?? createMemoryRepositories();
  const apiKeys = createMemoryApiKeyRegistry({ clock: () => clock.now() });

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
