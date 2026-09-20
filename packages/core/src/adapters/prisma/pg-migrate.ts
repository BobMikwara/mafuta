import type * as PgNamespace from 'pg';
import type { Pool, PoolClient, PoolConfig } from 'pg';
import {
  MIGRATION_ADVISORY_LOCK,
  MigrationError,
  findMigrationsDir,
  migrationDirCandidates,
  runMigrations,
  type MigrationLogger,
  type MigrationSql,
} from './migrate.js';

/**
 * `pg` backed implementation of the migration runner.
 *
 * Two deliberate choices:
 *   - Migrations connect with `DIRECT_URL` when it is set. Supabase (and most
 *     managed Postgres) put the app behind a transaction mode pooler, which
 *     cannot be used for DDL, session level locks or multi statement
 *     transactions. `DATABASE_URL` stays the pooled app connection.
 *   - `pg` is imported dynamically and only when a migration actually runs, so
 *     the in-memory development path and the frontend bundle never load a
 *     Postgres driver.
 */

const LOCAL_HOST_PATTERN = /@(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//;

export interface ResolvedMigrationConnection {
  /** Name of the environment variable the connection string came from. */
  readonly source: 'DIRECT_URL' | 'DATABASE_URL';
  readonly connectionString: string;
  readonly poolConfig: PoolConfig;
}

export class MigrationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationConfigError';
  }
}

/**
 * Strips Prisma specific URL parameters (`schema`, `pgbouncer`,
 * `connection_limit`) that node-postgres would forward to the server and
 * reject. Credentials are never logged, so only the source variable name is
 * returned alongside the string.
 */
function toDriverUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    // Not a URL the WHATWG parser accepts (for example a socket path); pass it
    // through and let the driver report a meaningful error.
    return raw;
  }
}

export function resolveMigrationConnection(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedMigrationConnection {
  const direct = env['DIRECT_URL']?.trim();
  if (direct !== undefined && direct !== '') {
    return build(direct, 'DIRECT_URL');
  }

  const database = env['DATABASE_URL']?.trim();
  if (database !== undefined && database !== '') {
    return build(database, 'DATABASE_URL');
  }

  throw new MigrationConfigError(
    'auto migration needs DIRECT_URL or DATABASE_URL. Set DIRECT_URL to the non pooled Postgres connection (port 5432 on Supabase), because DDL and session level advisory locks do not work through a transaction mode pooler.',
  );
}

function build(
  raw: string,
  source: ResolvedMigrationConnection['source'],
): ResolvedMigrationConnection {
  const connectionString = toDriverUrl(raw);
  const isLocal = LOCAL_HOST_PATTERN.test(connectionString);
  return {
    source,
    connectionString,
    poolConfig: {
      connectionString,
      // Migrations are sequential: one connection is enough, and a serverless
      // instance must not open a pool against a managed database.
      max: 1,
      // Supabase requires TLS; a local docker container has none.
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
      statement_timeout: 60_000,
      application_name: 'fueltrack-migrate',
    },
  };
}

/**
 * Wraps a `pg` Pool in the narrow interface the runner needs.
 *
 * The pool is created with `max: 1`, so the connection that holds the advisory
 * lock must also run every migration statement. `withLock` therefore checks out
 * a single client and routes `query`/`exec` through it for the duration of the
 * run; otherwise the statements would wait for a free connection the lock is
 * already holding, and the boot would deadlock.
 */
export function createPgMigrationSql(pool: Pool): MigrationSql {
  // Set for the duration of withLock. Migrations run sequentially, so a single
  // slot is enough and there is no concurrency to guard within one executor.
  let lockedClient: PoolClient | null = null;

  const target = (): Pool | PoolClient => lockedClient ?? pool;

  return {
    async query<Row>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<Row>> {
      const result = await target().query(sql, params as unknown[] | undefined);
      return result.rows as ReadonlyArray<Row>;
    },
    async exec(sql: string): Promise<void> {
      await target().query(sql);
    },
    async withLock<T>(run: () => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const [first, second] = MIGRATION_ADVISORY_LOCK;
      lockedClient = client;
      let locked = false;
      try {
        // Session level lock on the checked out connection: it survives the
        // many transactions of a migration run and is released explicitly.
        await client.query('SELECT pg_advisory_lock($1, $2)', [first, second]);
        locked = true;
        return await run();
      } finally {
        lockedClient = null;
        if (locked) {
          await client.query('SELECT pg_advisory_unlock($1, $2)', [first, second]).catch(() => {
            // The session ends when the unlock fails, and Postgres releases
            // session level advisory locks on disconnect.
          });
        }
        client.release();
      }
    },
  };
}

async function loadPg(): Promise<typeof PgNamespace> {
  try {
    return await import('pg');
  } catch (error) {
    throw new MigrationError(
      'the pg driver is not available in this deployment, so migrations cannot be applied at runtime',
      { reason: error instanceof Error ? error.name : 'unknown' },
      { cause: error },
    );
  }
}

export interface AutoMigrateOptions {
  readonly logger: MigrationLogger;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Overrides the "is this deployment backed by Postgres" decision. Callers
   * that already resolved persistence (the composition root) pass their own
   * predicate so the two cannot disagree.
   */
  readonly persistenceUsesDatabase?: (env: NodeJS.ProcessEnv) => boolean;
  /** Directory of the compiled module, used to locate `prisma/migrations`. */
  readonly here?: string;
  /** Override for tests: directories to search instead of the bundle paths. */
  readonly migrationDirs?: ReadonlyArray<string>;
}

export type AutoMigrateOutcome =
  | { readonly status: 'disabled' }
  | {
      readonly status: 'skipped';
      readonly reason: 'memory_persistence' | 'migrations_dir_not_found';
    }
  | {
      readonly status: 'ok';
      readonly applied: ReadonlyArray<string>;
      readonly upToDate: boolean;
      readonly drift: ReadonlyArray<string>;
      readonly outOfOrder: ReadonlyArray<string>;
      readonly directory: string;
      readonly connectionSource: ResolvedMigrationConnection['source'];
    }
  | {
      readonly status: 'failed';
      readonly step: 'connect' | 'driver' | 'catalog' | 'migrate';
      readonly reason: string;
      readonly code?: string;
      readonly migration?: string;
    };

/**
 * Applies committed migrations on cold start when `FUELTRACK_AUTO_MIGRATE=true`
 * and the deployment uses Prisma. Never throws: a deployment with a broken
 * migration step must still serve `/healthz`, which is how the operator finds
 * out what went wrong.
 */
export async function autoMigrateOnBoot(options: AutoMigrateOptions): Promise<AutoMigrateOutcome> {
  const env = options.env ?? process.env;
  const logger = options.logger;

  if (env['FUELTRACK_AUTO_MIGRATE'] !== 'true') {
    logger.debug('db.migrate_disabled', { reason: 'FUELTRACK_AUTO_MIGRATE is not true' });
    return { status: 'disabled' };
  }

  const usesDatabase =
    options.persistenceUsesDatabase ??
    ((values: NodeJS.ProcessEnv): boolean =>
      values['USE_PRISMA'] === 'true' || (values['DATABASE_URL']?.trim() ?? '') !== '');

  if (!usesDatabase(env)) {
    logger.info('db.migrate_skipped', { reason: 'memory_persistence' });
    return { status: 'skipped', reason: 'memory_persistence' };
  }

  const candidates = options.migrationDirs ?? migrationDirCandidates(env, options.here);
  const found = await findMigrationsDir(candidates).catch((error: unknown) => {
    logger.warn('db.migrate_failed', {
      step: 'catalog',
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  });

  if (found === null) {
    logger.warn('db.migrate_failed', {
      step: 'catalog',
      reason: 'migrations_dir_not_found',
      candidates,
    });
    return { status: 'failed', step: 'catalog', reason: 'migrations_dir_not_found' };
  }

  let connection: ResolvedMigrationConnection;
  try {
    connection = resolveMigrationConnection(env);
  } catch (error) {
    logger.warn('db.migrate_failed', {
      step: 'connect',
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return { status: 'failed', step: 'connect', reason: 'missing_connection_string' };
  }

  let pg: typeof PgNamespace;
  try {
    pg = await loadPg();
  } catch (error) {
    logger.warn('db.migrate_failed', {
      step: 'driver',
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return { status: 'failed', step: 'driver', reason: 'pg_unavailable' };
  }

  const pool = new pg.Pool(connection.poolConfig);
  try {
    const summary = await runMigrations({
      sql: createPgMigrationSql(pool),
      migrations: found.migrations,
      directory: found.directory,
      logger,
    });

    logger.info('db.migrated', {
      status: summary.status,
      applied: summary.applied,
      available: summary.available,
      drift: summary.drift,
      outOfOrder: summary.outOfOrder,
      connection: connection.source,
      directory: summary.directory,
    });

    return {
      status: 'ok',
      applied: summary.applied,
      upToDate: summary.status === 'up_to_date',
      drift: summary.drift,
      outOfOrder: summary.outOfOrder,
      directory: summary.directory,
      connectionSource: connection.source,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown';
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;
    const migration = error instanceof MigrationError ? (error.details.migration ?? null) : null;

    logger.warn('db.migrate_failed', {
      step: 'migrate',
      reason,
      ...(code === undefined ? {} : { code }),
      ...(migration === null ? {} : { migration }),
      connection: connection.source,
    });

    return {
      status: 'failed',
      step: 'migrate',
      reason,
      ...(code === undefined ? {} : { code }),
      ...(migration === null ? {} : { migration }),
    };
  } finally {
    await pool.end().catch(() => {
      // A cold start must not leak the migration connection into the pool the
      // application uses, and failing to close it is not worth an error.
    });
  }
}

export { MIGRATION_ADVISORY_LOCK };
export type { MigrationLogger, MigrationSql };
